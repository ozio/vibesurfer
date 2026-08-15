import type { PipelineContext, PipelineResult } from "./types.js";
import { runDirectedPipeline } from "./directed.js";
import { runCompactPipeline } from "./compact.js";

export async function runGenerationPipeline(context: PipelineContext): Promise<PipelineResult> {
  if (context.executor.generationMode === "compact") {
    return runCompactPipeline(context);
  }
  return runDirectedPipeline(context);
}

export { UnsafeOutputError, type PipelineContext, type PipelineEmitter, type PipelineResult } from "./types.js";
