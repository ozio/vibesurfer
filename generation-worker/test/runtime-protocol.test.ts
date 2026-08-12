import { describe, expect, it } from "vitest";

import { WorkerRuntime } from "../src/runtime.js";
import { normalizeHostGeneration } from "../src/protocol/compat.js";
import type { HostGenerateCommand } from "../src/protocol/types.js";

type Output = Record<string, unknown>;

function hostGenerate(options: { jobId: string; kind?: string; latencyMs?: number; credential?: string }) {
  return {
    type: "generate",
    requestId: `request-${options.jobId}`,
    jobId: options.jobId,
    request: {
      url: "https://example.com/",
      mode: "quick",
      provider: {
        id: options.kind ?? "mock",
        kind: options.kind ?? "mock",
        modelId: "mock-v1",
        mockLatencyMs: options.latencyMs ?? 0,
      },
      settings: {
        style: { tailwindEnabled: false, tailwindVersion: "4.3.3" },
        images: { enabled: false, provider: "off", safeContent: true, allowExternalRequests: false },
        maxRequests: 4,
        maxOutputTokens: 20_000,
        autoRepair: true,
      },
      navigationIntent: {
        trigger: "address-bar",
        disposition: "current",
        requestedUrl: "https://example.com/",
      },
    },
    ...(options.credential ? { credential: options.credential } : {}),
  };
}

function terminalPromise(outputs: Output[], terminalType: string) {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    sink(output: unknown) {
      const value = output as Output;
      outputs.push(value);
      if (value.type === terminalType) resolve();
    },
  };
}

describe("Rust host JSONL compatibility", () => {
  it("normalizes prompt concepts and clamps Deep request budgets", () => {
    const input = hostGenerate({ jobId: "concept-job" }) as HostGenerateCommand;
    input.request.mode = "deep";
    input.request.conceptPrompt = "A calm research space";
    (input.request.settings as Record<string, unknown>).maxRequests = 8;
    const normalized = normalizeHostGeneration(input).command;
    expect(normalized.mode).toBe("deep");
    expect(normalized.settings.maxRequests).toBe(4);
    expect(normalized.context.navigationIntent.anchorText).toBe("A calm research space");
  });

  it("accepts initialize and nested generate, then emits host-shaped terminal events", async () => {
    const outputs: Output[] = [];
    const terminal = terminalPromise(outputs, "generation.completed");
    const runtime = new WorkerRuntime(terminal.sink);
    await runtime.handleLine(JSON.stringify({
      type: "initialize",
      requestId: "init-1",
      protocolVersion: 1,
      client: { name: "vibesurfer", version: "0.1.0" },
    }));
    await runtime.handleLine(JSON.stringify(hostGenerate({ jobId: "quick-job" })));
    await terminal.promise;

    expect(outputs[0]).toMatchObject({ type: "initialized", protocolVersion: 1 });
    expect(outputs.some((output) => output.type === "generation.started" && output.jobId === "quick-job")).toBe(true);
    const completed = outputs.find((output) => output.type === "generation.completed");
    expect(completed).toMatchObject({ jobId: "quick-job", artifact: { siteId: expect.any(String), payload: expect.any(Object) } });
    expect(outputs.filter((output) => typeof output.sequence === "number").map((output) => output.sequence)).toEqual(
      [...outputs.filter((output) => typeof output.sequence === "number").keys()].map((index) => index + 1),
    );
    await runtime.close();
  });

  it("processes cancel while a mock request is in flight", async () => {
    const outputs: Output[] = [];
    const terminal = terminalPromise(outputs, "generation.cancelled");
    const runtime = new WorkerRuntime(terminal.sink);
    await runtime.handleLine(JSON.stringify(hostGenerate({ jobId: "slow-job", latencyMs: 5_000 })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runtime.handleLine(JSON.stringify({ type: "cancel", requestId: "cancel-1", jobId: "slow-job" }));
    await terminal.promise;
    expect(outputs.some((output) => output.type === "generation.cancelled" && output.jobId === "slow-job")).toBe(true);
    await runtime.close();
  });

  it("uses the system Codex route without ever echoing inline credentials", async () => {
    const secret = "credential-that-must-never-appear";
    const outputs: Output[] = [];
    const terminal = terminalPromise(outputs, "generation.failed");
    const runtime = new WorkerRuntime(terminal.sink);
    await runtime.handleLine(JSON.stringify(hostGenerate({ jobId: "codex-job", kind: "codex", credential: secret })));
    await terminal.promise;
    expect(outputs.find((output) => output.type === "generation.failed")).toMatchObject({
      error: { code: "provider-unavailable", retryable: true },
    });
    expect(JSON.stringify(outputs)).not.toContain(secret);
    await runtime.close();
  });

  it("supports provider.verify without exposing its credential", async () => {
    const secret = "verification-secret";
    const outputs: Output[] = [];
    const runtime = new WorkerRuntime((output) => void outputs.push(output as Output));
    await runtime.handleLine(JSON.stringify({
      type: "provider.verify",
      requestId: "verify-1",
      provider: { id: "mock", kind: "mock", modelId: "mock-v1" },
      credential: secret,
    }));
    expect(outputs).toContainEqual(expect.objectContaining({ type: "provider.verified", requestId: "verify-1" }));
    expect(JSON.stringify(outputs)).not.toContain(secret);
    await runtime.close();
  });
});
