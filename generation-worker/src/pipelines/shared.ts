import { createHash, randomUUID } from "node:crypto";

import {
  GENERATION_PROMPT_VERSION,
  type ArtifactWarning,
  type PageArtifact,
  type PageResult,
  type SiteWorldPatch,
  type TokenUsage,
} from "../domain.js";
import { transformHtml } from "../html/transform.js";
import { validateHtml } from "../html/validate.js";
import type { ModelExecutor } from "../providers/executor.js";
import type { GenerateCommand } from "../protocol/types.js";
import type { PipelineEmitter } from "./types.js";

export interface CompilePageInput {
  request: GenerateCommand;
  executor: ModelExecutor;
  page: PageResult;
  sitePatch?: SiteWorldPatch;
  usage: TokenUsage;
  signal: AbortSignal;
  emit: PipelineEmitter;
}

export interface CompiledPage {
  artifact: PageArtifact;
  issues: ReturnType<typeof validateHtml>["issues"];
}

function stableSiteId(request: GenerateCommand): string {
  if (request.context.siteWorld?.id) {
    return request.context.siteWorld.id;
  }
  const origin = new URL(request.url).origin;
  return `site_${createHash("sha256").update(origin).digest("hex").slice(0, 24)}`;
}

function settingsFingerprint(request: GenerateCommand): string {
  return createHash("sha256")
    .update(String(GENERATION_PROMPT_VERSION))
    .update("\0")
    .update(JSON.stringify(request.settings))
    .update("\0")
    .update(request.editableInstruction)
    .digest("hex");
}

export async function compilePage(input: CompilePageInput): Promise<CompiledPage> {
  const artifactId = randomUUID();
  const transformed = await transformHtml({
    html: input.page.html,
    url: input.request.url,
    title: input.page.meta.title,
    settings: input.request.settings,
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
  const patch = input.sitePatch ?? input.page.meta.sitePatch;
  const artifact: PageArtifact = {
    id: artifactId,
    url: input.request.url,
    title: input.page.meta.title,
    description: input.page.meta.description,
    favicon: input.page.meta.favicon,
    html: transformed.html,
    summary: input.page.meta.pageSummary,
    siteId: stableSiteId(input.request),
    ...(input.request.context.parentArtifactId
      ? { parentArtifactId: input.request.context.parentArtifactId }
      : {}),
    generationId: input.request.jobId,
    providerId: input.executor.providerId,
    modelId: input.executor.modelId,
    actualProviderKind: input.executor.actualProviderKind,
    mode: input.request.mode,
    promptVersion: GENERATION_PROMPT_VERSION,
    settingsFingerprint: settingsFingerprint(input.request),
    createdAt: new Date().toISOString(),
    usage: input.usage,
    warnings,
    sitePatch: patch,
    payload: {
      description: input.page.meta.description,
      summary: input.page.meta.pageSummary,
      favicon: input.page.meta.favicon,
      sitePatch: patch,
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
      mode: input.request.mode,
      promptVersion: GENERATION_PROMPT_VERSION,
      settingsFingerprint: settingsFingerprint(input.request),
      usage: input.usage,
      warnings,
      ...(input.request.context.parentArtifactId
        ? { parentArtifactId: input.request.context.parentArtifactId }
        : {}),
    },
  };

  return { artifact, issues: validation.issues };
}

export function extractPartialMetadata(partial: unknown): {
  title?: string;
  favicon?: PageResult["meta"]["favicon"];
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
  const favicon = Reflect.get(meta, "favicon");
  const summary = Reflect.get(meta, "pageSummary");
  return {
    ...(typeof title === "string" ? { title: title.slice(0, 240) } : {}),
    ...(typeof favicon === "object" && favicon !== null
      ? { favicon: favicon as PageResult["meta"]["favicon"] }
      : {}),
    ...(typeof summary === "string" ? { summary: summary.slice(0, 1_000) } : {}),
  };
}
