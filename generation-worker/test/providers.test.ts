import { describe, expect, it } from "vitest";

import { AiSdkModelExecutor } from "../src/providers/executor.js";
import { CodexModelExecutor } from "../src/providers/codex.js";
import {
  InMemoryProviderRegistry,
  ProviderConfigurationError,
} from "../src/providers/registry.js";

describe("provider registry", () => {
  it.each([
    ["openai", undefined],
    ["anthropic", undefined],
    ["google", undefined],
    ["openai-compatible", "https://models.example.test/v1"],
  ] as const)("constructs the %s AI SDK adapter without making a request", (kind, baseUrl) => {
    const registry = new InMemoryProviderRegistry();
    registry.upsert(
      {
        id: kind,
        kind,
        displayName: kind,
        ...(baseUrl ? { baseUrl } : {}),
        supportsStructuredOutputs: true,
        mockLatencyMs: 0,
      },
      { apiKey: "never-sent-in-this-test" },
    );
    const executor = registry.resolve(kind, "test-model", "seed");
    expect(executor).toBeInstanceOf(AiSdkModelExecutor);
    expect(executor.actualProviderKind).toBe(kind);
    expect(executor.generationMode).toBe(kind === "openai-compatible" ? "compact" : "directed");
  });

  it("never disguises a missing provider credential as a mock generation", () => {
    const registry = new InMemoryProviderRegistry();
    registry.upsert({
      id: "openai-no-key",
      kind: "openai",
      displayName: "OpenAI without a key",
      supportsStructuredOutputs: true,
      mockLatencyMs: 0,
    });
    expect(() => registry.resolve("openai-no-key", "model", "seed")).toThrow(ProviderConfigurationError);
  });

  it("lets a job select compact generation independently of the provider kind", () => {
    const registry = new InMemoryProviderRegistry();
    registry.upsert({
      id: "openai-turbo",
      kind: "openai",
      displayName: "OpenAI Turbo",
      supportsStructuredOutputs: true,
      mockLatencyMs: 0,
    }, { apiKey: "never-sent-in-this-test" });
    const executor = registry.resolve("openai-turbo", {
      connectionId: "openai-turbo",
      modelId: "test-model",
      generationMode: "compact",
    }, "seed");
    expect(executor.generationMode).toBe("compact");
    expect(executor.generateText).toBeTypeOf("function");
  });

  it("keeps credentials out of its public listing and creates the system Codex adapter", () => {
    const registry = new InMemoryProviderRegistry();
    registry.upsert(
      {
        id: "codex",
        kind: "codex",
        displayName: "Codex",
        supportsStructuredOutputs: true,
        mockLatencyMs: 0,
      },
      { apiKey: "super-secret" },
    );
    expect(JSON.stringify(registry.list())).not.toContain("super-secret");
    const executor = registry.resolve("codex", {
      connectionId: "codex",
      modelId: "codex-model",
      reasoningEffort: "high",
      serviceTier: "fast",
      generationMode: "compact",
    }, "seed");
    expect(executor).toBeInstanceOf(CodexModelExecutor);
    expect(executor.actualProviderKind).toBe("codex");
    expect(executor.generationMode).toBe("compact");
    expect(executor.generateText).toBeTypeOf("function");
  });
});
