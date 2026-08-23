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

  it("normalizes only known per-capability flags from the host", () => {
    const input = hostGenerate({ jobId: "capability-flags" }) as HostGenerateCommand;
    (input.request.settings as Record<string, unknown>).capabilities = {
      iconsEnabled: false,
      enabled: { "data-chart": false, slideshow: true, "unknown-capability": false },
    };
    const normalized = normalizeHostGeneration(input).command;
    expect(normalized.settings.capabilities).toMatchObject({
      iconsEnabled: false,
      enabled: { "data-chart": false, slideshow: true },
    });
    expect(normalized.settings.capabilities.enabled).not.toHaveProperty("unknown-capability");
  });

  it("migrates legacy host musicEnabled independently from narration and pseudo-video", () => {
    const input = hostGenerate({ jobId: "legacy-media-settings" }) as HostGenerateCommand;
    (input.request.settings as Record<string, unknown>).capabilities = {
      audioSpeechEnabled: false,
      externalMediaEnabled: true,
      enabled: { "pseudo-video": true },
    };
    (input.request.settings as Record<string, unknown>).voice = { musicEnabled: false };
    const normalized = normalizeHostGeneration(input).command;
    expect(normalized.settings.voice.musicMode).toBe("off");
    expect(normalized.settings.capabilities.audioSpeechEnabled).toBe(false);
    expect(normalized.settings.capabilities.externalMediaEnabled).toBe(true);
    expect(normalized.settings.capabilities.enabled["pseudo-video"]).toBe(true);
  });

  it("preserves a job-level compact mode independently of provider kind", () => {
    const input = hostGenerate({ jobId: "turbo-normalize", kind: "openai" }) as HostGenerateCommand;
    (input.request.provider as Record<string, unknown>).generationMode = "compact";
    const normalized = normalizeHostGeneration(input).command;
    expect(normalized.provider.generationMode).toBe("compact");
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

  it("runs Turbo through one plain-text mock exchange", async () => {
    const outputs: Output[] = [];
    const terminal = terminalPromise(outputs, "generation.completed");
    const runtime = new WorkerRuntime(terminal.sink);
    const input = hostGenerate({ jobId: "turbo-job" });
    (input.request.provider as Record<string, unknown>).generationMode = "compact";
    await runtime.handleLine(JSON.stringify(input));
    await terminal.promise;

    const completed = outputs.find((output) => output.type === "generation.completed");
    expect(completed).toMatchObject({
      jobId: "turbo-job",
      artifact: {
        payload: { pipeline: "compact" },
        modelExchanges: [{ purpose: "page-builder" }],
      },
      usage: { requests: 1 },
    });
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

  it("runs one deterministic region-builder job without creating a page artifact", async () => {
    const outputs: Output[] = [];
    const terminal = terminalPromise(outputs, "dynamic.completed");
    const runtime = new WorkerRuntime(terminal.sink);
    await runtime.handleLine(JSON.stringify({
      type: "generate",
      requestId: "request-dynamic-job",
      jobId: "dynamic-job",
      request: {
        kind: "dynamic-region",
        url: "https://example.com/chat",
        profileId: "personal",
        siteWorldId: "site-dynamic",
        browserTheme: "native",
        provider: { id: "mock", kind: "mock", modelId: "mock-v1" },
        modelId: "mock-v1",
        worldPromptSnapshot: { revision: 1, vibe: "", prompt: "A coherent world." },
        siteIdentity: {
          classification: "original",
          locale: "en-US",
          era: "contemporary",
          name: "Example Chat",
          purpose: "A live support room",
          audience: "Members",
          visualLanguage: { palette: ["#111111", "#eeeeee"], typography: "Arimo Variable", density: "comfortable", radius: "rounded", mood: "helpful" },
          establishedFacts: [],
          routeHints: ["/", "/chat", "/help", "/about"].map((path) => ({ path, label: path, purpose: `Open ${path}` })),
          palette: { background: "#eeeeee", surface: "#ffffff", text: "#111111", mutedText: "#666666", accent: "#2255cc", accentText: "#ffffff", border: "#cccccc" },
          fonts: { body: "Arimo Variable", heading: "Arimo Variable" },
          layoutSystem: "Support thread",
          favicon: { kind: "glyph", glyph: "E", foreground: "#ffffff", background: "#2255cc", shape: "rounded-square" },
        },
        page: { title: "Support", summary: "A support conversation" },
        action: { action: "model:chat.send", trigger: "action", targets: ["thread"], fields: { message: ["Hello"] } },
        regions: [{ regionId: "thread", html: "<p>Initial</p>", revision: 0 }],
        trustedState: { cart: { items: {} }, wishlist: [], values: {} },
        settings: { dynamicMode: "active", maxOutputTokens: 8_000, style: { tailwindEnabled: false }, images: { enabled: false } },
      },
    }));
    await terminal.promise;
    expect(outputs.some((output) => output.type === "dynamic.started")).toBe(true);
    expect(outputs.find((output) => output.type === "dynamic.completed")).toMatchObject({
      result: { patches: [{ regionId: "thread", html: expect.stringContaining("Fresh deterministic content") }] },
    });
    expect(outputs.some((output) => output.type === "generation.completed")).toBe(false);
    await runtime.close();
  });

  it("terminates malformed host dynamic jobs instead of leaving the host waiting", async () => {
    const outputs: Output[] = [];
    const runtime = new WorkerRuntime((output) => void outputs.push(output as Output));
    await runtime.handleLine(JSON.stringify({
      type: "generate",
      requestId: "request-malformed-dynamic",
      jobId: "malformed-dynamic",
      request: { kind: "dynamic-region" },
    }));

    expect(outputs).toContainEqual(expect.objectContaining({
      type: "dynamic.failed",
      requestId: "request-malformed-dynamic",
      jobId: "malformed-dynamic",
      sequence: 1,
    }));
    expect(runtime.activeJobCount).toBe(0);
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

  it("resets reusable workers and clears every retained credential", async () => {
    const outputs: Output[] = [];
    const runtime = new WorkerRuntime((output) => void outputs.push(output as Output));
    await runtime.handleLine(JSON.stringify({
      v: 1,
      type: "provider.upsert",
      requestId: "upsert-1",
      connection: {
        id: "reusable-provider",
        kind: "openai-compatible",
        displayName: "Reusable provider",
        baseUrl: "http://127.0.0.1:8080/v1",
        supportsStructuredOutputs: false,
      },
      credentials: { apiKey: "must-not-survive-reset" },
    }));
    await runtime.handleLine(JSON.stringify({ type: "reset", requestId: "reset-1" }));
    await runtime.handleLine(JSON.stringify({ v: 1, type: "provider.list", requestId: "list-1" }));

    expect(outputs).toContainEqual(expect.objectContaining({ type: "ack", requestId: "reset-1", accepted: true }));
    expect(outputs.find((output) => output.type === "provider.list.result")).toMatchObject({
      connections: expect.arrayContaining([
        expect.objectContaining({ id: "reusable-provider", hasCredentials: false }),
      ]),
    });
    expect(JSON.stringify(outputs)).not.toContain("must-not-survive-reset");
    await runtime.close();
  });
});
