import { Channel, invoke } from "@tauri-apps/api/core";
import { BROWSER_EXPERIENCE_REGISTRY } from "../browser/browser-experience-registry";
import { faviconSourceValue } from "../lib/favicon";
import { isTauri } from "../lib/platform";
import { useBrowserStore, type BrowserState } from "../store/browser-store";
import { normalizeCapabilityManifest } from "./capability-manifest";
import { normalizeDynamicManifest } from "./dynamic-manifest";
import { getCachedArtifact, savePersistedSiteWorld } from "./host-api";
import { clearGenerationPreviewFrame, setGenerationPreviewFrame } from "./preview-store";
import type {
  FaviconDescriptor,
  ArtifactSitePatch,
  GenerationError,
  GenerationJob,
  GenerationPhase,
  GenerationProgress,
  GenerationRuntimeEvent,
  PageArtifact,
  ProviderConnection,
  RolePalette,
} from "../types/browser";

interface GenerationTask {
  cancel: () => void;
}

interface GenerationStartResult {
  jobId: string;
}

interface GenerationStartInput {
  jobId: string;
  profileId: string;
  credentialRef?: string;
  request: Record<string, unknown>;
}

type WireEvent = Record<string, unknown>;

const ACTIVE_PHASES = new Set<GenerationPhase>([
  "queued",
  "preparing-context",
  "directing",
  "generating",
  "validating",
  "compiling-styles",
  "resolving-images",
  "committing",
]);

/**
 * Owns the side effects around the persisted browser state. The store remains a
 * deterministic state machine; this coordinator only starts/cancels workers and
 * feeds their ordered events back into that state machine.
 */
export class GenerationCoordinator {
  readonly #tasks = new Map<string, GenerationTask>();
  #disposed = false;

