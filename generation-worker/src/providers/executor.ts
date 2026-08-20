import { randomUUID } from "node:crypto";

import { Output, streamText, type LanguageModel, type LanguageModelUsage } from "ai";
import type { z } from "zod";

import type { ModelExchange, ProviderKind, TokenUsage } from "../domain.js";
import type { PromptBundle, PromptStage } from "../prompt-builder.js";

export interface GenerateObjectRequest<T> {
  purpose: PromptStage | "region-builder";
  schema: z.ZodType<T>;
  prompt: PromptBundle;
  abortSignal: AbortSignal;
  maxOutputTokens: number;
  onPartial?: (partial: unknown) => void | Promise<void>;
}

export interface GeneratedObject<T> {
  output: T;
  usage: TokenUsage;
  exchange: ModelExchange;
}

export type GenerationMode = "directed" | "compact";

export interface GenerateTextRequest {
  purpose: PromptStage | "region-builder";
  prompt: PromptBundle;
  abortSignal: AbortSignal;
  maxOutputTokens: number;
  onPartialText?: (accumulatedText: string) => void | Promise<void>;
}

export interface GeneratedText {
  text: string;
  usage: TokenUsage;
  exchange: ModelExchange;
}

export interface ModelExecutor {
  readonly actualProviderKind: ProviderKind;
  readonly providerId: string;
  readonly modelId: string;
  readonly generationMode?: GenerationMode;
  generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>>;
  generateText?(request: GenerateTextRequest): Promise<GeneratedText>;
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeUsage(usage: LanguageModelUsage): TokenUsage {
  const inputTokens = count(usage.inputTokens);
  const outputTokens = count(usage.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: count(usage.totalTokens) || inputTokens + outputTokens,
    requests: 1,
  };
}

export class AiSdkModelExecutor implements ModelExecutor {
  readonly actualProviderKind: ProviderKind;
  readonly providerId: string;
  readonly modelId: string;
  readonly generationMode: GenerationMode;

  constructor(
    private readonly model: LanguageModel,
    descriptor: {
      providerId: string;
      modelId: string;
      actualProviderKind: ProviderKind;
      generationMode?: GenerationMode;
    },
  ) {
    this.providerId = descriptor.providerId;
    this.modelId = descriptor.modelId;
    this.actualProviderKind = descriptor.actualProviderKind;
    this.generationMode = descriptor.generationMode ?? "directed";
  }

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    const startedAt = new Date();
    let streamFailure: unknown;
    const result = streamText({
      model: this.model,
      system: request.prompt.system,
      prompt: request.prompt.prompt,
      output: Output.object({
        schema: request.schema,
        name: `vibesurfer_${request.purpose.replaceAll("-", "_")}`,
        description: "A strictly validated vibesurfer generation-stage result.",
      }),
      maxOutputTokens: request.maxOutputTokens,
      abortSignal: request.abortSignal,
      maxRetries: 1,
      onError: ({ error }) => {
        // Intentionally do not log provider errors: they can include request metadata.
        streamFailure = error;
      },
    });

    try {
      for await (const partial of result.partialOutputStream) {
        if (request.onPartial) {
          await request.onPartial(partial);
        }
      }
      if (streamFailure) {
        throw streamFailure;
      }
      const [output, usage, responseText] = await Promise.all([result.output, result.totalUsage, result.text]);
      const normalizedUsage = normalizeUsage(usage);
      const completedAt = new Date();
      return {
        output,
        usage: normalizedUsage,
        exchange: createModelExchange({
          request,
          providerId: this.providerId,
          modelId: this.modelId,
          actualProviderKind: this.actualProviderKind,
          startedAt,
          completedAt,
          response: responseText || JSON.stringify(output, null, 2),
          usage: normalizedUsage,
        }),
      };
    } catch (error) {
      throw streamFailure ?? error;
    }
  }

  async generateText(request: GenerateTextRequest): Promise<GeneratedText> {
    const startedAt = new Date();
    let streamFailure: unknown;
    let accumulatedText = "";
    const result = streamText({
      model: this.model,
      system: request.prompt.system,
      prompt: request.prompt.prompt,
      maxOutputTokens: request.maxOutputTokens,
      abortSignal: request.abortSignal,
      maxRetries: 1,
      onError: ({ error }) => {
        streamFailure = error;
      },
    });

    try {
      for await (const chunk of result.textStream) {
        accumulatedText += chunk;
        if (request.onPartialText) {
          await request.onPartialText(accumulatedText);
        }
      }
      if (streamFailure) throw streamFailure;
      const usage = normalizeUsage(await result.totalUsage);
      const completedAt = new Date();
      return {
        text: accumulatedText,
        usage,
        exchange: createModelExchange({
          request,
          providerId: this.providerId,
          modelId: this.modelId,
          actualProviderKind: this.actualProviderKind,
          startedAt,
          completedAt,
          response: accumulatedText,
          usage,
        }),
      };
    } catch (error) {
      throw streamFailure ?? error;
    }
  }
}

interface ModelExchangeInput {
  request: Pick<GenerateObjectRequest<unknown>, "purpose" | "prompt">;
  providerId: string;
  modelId: string;
  actualProviderKind: ProviderKind;
  startedAt: Date;
  completedAt: Date;
  response: string;
  usage: TokenUsage;
}

export function createModelExchange(input: ModelExchangeInput): ModelExchange {
  return {
    id: randomUUID(),
    purpose: input.request.purpose,
    providerId: input.providerId,
    modelId: input.modelId,
    actualProviderKind: input.actualProviderKind,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs: Math.max(0, input.completedAt.getTime() - input.startedAt.getTime()),
    systemPrompt: input.request.prompt.system,
    prompt: input.request.prompt.prompt,
    response: input.response,
    usage: input.usage,
  };
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    requests: left.requests + right.requests,
  };
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  requests: 0,
};
