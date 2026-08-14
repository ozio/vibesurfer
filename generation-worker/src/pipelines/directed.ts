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

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertDirectionMatchesIdentity(direction: DirectorResult["direction"], identity: SiteIdentity): void {
  const immutablePairs: Array<[string, unknown, unknown]> = [
    ["classification", direction.siteClassification, identity.classification],
    ["locale", direction.locale, identity.locale],
    ["era", direction.era, identity.era],
    ["palette", direction.palette, identity.palette],
    ["fonts", direction.fonts, identity.fonts],
    ["favicon", direction.favicon, identity.favicon],
    ["density", direction.density, identity.visualLanguage.density],
    ["layout", direction.layout, identity.layoutSystem],
  ];
  const changed = immutablePairs.find(([, proposed, canonical]) => !same(proposed, canonical));
  if (changed) {
    throw new Error(`Director attempted to change immutable SiteIdentity field: ${changed[0]}`);
  }
}

function alignNewDirectionWithIdentity(
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
  const director = await executor.generateObject({
    purpose: "page-director",
    schema: existingWorld ? ExistingSiteDirectorResultSchema : NewSiteDirectorResultSchema,
    prompt: directorPrompt,
    abortSignal: signal,
    maxOutputTokens: Math.min(request.settings.maxOutputTokens, 12_000),
  });
  usage = addUsage(usage, director.usage);
  modelExchanges.push(director.exchange);

  const result = director.output as DirectorResult;
  const identity = existingWorld?.identity ?? result.identity;
  if (!identity) throw new Error("Director did not return a SiteIdentity for a new origin.");
  const direction = existingWorld
    ? result.direction
    : alignNewDirectionWithIdentity(result.direction, identity);
  if (existingWorld) assertDirectionMatchesIdentity(direction, identity);
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
  const page = await executor.generateObject({
    purpose: "page-builder",
    schema: PageResultSchema,
    prompt: builderPrompt,
    abortSignal: signal,
    maxOutputTokens: request.settings.maxOutputTokens,
    onPartial: preview.handle,
  });
  await preview.flush();
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
