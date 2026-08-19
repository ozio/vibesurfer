import { createHash, randomUUID } from "node:crypto";

import {
  GENERATION_PROMPT_VERSION,
  type ApprovedPageBrief,
  type ArtifactWarning,
  type ModelExchange,
  type PageArtifact,
  type PageResult,
  type TokenUsage,
} from "../domain.js";
import { transformHtml, transformPreviewHtml } from "../html/transform.js";
import { validateHtml } from "../html/validate.js";
import type { ModelExecutor } from "../providers/executor.js";
import type { GenerateCommand } from "../protocol/types.js";
import type { PipelineEmitter } from "./types.js";

export interface CompilePageInput {
  request: GenerateCommand;
  executor: ModelExecutor;
  page: PageResult;
  approvedBrief: ApprovedPageBrief;
  usage: TokenUsage;
  modelExchanges: ModelExchange[];
  signal: AbortSignal;
  emit: PipelineEmitter;
}

export interface CompiledPage {
  artifact: PageArtifact;
  issues: ReturnType<typeof validateHtml>["issues"];
}

function settingsFingerprint(request: GenerateCommand, generationMode: ModelExecutor["generationMode"]): string {
  return createHash("sha256")
    .update(String(GENERATION_PROMPT_VERSION))
    .update("\0")
    .update(JSON.stringify(request.settings))
    .update("\0")
    .update(request.browserTheme)
    .update("\0")
    .update(JSON.stringify(request.worldPromptSnapshot))
    .update("\0")
    .update(generationMode ?? "directed")
    .digest("hex");
}

export async function compilePage(input: CompilePageInput): Promise<CompiledPage> {
  const artifactId = randomUUID();
  const transformed = await transformHtml({
    html: input.page.html,
    url: input.request.url,
    title: input.page.meta.title,
    settings: input.request.settings,
    selectedIconSet: input.approvedBrief.direction.iconSet,
    selectedCapabilities: input.approvedBrief.direction.selectedCapabilities,
    browserTheme: input.request.browserTheme,
    artifactSeed: artifactId,
    signal: input.signal,
    onPhase: async (phase) => {
      await input.emit.phase(phase, phase === "compiling-styles" ? 0.78 : 0.84);
    },
  });
  for (const warning of transformed.warnings) {
    await input.emit.warning(warning);
  }

  const validation = validateHtml(transformed.html, input.request.url, input.request.settings);
  const warnings: ArtifactWarning[] = [
    ...transformed.warnings,
    ...validation.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => ({ code: issue.code, message: issue.message })),
  ];
  const identity = input.approvedBrief.identity;
  const patch = {
    name: identity.name,
    purpose: identity.purpose,
    audience: identity.audience,
    visualLanguage: identity.visualLanguage,
    establishedFacts: [...new Set([...identity.establishedFacts, ...input.approvedBrief.additions.facts])].slice(0, 24),
    routeHints: [...identity.routeHints, ...input.approvedBrief.additions.routes]
      .filter((route, index, routes) => routes.findIndex((candidate) => candidate.path === route.path) === index)
      .slice(0, 30),
  };
  const artifact: PageArtifact = {
    id: artifactId,
    url: input.request.url,
    title: input.page.meta.title,
    description: input.page.meta.description,
    favicon: identity.favicon,
    html: transformed.html,
    summary: input.page.meta.pageSummary,
    siteId: input.request.siteWorldId,
    ...(input.request.context.parentArtifactId
      ? { parentArtifactId: input.request.context.parentArtifactId }
      : {}),
    generationId: input.request.jobId,
    providerId: input.executor.providerId,
    modelId: input.executor.modelId,
    actualProviderKind: input.executor.actualProviderKind,
    promptVersion: GENERATION_PROMPT_VERSION,
    settingsFingerprint: settingsFingerprint(input.request, input.executor.generationMode),
    allowGeneratedScripts: input.request.settings.allowGeneratedScripts,
    createdAt: new Date().toISOString(),
    usage: input.usage,
    modelExchanges: input.modelExchanges,
    warnings,
    sitePatch: patch,
    payload: {
      description: input.page.meta.description,
      summary: input.page.meta.pageSummary,
      favicon: identity.favicon,
      sitePatch: patch,
      siteIdentity: identity,
      pageDirection: input.approvedBrief.direction,
      siteAdditions: input.approvedBrief.additions,
      worldPromptSnapshot: input.request.context.siteWorld?.promptSnapshot ?? input.request.worldPromptSnapshot,
      generationId: input.request.jobId,
      providerId: input.executor.providerId,
      modelId: input.executor.modelId,
      ...(input.request.provider.reasoningEffort
        ? { reasoningEffort: input.request.provider.reasoningEffort }
        : {}),
      ...(input.request.provider.serviceTier
        ? { serviceTier: input.request.provider.serviceTier }
        : {}),
      actualProviderKind: input.executor.actualProviderKind,
      pipeline: input.executor.generationMode === "compact" ? "compact" : "directed",
      promptVersion: GENERATION_PROMPT_VERSION,
      settingsFingerprint: settingsFingerprint(input.request, input.executor.generationMode),
      allowGeneratedScripts: input.request.settings.allowGeneratedScripts,
      usage: input.usage,
      modelExchanges: input.modelExchanges,
      warnings,
      capabilityManifest: transformed.capabilityManifest,
      ...(input.request.context.parentArtifactId
        ? { parentArtifactId: input.request.context.parentArtifactId }
        : {}),
    },
    capabilityManifest: transformed.capabilityManifest,
  };

  return { artifact, issues: validation.issues };
}

