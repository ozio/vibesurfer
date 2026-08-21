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
  progress?(progress: {
    stage: "director" | "builder" | "compile" | "assets" | "finalize";
    stageIndex: number;
    stageCount: number;
    currentOutputTokens?: number;
    maxOutputTokens?: number;
    approximate: boolean;
    percent: number;
  }): void | Promise<void>;
  stage?(record: {
    stage: "page-director" | "page-builder" | "region-builder";
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt?: string;
    payload: Record<string, unknown>;
  }): void | Promise<void>;
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
    const errors = issues.filter((issue) => issue.severity === "error");
    super(errors.length > 0
      ? `The page did not pass document validation: ${errors.map((issue) => issue.message).join(" ")}`
      : "The page did not pass document validation.");
    this.name = "UnsafeOutputError";
    this.issues = issues;
  }
}
