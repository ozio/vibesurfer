import type {
  ArtifactWarning,
  FaviconDescriptor,
  GenerationPhase,
  HtmlIssue,
  PageArtifact,
  TokenUsage,
} from "../domain.js";
import type { GenerateCommand } from "../protocol/types.js";
import type { ModelExecutor } from "../providers/executor.js";

export interface PipelineEmitter {
  phase(phase: GenerationPhase, progress: number): void | Promise<void>;
  metadata(metadata: { title?: string; favicon?: FaviconDescriptor; summary?: string }): void | Promise<void>;
  preview(html: string): void | Promise<void>;
  validation(issues: HtmlIssue[]): void | Promise<void>;
  warning(warning: ArtifactWarning): void | Promise<void>;
}
export interface PipelineContext {
  request: GenerateCommand;
  executor: ModelExecutor;
  signal: AbortSignal;
  emit: PipelineEmitter;
}

export interface PipelineResult {
  artifact: PageArtifact;
  usage: TokenUsage;
}

export class UnsafeOutputError extends Error {
  readonly issues: HtmlIssue[];

  constructor(issues: HtmlIssue[]) {
    super("The page did not pass document validation.");
    this.name = "UnsafeOutputError";
    this.issues = issues;
  }
}