  sync(state: BrowserState): void {
    if (this.#disposed) return;

    for (const [jobId, task] of this.#tasks) {
      const job = state.generationJobs[jobId];
      if (!job || job.status === "cancelled") {
        task.cancel();
        this.#tasks.delete(jobId);
      } else if (job.status === "completed" || job.status === "failed") {
        this.#tasks.delete(jobId);
      }
    }

    for (const job of Object.values(state.generationJobs)) {
      if (job.status !== "queued" || this.#tasks.has(job.id)) continue;
      const tab = tabsForProfile(state, job.profileId).find((candidate) => candidate.id === job.tabId);
      if (tab?.generationJobId !== job.id && tab?.luckyJobId !== job.id) continue;

      let cancelled = false;
      const placeholder: GenerationTask = { cancel: () => { cancelled = true; } };
      this.#tasks.set(job.id, placeholder);
      void this.#startQueuedJob(job, () => cancelled);
    }
  }

  async #startQueuedJob(job: GenerationJob, isCancelled: () => boolean): Promise<void> {
    if (canReuseCachedPage(job)) {
      const state = useBrowserStore.getState();
      const memoryArtifact = latestCachedArtifact(state, job);
      if (memoryArtifact) {
        this.#tasks.delete(job.id);
        state.commitCachedArtifact(job.id, memoryArtifact);
        return;
      }
      if (isTauri() && job.normalizedUrl) {
        const artifact = await getCachedArtifact(job.profileId, job.siteWorldId!, canonicalCacheUrl(job.normalizedUrl)).catch(() => undefined);
        if (isCancelled()) return;
        if (artifact) {
          this.#tasks.delete(job.id);
          useBrowserStore.getState().commitCachedArtifact(job.id, artifact);
          return;
        }
      }
    }

    if (isCancelled() || !useBrowserStore.getState().beginGeneration(job.id)) {
      this.#tasks.delete(job.id);
      return;
    }
    const latestState = useBrowserStore.getState();
    const latestJob = latestState.generationJobs[job.id];
    if (!latestJob) {
      this.#tasks.delete(job.id);
      return;
    }
    this.#tasks.set(
      job.id,
      isTauri()
        ? startTauriGeneration(latestState, latestJob, () => this.#tasks.delete(job.id))
        : startMockGeneration(latestState, latestJob, () => this.#tasks.delete(job.id)),
    );
  }

  dispose(): void {
    this.#disposed = true;
    for (const task of this.#tasks.values()) task.cancel();
    this.#tasks.clear();
  }
}

export function buildGenerationRequest(state: BrowserState, job: GenerationJob): GenerationStartInput {
  const provider = providerForJob(state, job);
  const siteWorld = job.siteWorldId ? state.siteWorlds[job.siteWorldId] : undefined;
  const sourceArtifact = job.sourceArtifactId ? state.artifacts[job.sourceArtifactId] : undefined;
  const requestUrl = job.normalizedUrl
    ?? syntheticUrlForPrompt(job.requestedUrl, siteWorld?.origin, job.id);
  const settings = job.generationSettingsSnapshot;
  const relevantHistory = settings.privacy.includeNavigationHistory
    ? siteWorld?.visitedPageSummaries.slice(-8) ?? []
    : [];

  return {
    jobId: job.id,
    profileId: job.profileId,
    ...(provider.connection?.secretRef ? { credentialRef: provider.connection.secretRef } : {}),
    request: {
      url: requestUrl,
      profileId: job.profileId,
      siteWorldId: job.siteWorldId,
      conceptPrompt: job.normalizedUrl ? undefined : job.requestedUrl,
      browserTheme: job.browserTheme,
      provider: {
        connectionId: provider.connection?.id ?? provider.kind,
        id: provider.connection?.id ?? provider.kind,
        kind: provider.kind,
        modelId: stripProviderPrefix(job.modelId),
        generationMode: settings.strategy === "turbo" ? "compact" : "directed",
        ...(job.reasoningEffort ? { reasoningEffort: job.reasoningEffort } : {}),
        ...(job.serviceTier ? { serviceTier: job.serviceTier } : {}),
        ...(provider.connection?.baseUrl ? { baseUrl: provider.connection.baseUrl } : {}),
      },
      modelId: stripProviderPrefix(job.modelId),
      worldPromptSnapshot: job.worldPromptSnapshot,
      settings: { ...settings, motionEnabled: job.motionEnabled },
      context: {
        siteWorld,
        sourcePage: sourceArtifact
          ? {
              artifactId: sourceArtifact.id,
              url: sourceArtifact.url,
              title: sourceArtifact.title,
              purpose: sourceArtifact.summary,
              factsIntroduced: [],
              outboundRoutes: [],
            }
          : undefined,
        relevantHistory,
        navigationIntent: job.navigationIntent,
        parentArtifactId: job.sourceArtifactId,
        identityStrategy: job.identityStrategy,
      },
      ...(job.purpose === "lucky-urls" ? { discovery: { kind: "lucky-urls", count: 10 } } : {}),
    },
  };
}

function startTauriGeneration(
  state: BrowserState,
  job: GenerationJob,
  finished: () => void,
): GenerationTask {
  let terminal = false;
  const channel = new Channel<WireEvent>();
  channel.onmessage = (wireEvent) => {
    const event = normalizeRuntimeEvent(wireEvent, job);
    if (!event) return;
    dispatchRuntimeEvent(event);
    if (isTerminal(event)) {
      terminal = true;
      finished();
    }
  };

  void invoke<GenerationStartResult>("start_generation", {
    input: buildGenerationRequest(state, job),
    onEvent: channel,
  }).catch((error: unknown) => {
    if (terminal) return;
    dispatchRuntimeEvent({
      type: "generation.failed",
      jobId: job.id,
      error: normalizeError(error, "worker-crashed"),
    });
    finished();
  });

  return {
    cancel: () => {
      if (terminal) return;
      void invoke("cancel_generation", { jobId: job.id }).catch(() => undefined);
    },
  };
}

function startMockGeneration(
  state: BrowserState,
  job: GenerationJob,
  finished: () => void,
): GenerationTask {
  const controller = new AbortController();
  const run = async () => {
    try {
      await nextMockStep(controller.signal);
      dispatchRuntimeEvent({ type: "generation.started", jobId: job.id });
      dispatchRuntimeEvent({ type: "generation.phase", jobId: job.id, phase: "directing" });
      await nextMockStep(controller.signal);
      const title = titleForUrl(job.normalizedUrl ?? job.requestedUrl);
      dispatchRuntimeEvent({
        type: "generation.metadata",
        jobId: job.id,
        metadata: { title, favicon: title.slice(0, 1).toUpperCase(), summary: `An imagined page for ${job.normalizedUrl}` },
      });
      dispatchRuntimeEvent({ type: "generation.phase", jobId: job.id, phase: "generating" });
      await nextMockStep(controller.signal);
      dispatchRuntimeEvent({ type: "generation.phase", jobId: job.id, phase: "validating" });
      const artifact = makeMockArtifact(state, job, title);
      dispatchRuntimeEvent({ type: "generation.completed", jobId: job.id, artifact });
    } catch (error) {
      if (controller.signal.aborted) {
        dispatchRuntimeEvent({ type: "generation.cancelled", jobId: job.id });
      } else {
        dispatchRuntimeEvent({
          type: "generation.failed",
          jobId: job.id,
          error: normalizeError(error, "unknown"),
        });
      }
    } finally {
      finished();
    }
  };
  void run();
  return { cancel: () => controller.abort() };
}

export function dispatchRuntimeEvent(event: GenerationRuntimeEvent): void {
  const state = useBrowserStore.getState();
  switch (event.type) {
    case "generation.started":
      state.beginGeneration(event.jobId);
      break;
    case "generation.phase":
      state.setGenerationPhase(event.jobId, event.phase);
      break;
    case "generation.progress":
      state.setGenerationProgress(event.jobId, event.progress);
      break;
    case "generation.warning":
      state.addGenerationWarning(event.jobId, event.warning);
      break;
    case "generation.metadata":
      state.setGenerationMetadata(event.jobId, {
        provisionalTitle: event.metadata.title,
        provisionalFavicon: event.metadata.favicon,
        provisionalSummary: event.metadata.summary,
      });
      break;
    case "generation.preview":
      setGenerationPreviewFrame(event.jobId, event.html, event.revision);
      break;
    case "generation.completed":
      clearGenerationPreviewFrame(event.jobId);
      if (state.generationJobs[event.jobId]?.purpose === "lucky-urls") {
        const target = state.completeLucky(event.jobId, event.artifact);
        const completedJob = state.generationJobs[event.jobId];
        if (target && completedJob) state.navigate(completedJob.tabId, target);
        break;
      }
      if (state.commitArtifact(event.jobId, event.artifact)) {
        const committedState = useBrowserStore.getState();
        const completedJob = committedState.generationJobs[event.jobId];
        const siteWorld = committedState.siteWorlds[event.artifact.siteWorldId];
        if (completedJob && siteWorld) {
          void savePersistedSiteWorld(completedJob.profileId, siteWorld).catch(() => undefined);
        }
      }
      break;
    case "generation.failed":
      clearGenerationPreviewFrame(event.jobId);
      state.failGeneration(event.jobId, event.error);
      break;
    case "generation.cancelled":
      clearGenerationPreviewFrame(event.jobId);
      state.cancelGeneration(event.jobId);
      break;
  }
}

export function normalizeRuntimeEvent(wire: WireEvent, job: GenerationJob): GenerationRuntimeEvent | undefined {
  const nested = isRecord(wire.event) ? wire.event : undefined;
  const source = nested ?? wire;
  const wireType = stringValue(source.type);
  const jobId = stringValue(wire.jobId) ?? stringValue(source.jobId) ?? job.id;

  switch (wireType) {
    case "generation.started":
      return { type: "generation.started", jobId };
    case "generation.phase":
    case "phase.changed": {
      const phase = normalizePhase(stringValue(source.phase));
      return phase ? { type: "generation.phase", jobId, phase } : undefined;
    }
    case "generation.progress": {
      const stage = normalizeGenerationStage(stringValue(source.stage));
      const percent = numberValue(source.percent);
      if (!stage || percent === undefined) return undefined;
      const progress: GenerationProgress = {
        stage,
        stageIndex: Math.max(0, Math.trunc(numberValue(source.stageIndex) ?? 0)),
        stageCount: Math.max(1, Math.trunc(numberValue(source.stageCount) ?? 1)),
        approximate: source.approximate !== false,
        percent: Math.min(99, Math.max(0, percent)),
        emittedAt: stringValue(source.at) ?? stringValue(source.timestamp) ?? new Date().toISOString(),
      };
      const currentOutputTokens = numberValue(source.currentOutputTokens);
      const maxOutputTokens = numberValue(source.maxOutputTokens);
      if (currentOutputTokens !== undefined) progress.currentOutputTokens = Math.max(0, Math.trunc(currentOutputTokens));
      if (maxOutputTokens !== undefined) progress.maxOutputTokens = Math.max(1, Math.trunc(maxOutputTokens));
      return { type: "generation.progress", jobId, progress };
    }
    case "generation.warning": {
      const code = stringValue(source.code);
      const message = stringValue(source.message);
      return code && message ? { type: "generation.warning", jobId, warning: { code, message } } : undefined;
    }
    case "generation.stage":
      // Stage records are persisted by the host and displayed by vibe://activity.
      return undefined;
    case "generation.metadata":
    case "metadata.partial": {
      const metadata = isRecord(source.metadata) ? source.metadata : source;
      return {
        type: "generation.metadata",
        jobId,
        metadata: {
          title: stringValue(metadata.title),
          favicon: faviconSourceValue(metadata.favicon),
          summary: stringValue(metadata.summary),
        },
      };
    }
    case "generation.preview": {
      const html = stringValue(source.html) ?? stringValue(source.fragment);
      if (!html) return undefined;
      return {
        type: "generation.preview",
        jobId,
        html,
        revision: numberValue(source.revision) ?? numberValue(wire.sequence),
      };
    }
    case "generation.completed": {
      if (!isRecord(source.artifact)) return undefined;
      return { type: "generation.completed", jobId, artifact: normalizeArtifact(source.artifact, job) };
    }
    case "generation.failed": {
      const rawError = isRecord(source.error) ? source.error : source;
      return {
        type: "generation.failed",
        jobId,
        error: normalizeError(rawError, "unknown"),
      };
    }
    case "generation.cancelled":
      return { type: "generation.cancelled", jobId };
    default:
      return undefined;
  }
}

function normalizeGenerationStage(value: string | undefined): GenerationProgress["stage"] | undefined {
  switch (value) {
    case "queued":
    case "director":
    case "builder":
    case "compile":
    case "assets":
    case "finalize":
      return value;
    case "page-director":
      return "director";
    case "page-builder":
      return "builder";
    default:
      return undefined;
  }
}

function normalizeArtifact(raw: Record<string, unknown>, job: GenerationJob): PageArtifact {
  const favicon = normalizeFavicon(raw.favicon);
  const payload = isRecord(raw.payload) ? raw.payload : {};
  return {
    id: stringValue(raw.id) ?? `artifact-${job.id}`,
    profileId: job.profileId,
    url: stringValue(raw.url) ?? job.normalizedUrl ?? job.requestedUrl,
    title: stringValue(raw.title) ?? titleForUrl(job.normalizedUrl ?? job.requestedUrl),
    html: stringValue(raw.html) ?? "<!doctype html><title>Empty generated page</title>",
    summary: stringValue(raw.summary) ?? stringValue(raw.description) ?? "Generated page",
    siteWorldId: stringValue(raw.siteWorldId) ?? stringValue(raw.siteId) ?? job.siteWorldId ?? "site-unknown",
    generationJobId: stringValue(raw.generationJobId) ?? stringValue(raw.generationId) ?? job.id,
    modelId: stringValue(raw.modelId) ?? job.modelId,
    promptVersion: numberValue(raw.promptVersion) ?? 1,
    settingsFingerprint: stringValue(raw.settingsFingerprint) ?? "unknown",
    allowGeneratedScripts: raw.allowGeneratedScripts === true,
    createdAt: stringValue(raw.createdAt) ?? new Date().toISOString(),
    providerId: stringValue(raw.providerId) ?? job.providerId,
    ...(favicon ? { favicon } : {}),
    faviconUrl: stringValue(raw.faviconUrl),
    parentArtifactId: stringValue(raw.parentArtifactId) ?? job.sourceArtifactId,
    usage: isRecord(raw.usage)
      ? {
          inputTokens: numberValue(raw.usage.inputTokens),
          outputTokens: numberValue(raw.usage.outputTokens),
          totalTokens: numberValue(raw.usage.totalTokens),
          reasoningTokens: numberValue(raw.usage.reasoningTokens),
          requests: numberValue(raw.usage.requests),
        }
      : undefined,
    modelExchanges: normalizeModelExchanges(raw.modelExchanges),
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.flatMap((warning) =>
          isRecord(warning) && stringValue(warning.code) && stringValue(warning.message)
            ? [{ code: stringValue(warning.code)!, message: stringValue(warning.message)! }]
            : [],
        )
      : [],
    capabilityManifest: normalizeCapabilityManifest(raw.capabilityManifest ?? payload.capabilityManifest),
    dynamicManifest: normalizeDynamicManifest(raw.dynamicManifest ?? payload.dynamicManifest),
    sitePatch: normalizeSitePatch(raw.sitePatch ?? payload.sitePatch),
    siteIdentity: normalizeSiteIdentity(raw.siteIdentity ?? payload.siteIdentity),
    siteAdditions: isRecord(raw.siteAdditions ?? payload.siteAdditions)
      ? (raw.siteAdditions ?? payload.siteAdditions) as PageArtifact["siteAdditions"]
      : undefined,
    pageDirection: isRecord(raw.pageDirection ?? payload.pageDirection)
      ? (raw.pageDirection ?? payload.pageDirection) as PageArtifact["pageDirection"]
      : undefined,
    worldPromptSnapshot: isRecord(raw.worldPromptSnapshot ?? payload.worldPromptSnapshot)
      ? (raw.worldPromptSnapshot ?? payload.worldPromptSnapshot) as PageArtifact["worldPromptSnapshot"]
      : job.worldPromptSnapshot,
    voiceSettings: isRecord(raw.voiceSettings ?? payload.voiceSettings)
      ? (raw.voiceSettings ?? payload.voiceSettings) as PageArtifact["voiceSettings"]
      : job.generationSettingsSnapshot.voice,
  };
}

function normalizeModelExchanges(value: unknown): PageArtifact["modelExchanges"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.usage)) return [];
    const purpose = stringValue(item.purpose);
    if (!purpose || !["page-director", "page-builder", "region-builder"].includes(purpose)) return [];
    const id = stringValue(item.id);
    const providerId = stringValue(item.providerId);
    const modelId = stringValue(item.modelId);
    const actualProviderKind = stringValue(item.actualProviderKind);
    const startedAt = stringValue(item.startedAt);
    const completedAt = stringValue(item.completedAt);
    const systemPrompt = stringValue(item.systemPrompt);
    const prompt = stringValue(item.prompt);
    const response = stringValue(item.response);
    const durationMs = numberValue(item.durationMs);
    if (!id || !providerId || !modelId || !actualProviderKind || !startedAt || !completedAt
      || systemPrompt === undefined || prompt === undefined || response === undefined || durationMs === undefined) return [];
    return [{
      id,
      purpose: purpose as NonNullable<PageArtifact["modelExchanges"]>[number]["purpose"],
      providerId,
      modelId,
      actualProviderKind,
      startedAt,
      completedAt,
      durationMs,
      systemPrompt,
      prompt,
      response,
      usage: {
        inputTokens: numberValue(item.usage.inputTokens),
        outputTokens: numberValue(item.usage.outputTokens),
        totalTokens: numberValue(item.usage.totalTokens),
        reasoningTokens: numberValue(item.usage.reasoningTokens),
        requests: numberValue(item.usage.requests),
      },
    }];
  }).slice(0, 2);
}

