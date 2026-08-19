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
      profileId: "personal",
      siteWorldId: `site-${options.jobId}`,
      worldPromptSnapshot: { revision: 2, prompt: "A coherent test world." },
      provider: {
        id: options.kind ?? "mock",
        kind: options.kind ?? "mock",
        modelId: "mock-v1",
        mockLatencyMs: options.latencyMs ?? 0,
      },
      settings: {
        style: { tailwindEnabled: false, tailwindVersion: "4.3.3" },
        images: { enabled: false, provider: "off", safeContent: true, allowExternalRequests: false },
        maxOutputTokens: 20_000,
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
  it("normalizes profile, SiteWorld, prompt snapshot, and prompt concepts", () => {
    const input = hostGenerate({ jobId: "concept-job" }) as HostGenerateCommand;
    input.request.conceptPrompt = "A calm research space";
    const normalized = normalizeHostGeneration(input).command;
    expect(normalized.profileId).toBe("personal");
    expect(normalized.siteWorldId).toBe("site-concept-job");
    expect(normalized.worldPromptSnapshot).toEqual({ revision: 2, vibe: "", prompt: "A coherent test world." });
    expect(normalized.context.navigationIntent.anchorText).toBe("A calm research space");
  });

  it("defaults enabled host image settings to the LoremFlickr resolver", () => {
    const input = hostGenerate({ jobId: "image-default-job" }) as HostGenerateCommand;
    delete (input.request.settings as Record<string, unknown>).images;
    const normalized = normalizeHostGeneration(input).command;
    expect(normalized.settings.images).toEqual({
      mode: "tag-placeholder",
      fetchExternal: true,
      safeContent: true,
    });
  });

  it("keeps generated JavaScript disabled unless the host style setting opts in", () => {
    const disabled = normalizeHostGeneration(hostGenerate({ jobId: "scripts-disabled" }) as HostGenerateCommand).command;
    const enabledInput = hostGenerate({ jobId: "scripts-enabled" }) as HostGenerateCommand;
    ((enabledInput.request.settings as Record<string, unknown>).style as Record<string, unknown>).allowGeneratedScripts = true;
    const enabled = normalizeHostGeneration(enabledInput).command;

    expect(disabled.settings.allowGeneratedScripts).toBe(false);
    expect(enabled.settings.allowGeneratedScripts).toBe(true);
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
    await runtime.handleLine(JSON.stringify(hostGenerate({ jobId: "directed-job" })));
    await terminal.promise;

    expect(outputs[0]).toMatchObject({ type: "initialized", protocolVersion: 1 });
    expect(outputs.some((output) => output.type === "generation.started" && output.jobId === "directed-job")).toBe(true);
    const previewIndex = outputs.findIndex((output) => output.type === "generation.preview");
    const completedIndex = outputs.findIndex((output) => output.type === "generation.completed");
    expect(previewIndex).toBeGreaterThan(outputs.findIndex((output) => output.type === "generation.started"));
    expect(previewIndex).toBeLessThan(completedIndex);
    expect(outputs[previewIndex]).toMatchObject({
      jobId: "directed-job",
      html: expect.stringContaining("<!doctype html>"),
    });
    const completed = outputs.find((output) => output.type === "generation.completed");
    expect(completed).toMatchObject({ jobId: "directed-job", artifact: { siteId: "site-directed-job", payload: expect.any(Object), modelExchanges: [{ purpose: "page-director" }, { purpose: "page-builder" }] } });
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
