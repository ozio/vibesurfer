import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/platform";
import { useBrowserStore, type BrowserState } from "../store/browser-store";
import { savePersistedSiteWorld } from "./host-api";
import type {
  FaviconDescriptor,
  ArtifactSitePatch,
  GenerationError,
  GenerationJob,
  GenerationPhase,
  GenerationRuntimeEvent,
  PageArtifact,
  ProviderConnection,
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
  "planning",
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
      const tab = state.tabs.find((candidate) => candidate.id === job.tabId);
      if (tab?.generationJobId !== job.id) continue;

      const placeholder: GenerationTask = { cancel: () => undefined };
      this.#tasks.set(job.id, placeholder);
      if (!useBrowserStore.getState().beginGeneration(job.id)) {
        this.#tasks.delete(job.id);
        continue;
      }

      const latestState = useBrowserStore.getState();
      const latestJob = latestState.generationJobs[job.id];
      if (!latestJob) {
        this.#tasks.delete(job.id);
        continue;
      }
      this.#tasks.set(
        job.id,
        isTauri()
          ? startTauriGeneration(latestState, latestJob, () => this.#tasks.delete(job.id))
          : startMockGeneration(latestState, latestJob, () => this.#tasks.delete(job.id)),
      );
    }
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
  const relevantHistory = state.generationSettings.privacy.includeNavigationHistory
    ? siteWorld?.visitedPageSummaries.slice(-8) ?? []
    : [];

  return {
    jobId: job.id,
    profileId: job.profileId,
    ...(provider.connection?.secretRef ? { credentialRef: provider.connection.secretRef } : {}),
    request: {
      url: requestUrl,
      conceptPrompt: job.normalizedUrl ? undefined : job.requestedUrl,
      mode: job.mode,
      provider: {
        connectionId: provider.connection?.id ?? provider.kind,
        id: provider.connection?.id ?? provider.kind,
        kind: provider.kind,
        modelId: stripProviderPrefix(job.modelId),
        ...(provider.connection?.baseUrl ? { baseUrl: provider.connection.baseUrl } : {}),
      },
      modelId: stripProviderPrefix(job.modelId),
      editableInstruction: state.generationSettings.customInstruction,
      settings: state.generationSettings,
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
      },
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
      dispatchRuntimeEvent({ type: "generation.phase", jobId: job.id, phase: "planning" });
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
    case "generation.metadata":
      state.setGenerationMetadata(event.jobId, {
        provisionalTitle: event.metadata.title,
        provisionalFavicon: event.metadata.favicon,
        provisionalSummary: event.metadata.summary,
      });
      break;
    case "generation.preview":
      state.setGenerationPreview(event.jobId, event.html, event.revision);
      break;
    case "generation.completed":
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
      state.failGeneration(event.jobId, event.error);
      break;
    case "generation.cancelled":
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
    case "generation.metadata":
    case "metadata.partial": {
      const metadata = isRecord(source.metadata) ? source.metadata : source;
      return {
        type: "generation.metadata",
        jobId,
        metadata: {
          title: stringValue(metadata.title),
          favicon: faviconValue(metadata.favicon),
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

function normalizeArtifact(raw: Record<string, unknown>, job: GenerationJob): PageArtifact {
  const favicon = normalizeFavicon(raw.favicon);
  return {
    id: stringValue(raw.id) ?? `artifact-${job.id}`,
    url: stringValue(raw.url) ?? job.normalizedUrl ?? job.requestedUrl,
    title: stringValue(raw.title) ?? titleForUrl(job.normalizedUrl ?? job.requestedUrl),
    html: stringValue(raw.html) ?? "<!doctype html><title>Empty generated page</title>",
    summary: stringValue(raw.summary) ?? stringValue(raw.description) ?? "Generated page",
    siteWorldId: stringValue(raw.siteWorldId) ?? stringValue(raw.siteId) ?? job.siteWorldId ?? "site-unknown",
    generationJobId: stringValue(raw.generationJobId) ?? stringValue(raw.generationId) ?? job.id,
    modelId: stringValue(raw.modelId) ?? job.modelId,
    mode: raw.mode === "deep" ? "deep" : job.mode,
    promptVersion: numberValue(raw.promptVersion) ?? 1,
    settingsFingerprint: stringValue(raw.settingsFingerprint) ?? "unknown",
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
        }
      : undefined,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.flatMap((warning) =>
          isRecord(warning) && stringValue(warning.code) && stringValue(warning.message)
            ? [{ code: stringValue(warning.code)!, message: stringValue(warning.message)! }]
            : [],
        )
      : [],
    sitePatch: normalizeSitePatch(raw.sitePatch),
  };
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
  if (value === "planning-site" || value === "planning-page" || value === "repairing") return value === "repairing" ? "validating" : "planning";
  return undefined;
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
  const links = [
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
        `<article><small>0${index + 1}</small><h2>${label}</h2><p>A plausible part of this invented site, ready to become its own generated page.</p><a href="${href}">Open ${label}</a></article>`,
    )
    .join("");
  const image = state.generationSettings.images.enabled
    ? '<div class="image" role="img" aria-label="Abstract editorial placeholder"><span>imagined image</span></div>'
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}a{color:inherit}.shell{width:min(1120px,calc(100% - 32px));margin:auto}nav{display:flex;gap:18px;flex-wrap:wrap;padding:22px 0;border-bottom:1px solid #dce2ee}nav a{font-weight:650;text-decoration:none}.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:end;padding:80px 0 54px}.eyebrow,small{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.13em;color:#4263eb}h1{font-size:clamp(48px,8vw,92px);line-height:.94;letter-spacing:-.06em;margin:14px 0 24px}.lede{max-width:650px;font-size:19px;line-height:1.65;color:#526078}.image{min-height:320px;border-radius:30px;background:radial-gradient(circle at 75% 25%,#ffd8a8,transparent 32%),radial-gradient(circle at 25% 65%,#bac8ff,transparent 38%),linear-gradient(145deg,#e7f5ff,#f3d9fa);display:grid;place-items:end start;padding:24px;color:#364fc7}.image span{background:#ffffffd9;padding:8px 12px;border-radius:999px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:18px 0 80px}.grid article{background:white;border:1px solid #e1e6ef;border-radius:20px;padding:24px;box-shadow:0 12px 35px #243b6b0d}.grid h2{margin:12px 0 8px}.grid p{color:#667085;line-height:1.55}.grid a{display:inline-block;margin-top:10px;font-weight:750;color:#364fc7}footer{border-top:1px solid #dce2ee;padding:28px 0 48px;color:#667085}@media(max-width:760px){.hero{grid-template-columns:1fr;padding-top:48px}.grid{grid-template-columns:1fr}h1{font-size:52px}}</style></head><body><header class="shell"><nav aria-label="Primary">${navigation}</nav></header><main><section class="shell hero"><div><p class="eyebrow">Network-free preview</p><h1>${escapeHtml(title)}</h1><p class="lede">This is a coherent fictional page imagined from <strong>${escapeHtml(url)}</strong>. Every route below asks VibeSurfer to generate the next page instead of contacting ${escapeHtml(hostname)}.</p></div>${image}</section><section class="shell"><div class="grid">${cards}</div></section></main><footer class="shell">Generated locally for development. The live origin was not contacted.</footer></body></html>`;
  return {
    id: `artifact-${job.id}`,
    url,
    title,
    html,
    summary: `A fictional landing page for ${hostname}.`,
    siteWorldId: job.siteWorldId ?? `site-${hostname}`,
    generationJobId: job.id,
    modelId: job.modelId,
    mode: job.mode,
    promptVersion: state.generationSettings.promptVersion,
    settingsFingerprint: "web-mock-v1",
    createdAt: new Date().toISOString(),
    providerId: "mock",
    favicon: {
      kind: "glyph",
      glyph: title.slice(0, 1).toUpperCase() || "V",
      foreground: "#ffffff",
      background: "#4263eb",
      shape: "rounded-square",
    },
    parentArtifactId: job.sourceArtifactId,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  };
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

function faviconValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  return stringValue(value.glyph) ?? stringValue(value.src);
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