function normalizeSitePatch(value: unknown): ArtifactSitePatch | undefined {
  if (!isRecord(value) || !isRecord(value.visualLanguage)) return undefined;
  const name = stringValue(value.name);
  const purpose = stringValue(value.purpose);
  const audience = stringValue(value.audience);
  const typography = stringValue(value.visualLanguage.typography);
  if (!name || !purpose || !audience || !typography) return undefined;
  const palette = Array.isArray(value.visualLanguage.palette)
    ? value.visualLanguage.palette.filter((color): color is string => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)).slice(0, 8)
    : [];
  const routeHints = Array.isArray(value.routeHints)
    ? value.routeHints.flatMap((item) => {
        if (!isRecord(item)) return [];
        const path = stringValue(item.path);
        const label = stringValue(item.label);
        if (!path || !label) return [];
        return [{ path: path.slice(0, 512), label: label.slice(0, 120), purpose: stringValue(item.purpose)?.slice(0, 300) }];
      }).slice(0, 30)
    : [];
  return {
    name: name.slice(0, 160),
    purpose: purpose.slice(0, 500),
    audience: audience.slice(0, 300),
    visualLanguage: {
      palette,
      typography: typography.slice(0, 200),
      density: value.visualLanguage.density === "compact" || value.visualLanguage.density === "spacious"
        ? value.visualLanguage.density
        : "comfortable",
      radius:
        value.visualLanguage.radius === "none" || value.visualLanguage.radius === "subtle" || value.visualLanguage.radius === "pill"
          ? value.visualLanguage.radius
          : "rounded",
      mood: stringValue(value.visualLanguage.mood)?.slice(0, 200),
    },
    establishedFacts: Array.isArray(value.establishedFacts)
      ? value.establishedFacts.filter((fact): fact is string => typeof fact === "string").map((fact) => fact.slice(0, 300)).slice(0, 24)
      : [],
    routeHints,
  };
}

