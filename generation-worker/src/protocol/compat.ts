import {
  GenerateCommandSchema,
  PublicProviderConnectionSchema,
  type GenerateCommand,
  type HostGenerateCommand,
  type ProviderCredentials,
  type ProviderVerifyCommand,
  type PublicProviderConnection,
} from "./types.js";
import {
  PageSummarySchema,
  SiteWorldSchema,
  type PageSummary,
  type ProviderKind,
  type SiteWorld,
} from "../domain.js";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(number(value) ?? fallback)));
}

function normalizeHttpUrl(value: unknown, fallback = "https://example.test/"): string {
  const raw = string(value) ?? fallback;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS virtual URLs are supported.");
  }
  return url.href;
}

function normalizeProviderKind(value: unknown, id?: string, baseUrl?: string): ProviderKind {
  const candidate = string(value)?.toLowerCase();
  if (
    candidate === "mock" ||
    candidate === "openai" ||
    candidate === "anthropic" ||
    candidate === "google" ||
    candidate === "openai-compatible" ||
    candidate === "codex"
  ) {
    return candidate;
  }
  if (candidate === "local") {
    return baseUrl ? "openai-compatible" : "mock";
  }
  if (id?.toLowerCase().includes("codex")) {
    return "codex";
  }
  const normalizedId = id?.toLowerCase() ?? "";
  if (normalizedId.includes("anthropic") || normalizedId.includes("claude")) return "anthropic";
  if (normalizedId.includes("google") || normalizedId.includes("gemini")) return "google";
  if (normalizedId.includes("openai-compatible")) return "openai-compatible";
  if (normalizedId.includes("openai") || normalizedId.includes("gpt")) return "openai";
  return "mock";
}

export interface NormalizedProvider {
  connection: PublicProviderConnection;
  credentials?: ProviderCredentials;
  modelId: string;
  reasoningEffort?: string;
  serviceTier?: string;
}

export function normalizeProvider(
  value: unknown,
  credential?: string,
  fallbackModelId?: string,
): NormalizedProvider {
  const provider = typeof value === "string" ? { id: value, kind: value } : record(value);
  const baseUrl = string(provider.baseUrl ?? provider.baseURL);
  const id = string(provider.connectionId ?? provider.id ?? provider.providerId) ?? "mock";
  const kind = normalizeProviderKind(provider.kind ?? provider.type, id, baseUrl);
  const modelIds = Array.isArray(provider.modelIds) ? provider.modelIds : [];
  const firstModelId = modelIds.map(string).find(Boolean);
  const modelId = string(provider.modelId ?? fallbackModelId) ?? firstModelId ?? "mock-v1";
  const reasoningEffort = string(provider.reasoningEffort ?? provider.effort);
  const serviceTier = string(provider.serviceTier ?? provider.speed);
  const connection = PublicProviderConnectionSchema.parse({
    id,
    kind,
    displayName: string(provider.displayName ?? provider.name) ?? id,
    ...(baseUrl ? { baseUrl: normalizeHttpUrl(baseUrl) } : {}),
    supportsStructuredOutputs: boolean(provider.supportsStructuredOutputs) ?? true,
    generationMode: provider.generationMode === "compact" || provider.generationMode === "directed"
      ? provider.generationMode
      : kind === "openai-compatible" ? "compact" : "directed",
    mockLatencyMs: number(provider.mockLatencyMs) ?? 0,
  });
  return {
    connection,
    ...(credential ? { credentials: { apiKey: credential } } : {}),
    modelId,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {}),
  };
}

function normalizePageSummary(value: unknown): PageSummary | undefined {
  const input = record(value);
  const parsed = PageSummarySchema.safeParse({
    artifactId: string(input.artifactId) ?? "unknown-artifact",
    url: normalizeHttpUrl(input.url),
    title: string(input.title) ?? "Untitled",
    purpose: string(input.purpose) ?? "Previously generated page",
    factsIntroduced: Array.isArray(input.factsIntroduced)
      ? input.factsIntroduced.map(string).filter((item): item is string => Boolean(item)).slice(0, 16)
      : [],
    outboundRoutes: Array.isArray(input.outboundRoutes)
      ? input.outboundRoutes.map(string).filter((item): item is string => Boolean(item)).slice(0, 40)
      : [],
  });
  return parsed.success ? parsed.data : undefined;
}

