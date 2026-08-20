import { describe, expect, it } from "vitest";

import { normalizeError } from "../src/errors.js";

function apiError(message: string, statusCode: number) {
  const error = new Error(message) as Error & { statusCode: number };
  error.name = "AI_APICallError";
  error.statusCode = statusCode;
  return error;
}

describe("normalizeError", () => {
  it("preserves safe Codex usage-limit details and classifies them as rate limited", () => {
    expect(normalizeError(apiError(
      "Codex request failed: You've hit your usage limit for GPT-Test. Switch to another model now, or try again tomorrow.",
      429,
    ))).toEqual({
      code: "rate-limited",
      message: "Codex request failed: You've hit your usage limit for GPT-Test. Switch to another model now, or try again tomorrow.",
      retryable: true,
    });
  });

  it("keeps generic provider errors generic", () => {
    expect(normalizeError(apiError("upstream included internal diagnostics", 429))).toEqual({
      code: "rate-limited",
      message: "The provider rate limit was reached.",
      retryable: true,
    });
  });
});