function normalizeFavicon(value: unknown): FaviconDescriptor | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "image" && stringValue(value.src)) {
    return { kind: "image", src: stringValue(value.src)!, mimeType: stringValue(value.mimeType) };
  }
  const glyph = stringValue(value.glyph);
  if (!glyph) return undefined;
  return {
    kind: "glyph",
    glyph,
    foreground: stringValue(value.foreground) ?? "#ffffff",
    background: stringValue(value.background) ?? "#2563eb",
    shape:
      value.shape === "circle" || value.shape === "square" || value.shape === "rounded-square"
        ? value.shape
        : "rounded-square",
  };
}

function normalizePhase(value: string | undefined): GenerationPhase | undefined {
  if (!value) return undefined;
  if (ACTIVE_PHASES.has(value as GenerationPhase)) return value as GenerationPhase;
  return undefined;
}

function normalizeSiteIdentity(value: unknown): PageArtifact["siteIdentity"] {
  if (!isRecord(value)) return undefined;
  const patch = normalizeSitePatch(value);
  const favicon = normalizeFavicon(value.favicon);
  if (!patch || !favicon || favicon.kind !== "glyph" || !isRecord(value.palette) || !isRecord(value.fonts)) return undefined;
  const palette = value.palette;
  const requiredColors = ["background", "surface", "text", "mutedText", "accent", "accentText", "border"] as const;
  if (!requiredColors.every((key) => typeof palette[key] === "string")) return undefined;
  const body = stringValue(value.fonts.body);
  const heading = stringValue(value.fonts.heading);
  if (!body || !heading) return undefined;
  return {
    ...patch,
    classification: value.classification === "recognizable" ? "recognizable" : "original",
    locale: stringValue(value.locale) ?? "en",
    era: stringValue(value.era) ?? "contemporary",
    palette: Object.fromEntries(requiredColors.map((key) => [key, palette[key]])) as unknown as RolePalette,
    fonts: { body, heading, ...(stringValue(value.fonts.mono) ? { mono: stringValue(value.fonts.mono) } : {}) },
    layoutSystem: stringValue(value.layoutSystem) ?? "Page-specific layout",
    favicon,
  };
}