export function extractPartialMetadata(partial: unknown): {
  title?: string;
  summary?: string;
} {
  if (typeof partial !== "object" || partial === null || !("meta" in partial)) {
    return {};
  }
  const meta = Reflect.get(partial, "meta");
  if (typeof meta !== "object" || meta === null) {
    return {};
  }
  const title = Reflect.get(meta, "title");
  const summary = Reflect.get(meta, "pageSummary");
  return {
    ...(typeof title === "string" ? { title: title.slice(0, 240) } : {}),
    ...(typeof summary === "string" ? { summary: summary.slice(0, 1_000) } : {}),
  };
}

export function extractPartialHtml(partial: unknown): string | undefined {
  if (typeof partial !== "object" || partial === null || !("html" in partial)) {
    return undefined;
  }
  const html = Reflect.get(partial, "html");
  return typeof html === "string" && html.length > 0 ? html : undefined;
}

const PREVIEW_FRAME_INTERVAL_MS = 32;

export function createProgressivePagePreview(
  input: Pick<CompilePageInput, "request" | "emit"> & Partial<Pick<CompilePageInput, "approvedBrief">>,
): {
  handle(partial: unknown): Promise<void>;
  flush(): Promise<void>;
} {
  let latestHtml: string | undefined;
  let latestTitle: string | undefined;
  let lastRenderedHtml = "";
  let lastRenderedAt = 0;
  let scheduledRender: Promise<void> | undefined;

  const renderLatest = async () => {
    if (!latestHtml || latestHtml === lastRenderedHtml) return;
    const html = latestHtml;
    const title = latestTitle;
    try {
      const preview = await transformPreviewHtml({
        html,
        url: input.request.url,
        title: title ?? new URL(input.request.url).hostname,
        settings: input.request.settings,
        selectedIconSet: input.approvedBrief?.direction.iconSet ?? null,
        selectedCapabilities: input.approvedBrief?.direction.selectedCapabilities ?? [],
        browserTheme: input.request.browserTheme,
      });
      await input.emit.preview(preview);
      lastRenderedHtml = html;
      lastRenderedAt = Date.now();
    } catch {
      // A partial token stream is allowed to be temporarily unparsable. The
      // next accumulated chunk gets another chance; final validation remains
      // authoritative.
      lastRenderedHtml = html;
      lastRenderedAt = Date.now();
    }
  };

  const scheduleTrailingRender = () => {
    if (scheduledRender) return;
    const delay = Math.max(0, PREVIEW_FRAME_INTERVAL_MS - (Date.now() - lastRenderedAt));
    scheduledRender = new Promise<void>((resolve) => setTimeout(resolve, delay))
      .then(renderLatest)
      .finally(() => {
        scheduledRender = undefined;
        if (latestHtml && latestHtml !== lastRenderedHtml) scheduleTrailingRender();
      });
  };

  return {
    async handle(partial) {
      const metadata = extractPartialMetadata(partial);
      if (metadata.title) latestTitle = metadata.title;
      if (Object.keys(metadata).length > 0) {
        await input.emit.metadata(metadata);
      }
      latestHtml = extractPartialHtml(partial) ?? latestHtml;
      if (!latestHtml) return;
      if (!lastRenderedHtml) {
        await renderLatest();
      } else {
        scheduleTrailingRender();
      }
    },
    async flush() {
      while (scheduledRender) await scheduledRender;
      await renderLatest();
    },
  };
}
