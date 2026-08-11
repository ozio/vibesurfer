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
  const connection = PublicProviderConnectionSchema.parse({
    id,
    kind,
    displayName: string(provider.displayName ?? provider.name) ?? id,
    ...(baseUrl ? { baseUrl: normalizeHttpUrl(baseUrl) } : {}),
    supportsStructuredOutputs: boolean(provider.supportsStructuredOutputs) ?? true,
    mockLatencyMs: number(provider.mockLatencyMs) ?? 0,
  });
  return {
    connection,
    ...(credential ? { credentials: { apiKey: credential } } : {}),
    modelId,
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

function normalizeSiteWorld(value: unknown): SiteWorld | undefined {
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
  const parsed = SiteWorldSchema.safeParse({
    id: string(input.id) ?? `site-${new URL(origin).hostname}`,
    origin: new URL(origin).origin,
    revision: Math.max(0, Math.round(number(input.revision) ?? 0)),
    name: string(input.name) ?? new URL(origin).hostname,
    purpose: string(input.purpose) ?? "A coherent fictional website",
    audience: string(input.audience) ?? "General visitors",
    visualLanguage: {
      palette: palette.length >= 2 ? palette : ["#0f172a", "#2563eb", "#f8fafc"],
      typography: string(visual.typography) ?? "Humanist sans serif",
      density: ["compact", "comfortable", "spacious"].includes(string(visual.density) ?? "")
        ? string(visual.density)
        : "comfortable",
      radius: ["none", "subtle", "rounded", "pill"].includes(string(visual.radius) ?? "")
        ? string(visual.radius)
        : "rounded",
      mood: string(visual.mood ?? visual.tone) ?? "clear and contemporary",
    },
    establishedFacts: Array.isArray(input.establishedFacts)
      ? input.establishedFacts.map(string).filter((item): item is string => Boolean(item)).slice(0, 24)
      : [],
    routeHints: routes.slice(0, 30),
  });
  return parsed.success ? parsed.data : undefined;
}

function normalizeImageMode(settings: Record<string, unknown>): "off" | "local" | "tag-placeholder" {
  if (boolean(settings.enabled) === false) {
    return "off";
  }
  const mode = string(settings.mode ?? settings.provider);
  return mode === "off" ? "off" : mode === "tag-placeholder" ? "tag-placeholder" : "local";
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
  const siteWorld = normalizeSiteWorld(context.siteWorld ?? request.siteWorld);
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
  const mode = request.mode === "deep" ? "deep" : "quick";
  const requestedMaxRequests = integerInRange(settings.maxRequests, 4, 1, 4);

  const command = GenerateCommandSchema.parse({
    v: 1,
    type: "generate",
    requestId: input.requestId,
    jobId: input.jobId,
    url,
    mode,
    provider: {
      connectionId: normalizedProvider.connection.id,
      modelId: normalizedProvider.modelId,
    },
    editableInstruction: string(request.editableInstruction ?? settings.customInstruction) ?? "",
    settings: {
      tailwindEnabled: boolean(settings.tailwindEnabled ?? style.tailwindEnabled) ?? true,
      tailwindVersion: string(settings.tailwindVersion ?? style.tailwindVersion) ?? "4.3.3",
      images: {
        mode: normalizeImageMode(images),
        fetchExternal: boolean(images.fetchExternal ?? images.allowExternalRequests) ?? false,
        safeContent: boolean(images.safeContent) ?? true,
      },
      autoRepair: boolean(settings.autoRepair) ?? true,
      maxRequests: mode === "deep" ? Math.max(3, requestedMaxRequests) : requestedMaxRequests,
      maxOutputTokens: integerInRange(settings.maxOutputTokens, 20_000, 512, 100_000),
      minInternalLinks: integerInRange(settings.minInternalLinks, 12, 4, 30),
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
        surroundingText: string(rawNavigation.surroundingText) ?? "",
        ...(string(rawNavigation.sourceUrl) ? { sourceUrl: normalizeHttpUrl(rawNavigation.sourceUrl) } : {}),
        ...(record(rawNavigation.formFields) && Object.keys(record(rawNavigation.formFields)).length > 0
          ? { formFields: record(rawNavigation.formFields) }
          : {}),
      },
      ...(string(context.parentArtifactId ?? request.parentArtifactId ?? rawNavigation.sourceArtifactId)
        ? { parentArtifactId: string(context.parentArtifactId ?? request.parentArtifactId ?? rawNavigation.sourceArtifactId) }
        : {}),
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