function tabsForProfile(state: BrowserState, profileId: string) {
  return profileId === state.activeProfileId
    ? state.tabs
    : state.profileWorkspaces[profileId]?.tabs ?? [];
}

function normalizeError(value: unknown, fallbackCode: GenerationError["code"]): GenerationError {
  const record = isRecord(value) ? value : undefined;
  const rawCode = stringValue(record?.code);
  const allowed = new Set<GenerationError["code"]>([
    "provider-not-configured",
    "invalid-api-key",
    "rate-limited",
    "provider-unavailable",
    "provider-route-required",
    "timeout",
    "cancelled",
    "malformed-output",
    "unsafe-output",
    "style-compilation-failed",
    "image-resolution-failed",
    "worker-crashed",
    "unknown",
  ]);
  const translatedCode = rawCode === "worker-error" || rawCode === "worker-failed" ? "worker-crashed" : rawCode;
  return {
    code: translatedCode && allowed.has(translatedCode as GenerationError["code"])
      ? (translatedCode as GenerationError["code"])
      : fallbackCode,
    message:
      stringValue(record?.message) ??
      (value instanceof Error ? value.message : typeof value === "string" ? value : "Generation failed"),
    retryable: typeof record?.retryable === "boolean" ? record.retryable : true,
  };
}

