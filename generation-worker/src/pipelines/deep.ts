import { PagePlanSchema, PageResultSchema, SiteArchitectureSchema } from "../domain.js";
import { buildPrompt } from "../prompt-builder.js";
import { addUsage, EMPTY_USAGE } from "../providers/executor.js";
import { compilePage, extractPartialMetadata } from "./shared.js";
import { type PipelineContext, type PipelineResult, UnsafeOutputError } from "./types.js";

export async function runDeepPipeline(context: PipelineContext): Promise<PipelineResult> {
  const { request, executor, signal, emit } = context;
  let usage = EMPTY_USAGE;

  await emit.phase("preparing-context", 0.05);
  await emit.phase("planning-site", 0.12);
  const architecturePrompt = buildPrompt({
    stage: "site-architect",
    url: request.url,
    mode: request.mode,
    settings: request.settings,
    editableInstruction: request.editableInstruction,
    context: request.context,
  });
  const architecture = await executor.generateObject({
    purpose: "site-architect",
    schema: SiteArchitectureSchema,
    prompt: architecturePrompt,
    abortSignal: signal,
    maxOutputTokens: Math.min(request.settings.maxOutputTokens, 6_000),
  });
  usage = addUsage(usage, architecture.usage);
  await emit.metadata({ favicon: architecture.output.favicon });

  await emit.phase("planning-page", 0.3);
  const planPrompt = buildPrompt({
    stage: "page-planner",
    url: request.url,
    mode: request.mode,
    settings: request.settings,
    editableInstruction: request.editableInstruction,
    context: request.context,
    architecture: architecture.output,
  });
  const plan = await executor.generateObject({
    purpose: "page-planner",
    schema: PagePlanSchema,
    prompt: planPrompt,
    abortSignal: signal,
    maxOutputTokens: Math.min(request.settings.maxOutputTokens, 8_000),
  });
  usage = addUsage(usage, plan.usage);
  await emit.metadata({ title: plan.output.title });

  await emit.phase("generating", 0.48);
  const buildPagePrompt = buildPrompt({
    stage: "page-builder",
    url: request.url,
    mode: request.mode,
    settings: request.settings,
    editableInstruction: request.editableInstruction,
    context: request.context,
    architecture: architecture.output,
    pagePlan: plan.output,
  });
  let page = await executor.generateObject({
    purpose: "page-builder",
    schema: PageResultSchema,
    prompt: buildPagePrompt,
    abortSignal: signal,
    maxOutputTokens: request.settings.maxOutputTokens,
    onPartial: async (partial) => {
      const metadata = extractPartialMetadata(partial);
      if (Object.keys(metadata).length > 0) {
        await emit.metadata(metadata);
      }
    },
  });
  usage = addUsage(usage, page.usage);

  await emit.phase("validating", 0.7);
  let compiled = await compilePage({
    request,
    executor,
    page: page.output,
    sitePatch: architecture.output.sitePatch,
    usage,
    signal,
    emit,
  });
  const hasErrors = compiled.issues.some((issue) => issue.severity === "error");
  const repairWillRun = hasErrors && request.settings.autoRepair && usage.requests < request.settings.maxRequests;
  await emit.validation(compiled.issues, repairWillRun);

  if (repairWillRun) {
    await emit.phase("repairing", 0.82);
    const repairPrompt = buildPrompt({
      stage: "page-repair",
      url: request.url,
      mode: request.mode,
      settings: request.settings,
      editableInstruction: request.editableInstruction,
      context: request.context,
      architecture: architecture.output,
      pagePlan: plan.output,
      brokenHtml: page.output.html,
      validationErrors: compiled.issues
        .filter((issue) => issue.severity === "error")
        .map(({ code, message }) => ({ code, message })),
    });
    page = await executor.generateObject({
      purpose: "page-repair",
      schema: PageResultSchema,
      prompt: repairPrompt,
      abortSignal: signal,
      maxOutputTokens: request.settings.maxOutputTokens,
    });
    usage = addUsage(usage, page.usage);
    compiled = await compilePage({
      request,
      executor,
      page: page.output,
      sitePatch: architecture.output.sitePatch,
      usage,
      signal,
      emit,
    });
    await emit.validation(compiled.issues, false);
  }

  if (compiled.issues.some((issue) => issue.severity === "error")) {
    throw new UnsafeOutputError(compiled.issues);
  }
  await emit.phase("committing", 0.96);
  return { artifact: compiled.artifact, usage };
}