function normalizeSiteWorld(
  value: unknown,
  fallbackProfileId: string,
  fallbackPromptSnapshot: { revision: number; prompt: string },
): SiteWorld | undefined {
  const input = record(value);
  if (Object.keys(input).length === 0) {
    return undefined;
  }
  const visual = record(input.visualLanguage);
  const rawRoutes = Array.isArray(input.routeHints)
    ? input.routeHints
    : Array.isArray(input.informationArchitecture)
      ? input.informationArchitecture
      : [];
  const routes = rawRoutes
    .map((item) => {
      const route = record(item);
      const path = string(route.path);
      const label = string(route.label);
      if (!path || !label) return undefined;
      return { path, label, purpose: string(route.purpose) ?? `Navigate to ${label}` };
    })
    .filter((item): item is { path: string; label: string; purpose: string } => Boolean(item));
  if (routes.length < 4) {
    return undefined;
  }
  const palette = Array.isArray(visual.palette)
    ? visual.palette.map(string).filter((item): item is string => /^#[0-9a-f]{6}$/i.test(item ?? "")).slice(0, 8)
    : [];
  const origin = normalizeHttpUrl(input.origin);
  const identity = record(input.identity);
  const identityVisual = record(identity.visualLanguage);
  const identityPalette = record(identity.palette);
  const identityFonts = record(identity.fonts);
  const promptSnapshot = record(input.promptSnapshot);
  const now = new Date().toISOString();
  const first = palette[0] ?? "#0f172a";
  const second = palette[1] ?? "#2563eb";
  const third = palette[2] ?? "#f8fafc";
  const parsed = SiteWorldSchema.safeParse({
    id: string(input.id) ?? `site-${new URL(origin).hostname}`,
    profileId: string(input.profileId) ?? fallbackProfileId,
    origin: new URL(origin).origin,
    state: input.state === "archived" ? "archived" : "active",
    revision: Math.max(0, Math.round(number(input.revision) ?? 0)),
    promptSnapshot: {
      revision: Math.max(0, Math.round(number(promptSnapshot.revision) ?? fallbackPromptSnapshot.revision)),
      prompt: string(promptSnapshot.prompt) ?? fallbackPromptSnapshot.prompt,
    },
    identity: {
      classification: identity.classification === "recognizable" ? "recognizable" : "original",
      locale: string(identity.locale) ?? "en",
      era: string(identity.era) ?? "contemporary",
      name: string(identity.name ?? input.name) ?? new URL(origin).hostname,
      purpose: string(identity.purpose ?? input.purpose) ?? "A coherent fictional website",
      audience: string(identity.audience ?? input.audience) ?? "General visitors",
      visualLanguage: {
        palette: (Array.isArray(identityVisual.palette)
          ? identityVisual.palette.map(string).filter((item): item is string => /^#[0-9a-f]{6}$/i.test(item ?? ""))
          : palette.length >= 2 ? palette : [first, second, third]).slice(0, 8),
        typography: string(identityVisual.typography ?? visual.typography) ?? "Arimo Variable",
        density: ["compact", "comfortable", "spacious"].includes(string(identityVisual.density ?? visual.density) ?? "")
          ? string(identityVisual.density ?? visual.density)
          : "comfortable",
        radius: ["none", "subtle", "rounded", "pill"].includes(string(identityVisual.radius ?? visual.radius) ?? "")
          ? string(identityVisual.radius ?? visual.radius)
          : "rounded",
        mood: string(identityVisual.mood ?? visual.mood ?? visual.tone) ?? "clear and contemporary",
      },
      palette: {
        background: string(identityPalette.background) ?? third,
        surface: string(identityPalette.surface) ?? "#ffffff",
        text: string(identityPalette.text) ?? first,
        mutedText: string(identityPalette.mutedText) ?? "#64748b",
        accent: string(identityPalette.accent) ?? second,
        accentText: string(identityPalette.accentText) ?? "#ffffff",
        border: string(identityPalette.border) ?? "#cbd5e1",
      },
      fonts: {
        body: string(identityFonts.body) ?? "Arimo Variable",
        heading: string(identityFonts.heading) ?? "Arimo Variable",
        ...(string(identityFonts.mono) ? { mono: string(identityFonts.mono) } : {}),
      },
      layoutSystem: string(identity.layoutSystem) ?? "Responsive page-specific layout",
      favicon: record(identity.favicon).kind === "glyph"
        ? identity.favicon
        : { kind: "glyph", glyph: new URL(origin).hostname[0]?.toUpperCase() ?? "•", foreground: "#ffffff", background: second, shape: "rounded-square" },
      establishedFacts: Array.isArray(identity.establishedFacts ?? input.establishedFacts)
        ? ((identity.establishedFacts ?? input.establishedFacts) as unknown[]).map(string).filter((item): item is string => Boolean(item)).slice(0, 24)
        : [],
      routeHints: routes.slice(0, 30),
    },
    pageSummaries: Array.isArray(input.pageSummaries ?? input.visitedPageSummaries)
      ? ((input.pageSummaries ?? input.visitedPageSummaries) as unknown[]).map(normalizePageSummary).filter(Boolean).slice(0, 100)
      : [],
    createdAt: string(input.createdAt) ?? now,
    updatedAt: string(input.updatedAt) ?? now,
    ...(string(input.archivedAt) ? { archivedAt: string(input.archivedAt) } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

function normalizeImageMode(settings: Record<string, unknown>): "off" | "local" | "tag-placeholder" {
  if (boolean(settings.enabled) === false) {
    return "off";
  }
  const mode = string(settings.mode ?? settings.provider);
  return mode === "off" ? "off" : "tag-placeholder";
}

export interface NormalizedHostGeneration {
  command: GenerateCommand;
  connection: PublicProviderConnection;
  credentials?: ProviderCredentials;
}

export function normalizeHostGeneration(input: HostGenerateCommand): NormalizedHostGeneration {
  const request = input.request;
  const settings = record(request.settings);
  const style = record(settings.style);
  const images = record(settings.images);
  const context = record(request.context);
  const rawNavigation = record(context.navigationIntent ?? request.navigationIntent);
  const trigger = string(rawNavigation.kind ?? rawNavigation.trigger) ?? "address";
  const navigationKind = trigger === "form" ? "form" : trigger === "link" ? "link" : trigger === "regenerate" ? "regenerate" : "address";
  const profileId = string(request.profileId) ?? "personal";
  const rawPromptSnapshot = record(request.worldPromptSnapshot);
  const worldPromptSnapshot = {
    revision: Math.max(0, Math.round(number(rawPromptSnapshot.revision) ?? 0)),
    vibe: (string(rawPromptSnapshot.vibe) ?? "").slice(0, 1_000),
    prompt: string(rawPromptSnapshot.prompt ?? request.editableInstruction ?? settings.customInstruction) ?? "",
  };
  const siteWorld = normalizeSiteWorld(context.siteWorld ?? request.siteWorld, profileId, worldPromptSnapshot);
  const historySource = Array.isArray(context.relevantHistory)
    ? context.relevantHistory
    : Array.isArray(request.relevantHistory)
      ? request.relevantHistory
      : Array.isArray(record(request.siteWorld).visitedPageSummaries)
        ? (record(request.siteWorld).visitedPageSummaries as unknown[])
        : [];
  const relevantHistory = historySource
    .map(normalizePageSummary)
    .filter((item): item is PageSummary => Boolean(item))
    .slice(0, 8);
  const sourcePage = normalizePageSummary(context.sourcePage ?? request.sourcePage);

  const providerValue = request.provider ?? {
    id: request.providerId,
    kind: request.providerKind,
    baseUrl: request.baseUrl,
    modelId: request.modelId,
  };
  const normalizedProvider = normalizeProvider(providerValue, input.credential, string(request.modelId));
  const url = normalizeHttpUrl(request.url ?? request.requestedUrl);
  const imageMode = normalizeImageMode(images);

  const command = GenerateCommandSchema.parse({
    v: 1,
    type: "generate",
    requestId: input.requestId,
    jobId: input.jobId,
    profileId,
    siteWorldId: string(request.siteWorldId) ?? siteWorld?.id ?? `site-${new URL(url).hostname}`,
    url,
    browserTheme: request.browserTheme,
    ...(record(request.discovery).kind === "lucky-urls"
      ? { discovery: { kind: "lucky-urls", count: 10 } }
      : {}),
    provider: {
      connectionId: normalizedProvider.connection.id,
      modelId: normalizedProvider.modelId,
      ...(normalizedProvider.reasoningEffort
        ? { reasoningEffort: normalizedProvider.reasoningEffort }
        : {}),
      ...(normalizedProvider.serviceTier ? { serviceTier: normalizedProvider.serviceTier } : {}),
    },
    worldPromptSnapshot,
    settings: {
      tailwindEnabled: boolean(settings.tailwindEnabled ?? style.tailwindEnabled) ?? true,
      tailwindVersion: string(settings.tailwindVersion ?? style.tailwindVersion) ?? "4.3.3",
      allowGeneratedScripts: boolean(settings.allowGeneratedScripts ?? style.allowGeneratedScripts) ?? false,
      motionEnabled: boolean(settings.motionEnabled ?? style.motionEnabled) ?? true,
      images: {
        mode: imageMode,
        fetchExternal: imageMode === "tag-placeholder"
          && (boolean(images.fetchExternal ?? images.allowExternalRequests) ?? true),
        safeContent: boolean(images.safeContent) ?? true,
      },
      maxOutputTokens: integerInRange(settings.maxOutputTokens, 20_000, 512, 100_000),
      minInternalLinks: integerInRange(settings.minInternalLinks, 4, 4, 30),
      maxArtifactBytes: integerInRange(settings.maxArtifactBytes, 1_000_000, 32_000, 2_000_000),
    },
    context: {
      ...(siteWorld ? { siteWorld } : {}),
      ...(sourcePage ? { sourcePage } : {}),
      relevantHistory,
      navigationIntent: {
        kind: navigationKind,
        disposition:
          rawNavigation.disposition === "background-tab" || rawNavigation.disposition === "foreground-tab"
            ? rawNavigation.disposition
            : "current",
        anchorText: string(
          rawNavigation.anchorText
            ?? rawNavigation.linkText
            ?? request.conceptPrompt
            ?? (navigationKind === "address" ? rawNavigation.requestedUrl : undefined),
        )?.slice(0, 300) ?? "",
        ariaLabel: string(rawNavigation.ariaLabel) ?? "",
        linkContext: string(rawNavigation.linkContext) ?? "",
        surroundingText: string(rawNavigation.surroundingText) ?? "",
        ...(string(rawNavigation.sourceUrl) ? { sourceUrl: normalizeHttpUrl(rawNavigation.sourceUrl) } : {}),
        ...(record(rawNavigation.formFields) && Object.keys(record(rawNavigation.formFields)).length > 0
          ? { formFields: record(rawNavigation.formFields) }
          : {}),
      },
      ...(string(context.parentArtifactId ?? request.parentArtifactId ?? rawNavigation.sourceArtifactId)
        ? { parentArtifactId: string(context.parentArtifactId ?? request.parentArtifactId ?? rawNavigation.sourceArtifactId) }
        : {}),
      identityStrategy:
        context.identityStrategy === "reimagine" || request.identityStrategy === "reimagine"
          ? "reimagine"
          : context.identityStrategy === "create" || request.identityStrategy === "create"
            ? "create"
            : "reuse",
    },
  });

  return {
    command,
    connection: normalizedProvider.connection,
    ...(normalizedProvider.credentials ? { credentials: normalizedProvider.credentials } : {}),
  };
}

export function normalizeProviderVerification(input: ProviderVerifyCommand): NormalizedProvider {
  return normalizeProvider(input.provider, input.credential, string(input.provider.modelId));
}