function providerForJob(state: BrowserState, job: GenerationJob): { kind: string; connection?: ProviderConnection } {
  const connection = state.providerConnections.find(
    (candidate) => candidate.profileId === job.profileId &&
      (candidate.id === job.providerId || candidate.modelIds.includes(job.modelId)),
  );
  if (connection) return { kind: connection.kind, connection };
  const prefix = job.modelId.split(":", 1)[0];
  return { kind: prefix === "provider" ? "openai-compatible" : prefix || "mock" };
}

function makeMockArtifact(state: BrowserState, job: GenerationJob, title: string): PageArtifact {
  const siteWorld = job.siteWorldId ? state.siteWorlds[job.siteWorldId] : undefined;
  const url = job.normalizedUrl
    ?? syntheticUrlForPrompt(job.requestedUrl, siteWorld?.origin, job.id);
  const hostname = safeUrl(url)?.hostname ?? "imagined.local";
  const links: readonly (readonly [string, string])[] = job.purpose === "lucky-urls"
    ? BROWSER_EXPERIENCE_REGISTRY[job.browserTheme].generation.mockLuckyRoutes
    : [
    ["/discover", "Discover"],
    ["/latest", "Latest"],
    ["/topics", "Topics"],
    ["/stories", "Stories"],
    ["/guides", "Guides"],
    ["/community", "Community"],
    ["/events", "Events"],
    ["/collections", "Collections"],
    ["/newsletter", "Newsletter"],
    ["/about", "About"],
    ["/help", "Help"],
    ["/account", "Account"],
    ];
  const navigation = links.map(([href, label]) => `<a href="${href}">${label}</a>`).join("");
  const cards = links
    .slice(0, 6)
    .map(
      ([href, label], index) =>
        `<article><small>0${index + 1}</small><h2>${label}</h2><p>Browse this section for more details, updates, and related pages.</p><a href="${href}">Open ${label}</a></article>`,
    )
    .join("");
  const image = job.generationSettingsSnapshot.images.enabled
    ? '<div class="image" role="img" aria-label="Editorial artwork"><span>featured</span></div>'
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}a{color:inherit}.shell{width:min(1120px,calc(100% - 32px));margin:auto}nav{display:flex;gap:18px;flex-wrap:wrap;padding:22px 0;border-bottom:1px solid #dce2ee}nav a{font-weight:650;text-decoration:none}.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:end;padding:80px 0 54px}.eyebrow,small{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.13em;color:#4263eb}h1{font-size:clamp(48px,8vw,92px);line-height:.94;letter-spacing:-.06em;margin:14px 0 24px}.lede{max-width:650px;font-size:19px;line-height:1.65;color:#526078}.image{min-height:320px;border-radius:30px;background:radial-gradient(circle at 75% 25%,#ffd8a8,transparent 32%),radial-gradient(circle at 25% 65%,#bac8ff,transparent 38%),linear-gradient(145deg,#e7f5ff,#f3d9fa);display:grid;place-items:end start;padding:24px;color:#364fc7}.image span{background:#ffffffd9;padding:8px 12px;border-radius:999px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:18px 0 80px}.grid article{background:white;border:1px solid #e1e6ef;border-radius:20px;padding:24px;box-shadow:0 12px 35px #243b6b0d}.grid h2{margin:12px 0 8px}.grid p{color:#667085;line-height:1.55}.grid a{display:inline-block;margin-top:10px;font-weight:750;color:#364fc7}footer{border-top:1px solid #dce2ee;padding:28px 0 48px;color:#667085}@media(max-width:760px){.hero{grid-template-columns:1fr;padding-top:48px}.grid{grid-template-columns:1fr}h1{font-size:52px}}</style></head><body><header class="shell"><nav aria-label="Primary">${navigation}</nav></header><main><section class="shell hero"><div><p class="eyebrow">${escapeHtml(hostname)}</p><h1>${escapeHtml(title)}</h1><p class="lede">Browse highlights, collections, and current updates from across the site.</p></div>${image}</section><section class="shell"><div class="grid">${cards}</div></section></main><footer class="shell">${escapeHtml(title)}</footer></body></html>`;
  const favicon = siteWorld?.identity.favicon ?? {
    kind: "glyph" as const,
    glyph: title.slice(0, 1).toUpperCase() || "V",
    foreground: "#ffffff",
    background: "#4263eb",
    shape: "rounded-square" as const,
  };
  const sitePatch: ArtifactSitePatch = siteWorld?.identity ?? {
    name: title,
    purpose: `A concrete fictional service for ${hostname}`,
    audience: "Curious visitors",
    visualLanguage: { palette: ["#172033", "#4263eb", "#f5f7fb"], typography: "Arimo Variable", density: "comfortable", radius: "rounded", mood: "editorial" },
    establishedFacts: [],
    routeHints: links.map(([path, label]) => ({ path, label, purpose: `Open ${label}` })),
  };
  const siteIdentity = siteWorld?.identity ?? {
    ...sitePatch,
    classification: "original" as const,
    locale: "en-US",
    era: "contemporary",
    palette: { background: "#f5f7fb", surface: "#ffffff", text: "#172033", mutedText: "#667085", accent: "#4263eb", accentText: "#ffffff", border: "#dce2ee" },
    fonts: { body: "Arimo Variable", heading: "Source Sans 3 Variable", mono: "Cousine" },
    layoutSystem: "Responsive editorial directory",
    favicon,
  };
  const completedAt = new Date().toISOString();
  const modelExchanges: NonNullable<PageArtifact["modelExchanges"]> = (["page-director", "page-builder"] as const).map((purpose, index) => ({
    id: `${job.id}-${purpose}`,
    purpose,
    providerId: "mock",
    modelId: job.modelId,
    actualProviderKind: "mock",
    startedAt: job.startedAt ?? job.createdAt,
    completedAt,
    durationMs: index + 1,
    systemPrompt: "Deterministic browser-preview protocol",
    prompt: `${purpose} for ${url}`,
    response: purpose === "page-director" ? JSON.stringify({ identity: siteIdentity }) : JSON.stringify({ title }),
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 1 },
  }));
  return {
    id: `artifact-${job.id}`,
    profileId: job.profileId,
    url,
    title,
    html,
    summary: `A landing page for ${hostname}.`,
    siteWorldId: job.siteWorldId ?? `site-${hostname}`,
    generationJobId: job.id,
    modelId: job.modelId,
    promptVersion: job.generationSettingsSnapshot.promptVersion,
    settingsFingerprint: "web-mock-v1",
    allowGeneratedScripts: false,
    createdAt: new Date().toISOString(),
    providerId: "mock",
    favicon,
    parentArtifactId: job.sourceArtifactId,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 2 },
    modelExchanges,
    warnings: [],
    sitePatch: job.purpose === "lucky-urls" ? {
      name: "Unmapped routes",
      purpose: "Private route discovery",
      audience: "The current wanderer",
      visualLanguage: {
        palette: ["#0b0b14", "#9c8cff", "#71defc"],
        typography: "Browser-native",
      },
      establishedFacts: [],
      routeHints: links.map(([path, label]) => ({ path, label, purpose: `Discover ${label}` })),
    } : sitePatch,
    siteIdentity,
    worldPromptSnapshot: job.worldPromptSnapshot,
  };
}

