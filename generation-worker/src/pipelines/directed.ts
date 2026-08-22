import {
  ExistingSiteDirectorResultSchema,
  NewSiteDirectorResultSchema,
  PageResultSchema,
  type ApprovedPageBrief,
  type DirectorResult,
  type ModelExchange,
  type SiteIdentity,
} from "../domain.js";
import { approveCapabilitySelection, buildPrompt } from "../prompt-builder.js";
import { addUsage, EMPTY_USAGE } from "../providers/executor.js";
import { compilePage, createProgressivePagePreview } from "./shared.js";
import { type PipelineContext, type PipelineResult, UnsafeOutputError } from "./types.js";

function alignDirectionWithIdentity(
  direction: DirectorResult["direction"],
  identity: SiteIdentity,
): DirectorResult["direction"] {
  return {
    ...direction,
    siteClassification: identity.classification,
    locale: identity.locale,
    era: identity.era,
    palette: identity.palette,
    fonts: identity.fonts,
    favicon: identity.favicon,
    density: identity.visualLanguage.density,
    layout: identity.layoutSystem,
  };
}

export async function runDirectedPipeline(context: PipelineContext): Promise<PipelineResult> {
  const { request, executor, signal, emit } = context;
  let usage = EMPTY_USAGE;
  const modelExchanges: ModelExchange[] = [];
  const existingWorld = request.context.identityStrategy === "reuse" ? request.context.siteWorld : undefined;
  const promptSnapshot = existingWorld?.promptSnapshot ?? request.worldPromptSnapshot;
  const directorContext = existingWorld
    ? request.context
    : { ...request.context, siteWorld: undefined };

  await emit.phase("preparing-context", 0.05);
  await emit.phase("directing", 0.16);
  const directorPrompt = buildPrompt({
    stage: "page-director",
    url: request.url,
    browserTheme: request.browserTheme,
    settings: request.settings,
    worldPromptSnapshot: promptSnapshot,
    context: directorContext,
    ...(request.discovery ? { discovery: request.discovery } : {}),
  });
  const directorStartedAt = new Date().toISOString();
  await emit.stage?.({
    stage: "page-director",
    status: "running",
    startedAt: directorStartedAt,
    payload: { systemPrompt: directorPrompt.system, prompt: directorPrompt.prompt, maxOutputTokens: Math.min(request.settings.maxOutputTokens, 12_000) },
  });
  await emit.progress?.({ stage: "director", stageIndex: 1, stageCount: 2, currentOutputTokens: 0, maxOutputTokens: Math.min(request.settings.maxOutputTokens, 12_000), approximate: true, percent: 1 });
  const director = await executor.generateObject({
    purpose: "page-director",
    schema: existingWorld ? ExistingSiteDirectorResultSchema : NewSiteDirectorResultSchema,
    prompt: directorPrompt,
    abortSignal: signal,
    maxOutputTokens: Math.min(request.settings.maxOutputTokens, 12_000),
    onPartial: async (partial) => {
      const currentOutputTokens = estimateOutputTokens(partial);
      const maximum = Math.min(request.settings.maxOutputTokens, 12_000);
      await emit.progress?.({ stage: "director", stageIndex: 1, stageCount: 2, currentOutputTokens, maxOutputTokens: maximum, approximate: true, percent: weightedPercent(1, 19, currentOutputTokens, maximum) });
    },
  });
  await emit.stage?.({ stage: "page-director", status: "completed", startedAt: director.exchange.startedAt, completedAt: director.exchange.completedAt, payload: director.exchange as unknown as Record<string, unknown> });
  await emit.progress?.({ stage: "director", stageIndex: 1, stageCount: 2, currentOutputTokens: director.usage.outputTokens, maxOutputTokens: Math.min(request.settings.maxOutputTokens, 12_000), approximate: false, percent: 20 });
  usage = addUsage(usage, director.usage);
  modelExchanges.push(director.exchange);

  const result = director.output as DirectorResult;
  const identity = existingWorld?.identity ?? result.identity;
  if (!identity) throw new Error("Director did not return a SiteIdentity for a new origin.");
  // The structured Director schema repeats identity-owned fields inside the
  // page direction. Models can echo those fields with harmless formatting or
  // color differences even when explicitly told they are frozen. Treat the
  // persisted SiteIdentity as authoritative instead of failing the whole page.
  const direction = {
    ...alignDirectionWithIdentity(result.direction, identity),
    iconSet: request.settings.capabilities.iconsEnabled ? result.direction.iconSet : null,
  };
  const selectedCapabilityContracts = approveCapabilitySelection(
    request.settings,
    request.browserTheme,
    direction.fonts,
    direction.selectedCapabilities,
  );
  const approvedBrief: ApprovedPageBrief = {
    identity,
    direction,
    additions: result.additions,
    selectedCapabilityContracts,
  };
  await emit.metadata({ favicon: identity.favicon });

  await emit.phase("generating", 0.42);
  const builderPrompt = buildPrompt({
    stage: "page-builder",
    url: request.url,
    browserTheme: request.browserTheme,
    settings: request.settings,
    worldPromptSnapshot: promptSnapshot,
    context: directorContext,
    approvedBrief,
    ...(request.discovery ? { discovery: request.discovery } : {}),
  });
  const preview = createProgressivePagePreview({ request, emit, approvedBrief });
  const builderStartedAt = new Date().toISOString();
  await emit.stage?.({
    stage: "page-builder",
    status: "running",
    startedAt: builderStartedAt,
    payload: { systemPrompt: builderPrompt.system, prompt: builderPrompt.prompt, maxOutputTokens: request.settings.maxOutputTokens },
  });
  await emit.progress?.({ stage: "builder", stageIndex: 2, stageCount: 2, currentOutputTokens: 0, maxOutputTokens: request.settings.maxOutputTokens, approximate: true, percent: 20 });
  const page = await executor.generateObject({
    purpose: "page-builder",
    schema: PageResultSchema,
    prompt: builderPrompt,
    abortSignal: signal,
    maxOutputTokens: request.settings.maxOutputTokens,
    onPartial: async (partial) => {
      await preview.handle(partial);
      const currentOutputTokens = estimateOutputTokens(partial);
      await emit.progress?.({ stage: "builder", stageIndex: 2, stageCount: 2, currentOutputTokens, maxOutputTokens: request.settings.maxOutputTokens, approximate: true, percent: weightedPercent(20, 65, currentOutputTokens, request.settings.maxOutputTokens) });
    },
  });
  await preview.flush();
  await emit.stage?.({ stage: "page-builder", status: "completed", startedAt: page.exchange.startedAt, completedAt: page.exchange.completedAt, payload: page.exchange as unknown as Record<string, unknown> });
  await emit.progress?.({ stage: "builder", stageIndex: 2, stageCount: 2, currentOutputTokens: page.usage.outputTokens, maxOutputTokens: request.settings.maxOutputTokens, approximate: false, percent: 85 });
  usage = addUsage(usage, page.usage);
  modelExchanges.push(page.exchange);

  await emit.phase("validating", 0.7);
  const compiled = await compilePage({
    request,
    executor,
    page: page.output,
    approvedBrief,
    usage,
    modelExchanges,
    signal,
    emit,
  });
  await emit.validation(compiled.issues);
  if (compiled.issues.some((issue) => issue.severity === "error")) {
    throw new UnsafeOutputError(compiled.issues);
  }
  await emit.phase("committing", 0.96);
  return { artifact: compiled.artifact, usage };
}

function estimateOutputTokens(value: unknown): number {
  try {
    return Math.max(0, Math.ceil(JSON.stringify(value).length / 4));
  } catch {
    return 0;
  }
}

function weightedPercent(start: number, span: number, current: number, maximum: number): number {
  return Math.min(start + span - 1, Math.max(start, Math.round(start + Math.min(1, current / Math.max(1, maximum)) * span)));
}
