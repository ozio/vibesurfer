import { describe, expect, it } from "vitest";

import { runGenerationPipeline, UnsafeOutputError, type PipelineEmitter } from "../src/pipelines/index.js";
import { DeterministicMockExecutor } from "../src/providers/mock.js";
import type { GenerateObjectRequest, GeneratedObject, ModelExecutor } from "../src/providers/executor.js";
import { generationCommand } from "./helpers.js";

function emitter() {
  const phases: string[] = [];
  const validations: Array<{ repair: boolean }> = [];
  const value: PipelineEmitter = {
    phase: (phase) => void phases.push(phase),
    metadata: () => undefined,
    validation: (_issues, repair) => void validations.push({ repair }),
    warning: () => undefined,
  };
  return { value, phases, validations };
}

class BrokenThenRepairExecutor implements ModelExecutor {
  readonly actualProviderKind = "mock" as const;
  readonly providerId = "mock";
  readonly modelId = "mock-v1";
  readonly calls: string[] = [];
  readonly #delegate = new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "repair" });

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    this.calls.push(request.purpose);
    const result = await this.#delegate.generateObject(request);
    if (request.purpose !== "page-builder") return result;
    const output = structuredClone(result.output) as T & { html: string };
    output.html = output.html.replaceAll(/href="[^"]+"/g, 'href="#"');
    return { ...result, output };
  }
}

describe("generation pipelines", () => {
  it("uses exactly one structured request in Quick mode", async () => {
    const request = generationCommand();
    const executor = new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "quick" });
    const events = emitter();
    const result = await runGenerationPipeline({ request, executor, signal: new AbortController().signal, emit: events.value });
    expect(executor.calls).toEqual(["quick-page"]);
    expect(result.usage.requests).toBe(1);
    expect(result.artifact.payload).toMatchObject({ mode: "quick", modelId: "mock-v1" });
    expect(events.phases.at(-1)).toBe("committing");
  });

  it("uses architect, planner, and builder in Deep mode when validation succeeds", async () => {
    const request = generationCommand({ mode: "deep" });
    const executor = new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "deep" });
    const result = await runGenerationPipeline({ request, executor, signal: new AbortController().signal, emit: emitter().value });
    expect(executor.calls).toEqual(["site-architect", "page-planner", "page-builder"]);
    expect(result.usage.requests).toBe(3);
  });

  it("runs at most one repair when deterministic validation fails", async () => {
    const request = generationCommand({ mode: "deep" });
    const executor = new BrokenThenRepairExecutor();
    const events = emitter();
    const result = await runGenerationPipeline({ request, executor, signal: new AbortController().signal, emit: events.value });
    expect(executor.calls).toEqual(["site-architect", "page-planner", "page-builder", "page-repair"]);
    expect(result.usage.requests).toBe(4);
    expect(events.validations).toContainEqual({ repair: true });
  });

  it("honors a three-request Deep budget by refusing a fourth repair", async () => {
    const base = generationCommand({ mode: "deep" });
    const request = { ...base, settings: { ...base.settings, maxRequests: 3 } };
    const executor = new BrokenThenRepairExecutor();
    await expect(
      runGenerationPipeline({ request, executor, signal: new AbortController().signal, emit: emitter().value }),
    ).rejects.toBeInstanceOf(UnsafeOutputError);
    expect(executor.calls).toEqual(["site-architect", "page-planner", "page-builder"]);
  });
});