function canReuseCachedPage(job: GenerationJob): boolean {
  return job.purpose !== "lucky-urls"
    && job.generationSettingsSnapshot.reuseCachedPages
    && Boolean(job.normalizedUrl)
    && job.navigationIntent.trigger !== "regenerate"
    && job.navigationIntent.trigger !== "reload";
}

function latestCachedArtifact(state: BrowserState, job: GenerationJob): PageArtifact | undefined {
  if (!job.normalizedUrl) return undefined;
  const url = canonicalCacheUrl(job.normalizedUrl);
  return Object.values(state.artifacts)
    .filter((artifact) =>
      (artifact.profileId ?? job.profileId) === job.profileId
      && artifact.siteWorldId === job.siteWorldId
      && canonicalCacheUrl(artifact.url) === url)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function canonicalCacheUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

function titleForUrl(value: string): string {
  const url = safeUrl(value);
  if (!url) return "Imagined page";
  const brand = url.hostname
    .replace(/^www\./, "")
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const path = url.pathname.split("/").filter(Boolean).join(" · ");
  return path ? `${brand} — ${path}` : brand || "Imagined page";
}

function syntheticUrlForPrompt(prompt: string, siteOrigin: string | undefined, jobId: string): string {
  const slug = prompt
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "concept";
  const stableJob = jobId.replace(/[^a-zA-Z0-9-]/g, "").slice(-24) || "page";
  const origin = (siteOrigin ? safeUrl(siteOrigin)?.origin : undefined) ?? "https://generated.vibe.local";
  return `${origin}/${slug}?generation=${stableJob}`;
}

function stripProviderPrefix(modelId: string): string {
  const separator = modelId.indexOf(":");
  return separator >= 0 ? modelId.slice(separator + 1) : modelId;
}

function isTerminal(event: GenerationRuntimeEvent): boolean {
  return event.type === "generation.completed" || event.type === "generation.failed" || event.type === "generation.cancelled";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function nextMockStep(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, 35);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}
