import type { PipelineContext, PipelineResult } from "./types.js";
import { runDeepPipeline } from "./deep.js";
import { runQuickPipeline } from "./quick.js";

export async function runGenerationPipeline(context: PipelineContext): Promise<PipelineResult> {
  return context.request.mode === "deep" ? runDeepPipeline(context) : runQuickPipeline(context);
}

export { UnsafeOutputError, type PipelineContext, type PipelineEmitter, type PipelineResult } from "./types.js";
