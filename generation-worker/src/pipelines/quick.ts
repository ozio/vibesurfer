import { PageResultSchema } from "../domain.js";
import { buildPrompt } from "../prompt-builder.js";
import { EMPTY_USAGE } from "../providers/executor.js";
import { compilePage, extractPartialMetadata } from "./shared.js";
import { type PipelineContext, type PipelineResult, UnsafeOutputError } from "./types.js";

export async function runQuickPipeline(context: PipelineContext): Promise<PipelineResult> {
  const { request, executor, signal, emit } = context;
  await emit.phase("preparing-context", 0.08);
  const prompt = buildPrompt({
    stage: "quick-page",
    url: request.url,
    mode: request.mode,
    settings: request.settings,
    editableInstruction: request.editableInstruction,
    context: request.context,
  });

  await emit.phase("generating", 0.2);
  const generated = await executor.generateObject({
    purpose: "quick-page",
    schema: PageResultSchema,
    prompt,
    abortSignal: signal,
    maxOutputTokens: request.settings.maxOutputTokens,
    onPartial: async (partial) => {
      const metadata = extractPartialMetadata(partial);
      if (Object.keys(metadata).length > 0) {
        await emit.metadata(metadata);
      }
    },
  });

  await emit.phase("validating", 0.72);
  const compiled = await compilePage({
    request,
    executor,
    page: generated.output,
    usage: generated.usage ?? EMPTY_USAGE,
    signal,
    emit,
  });
  await emit.validation(compiled.issues, false);
  if (compiled.issues.some((issue) => issue.severity === "error")) {
    throw new UnsafeOutputError(compiled.issues);
  }
  await emit.phase("committing", 0.94);
  return { artifact: compiled.artifact, usage: generated.usage };
}
