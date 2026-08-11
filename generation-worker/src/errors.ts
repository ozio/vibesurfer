import { z } from "zod";

import { UnsafeOutputError } from "./pipelines/index.js";
import { ProviderConfigurationError, ProviderRouteRequiredError } from "./providers/registry.js";
import type { GenerationErrorCode } from "./protocol/types.js";

export interface NormalizedError {
  code: GenerationErrorCode;
  message: string;
  retryable: boolean;
}
function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = Reflect.get(error, "statusCode") ?? Reflect.get(error, "status");
  return typeof candidate === "number" ? candidate : undefined;
}

function errorName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const name = Reflect.get(error, "name");
  return typeof name === "string" ? name : "";
}

export function isAbortError(error: unknown): boolean {
  return errorName(error) === "AbortError";
}

export function normalizeError(error: unknown): NormalizedError {
  if (isAbortError(error)) {
    return { code: "cancelled", message: "Generation was cancelled.", retryable: false };
  }
  if (error instanceof ProviderRouteRequiredError) {
    return { code: "provider-route-required", message: error.message, retryable: false };
  }
  if (error instanceof ProviderConfigurationError) {
    return { code: "provider-not-configured", message: error.message, retryable: false };
  }
  if (error instanceof UnsafeOutputError) {
    return { code: "unsafe-output", message: error.message, retryable: true };
  }
  if (error instanceof z.ZodError || ["NoObjectGeneratedError", "AI_NoObjectGeneratedError"].includes(errorName(error))) {
    return {
      code: "malformed-output",
      message: "The provider returned output that did not match the required page schema.",
      retryable: true,
    };
  }

  const status = statusCode(error);
  if (status === 401 || status === 403) {
    return { code: "invalid-api-key", message: "The provider rejected the configured credential.", retryable: false };
  }
  if (status === 429) {
    return { code: "rate-limited", message: "The provider rate limit was reached.", retryable: true };
  }
  if (status !== undefined && status >= 500) {
    return { code: "provider-unavailable", message: "The provider is temporarily unavailable.", retryable: true };
  }
  if (["TimeoutError", "AI_TimeoutError"].includes(errorName(error))) {
    return { code: "timeout", message: "The generation request timed out.", retryable: true };
  }
  if (["APICallError", "AI_APICallError"].includes(errorName(error))) {
    return { code: "provider-unavailable", message: "The provider request failed.", retryable: true };
  }

  return {
    code: "worker-error",
    message: "The generation worker could not complete the request.",
    retryable: false,
  };
}
