import type { PipelineContext, PipelineResult } from "./types.js";
import { runDirectedPipeline } from "./directed.js";

export async function runGenerationPipeline(context: PipelineContext): Promise<PipelineResult> {
  return runDirectedPipeline(context);
}

export { UnsafeOutputError, type PipelineContext, type PipelineEmitter, type PipelineResult } from "./types.js";
