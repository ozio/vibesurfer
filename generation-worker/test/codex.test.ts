import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  CodexModelExecutor,
  codexExecutableFromEnvironment,
  extractPartialJsonStringField,
  normalizeCodexOutputSchema,
  stripCodexOptionalNulls,
} from "../src/providers/codex.js";

interface FakeCodex {
  executable: string;
  invocationPath: string;
  cleanup: () => Promise<void>;
}

async function createFakeCodex(mode: "success" | "hang"): Promise<FakeCodex> {
  const root = await mkdtemp(join(tmpdir(), "vibesurfer-fake-codex-"));
  const executable = join(root, "codex");
  const invocationPath = join(root, "invocation.json");
  const source = `#!${process.execPath}
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
const requests = [];
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  requests.push(message);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-1" } } });
    return;
  }
  if (message.method !== "turn/start") return;
  fs.writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({
    args,
    cwd: process.cwd(),
    workspaceEntries: fs.readdirSync(process.cwd()),
    requests,
    env: {
      HOME: process.env.HOME,
      CODEX_HOME: process.env.CODEX_HOME,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      PATH: process.env.PATH,
    },
  }));
  send({ id: message.id, result: { turn: { id: "turn-1" } } });
  if (${JSON.stringify(mode)} === "hang") {
    setInterval(() => undefined, 1000);
    return;
  }
  const output = JSON.stringify({ ok: true });
  send({ method: "item/agentMessage/delta", params: {
    threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: output.slice(0, 6),
  } });
  send({ method: "item/agentMessage/delta", params: {
    threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: output.slice(6),
  } });
  send({ method: "item/completed", params: {
    threadId: "thread-1", turnId: "turn-1", completedAtMs: Date.now(),
    item: { type: "agentMessage", id: "item-1", text: output, phase: null, memoryCitation: null },
  } });
  send({ method: "thread/tokenUsage/updated", params: {
    threadId: "thread-1", turnId: "turn-1",
    tokenUsage: { last: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } },
  } });
  send({ method: "turn/completed", params: {
    threadId: "thread-1",
    turn: { id: "turn-1", status: "completed", items: [], error: null },
  } });
});
`;
  await writeFile(executable, source, "utf8");
  await chmod(executable, 0o700);
  return {
    executable,
    invocationPath,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

function request(abortSignal: AbortSignal, onPartial?: (partial: unknown) => void) {
  return {
    purpose: "page-director" as const,
    schema: z.object({ ok: z.literal(true) }).strict(),
    prompt: {
      system: "Generate a tiny structured object.",
      prompt: "Set ok to true.",
      fingerprint: "codex-test-v1",
      version: 1,
    },
    abortSignal,
    maxOutputTokens: 512,
    ...(onPartial ? { onPartial } : {}),
  };
}

describe.sequential("CodexModelExecutor", () => {
  it("uses the selected system Codex app-server with isolated, no-tool settings", async () => {
    const fake = await createFakeCodex("success");
    try {
      const onPartial = vi.fn();
      const executor = new CodexModelExecutor({
        providerId: "codex",
        modelId: "gpt-test",
        reasoningEffort: "xhigh",
        serviceTier: "fast",
        environment: {
          VIBESURFER_CODEX_PATH: fake.executable,
          HOME: "/fake/home",
          CODEX_HOME: "/fake/codex-home",
          OPENAI_API_KEY: "must-not-leak",
          PATH: "/untrusted/bin",
        },
      });

      const result = await executor.generateObject(request(new AbortController().signal, onPartial));
      expect(result).toMatchObject({
        output: { ok: true },
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, requests: 1 },
        exchange: {
          purpose: "page-director",
          providerId: "codex",
          modelId: "gpt-test",
          response: '{"ok":true}',
          usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, requests: 1 },
        },
      });
      expect(onPartial).toHaveBeenCalledOnce();
      expect(onPartial).toHaveBeenCalledWith({ ok: true });

      const invocation = JSON.parse(await readFile(fake.invocationPath, "utf8")) as {
        args: string[];
        cwd: string;
        workspaceEntries: string[];
        requests: Array<Record<string, unknown>>;
        env: Record<string, string | undefined>;
      };
      expect(invocation.args).toEqual(["app-server", "--stdio"]);
      expect(invocation.workspaceEntries).toEqual([]);
      const initialize = invocation.requests.find((entry) => entry.method === "initialize");
      const threadStart = invocation.requests.find((entry) => entry.method === "thread/start") as {
        params: Record<string, unknown>;
      };
      const turnStart = invocation.requests.find((entry) => entry.method === "turn/start") as {
        params: Record<string, unknown>;
      };
      expect(initialize).toBeDefined();
      expect(invocation.requests).toContainEqual({ method: "initialized", params: {} });
      expect(threadStart.params).toMatchObject({
        model: "gpt-test",
        serviceTier: "fast",
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        serviceName: "vibesurfer",
        config: {
          web_search: "disabled",
          project_doc_max_bytes: 0,
          mcp_servers: {},
          notify: [],
          shell_environment_policy: { inherit: "none" },
          features: { shell_tool: false, unified_exec: false, apps: false },
        },
      });
      expect(String(threadStart.params.cwd).replace(/^\/private(?=\/var\/)/, ""))
        .toBe(invocation.cwd.replace(/^\/private(?=\/var\/)/, ""));
      expect(threadStart.params.developerInstructions).toContain("Generate a tiny structured object.");
      expect(turnStart.params).toMatchObject({
        threadId: "thread-1",
        effort: "xhigh",
        serviceTier: "fast",
        input: [{ type: "text", text_elements: [] }],
        outputSchema: { type: "object", additionalProperties: false },
      });
      expect(JSON.stringify(turnStart.params.input)).toContain("Set ok to true.");
      expect(JSON.stringify(turnStart.params.input)).not.toContain("Generate a tiny structured object.");
      expect(invocation.env).toEqual({
        HOME: "/fake/home",
        CODEX_HOME: "/fake/codex-home",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      });
    } finally {
      await fake.cleanup();
    }
  });

  it("decodes an HTML field from incomplete structured-output deltas", () => {
    expect(extractPartialJsonStringField('{"meta":{"title":"Google"},"html":"<main>Go\\n', "html"))
      .toBe("<main>Go\n");
    expect(extractPartialJsonStringField('{"html":"<div class=\\"hero\\">Hi', "html"))
      .toBe('<div class="hero">Hi');
    expect(extractPartialJsonStringField('{"meta":{"title":"Goo', "title")).toBe("Goo");
  });

  it("adapts optional Zod properties to the strict Codex output-schema contract", () => {
    const source = z.toJSONSchema(
      z.object({
        required: z.string(),
        optional: z.string().optional(),
        deliberatelyNull: z.string().nullable(),
      }).strict(),
      { target: "draft-07", io: "output" },
    );
    const normalized = normalizeCodexOutputSchema(source) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(normalized.required).toEqual(["required", "optional", "deliberatelyNull"]);
    expect(normalized.properties.optional).toMatchObject({
      anyOf: [{ type: "string" }, { type: "null" }],
    });

    const output: Record<string, unknown> = {
      required: "yes",
      optional: null,
      deliberatelyNull: null,
    };
    stripCodexOptionalNulls(output, source);
    expect(output).toEqual({ required: "yes", deliberatelyNull: null });
  });

  it("terminates an in-flight Codex app-server when generation is cancelled", async () => {
    const fake = await createFakeCodex("hang");
    try {
      const controller = new AbortController();
      const executor = new CodexModelExecutor({
        providerId: "codex",
        modelId: "gpt-test",
        environment: {
          VIBESURFER_CODEX_PATH: fake.executable,
          HOME: "/fake/home",
        },
      });
      const pending = executor.generateObject(request(controller.signal));
      setTimeout(() => controller.abort(), 50);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      await fake.cleanup();
    }
  });

  it("rejects a relative executable instead of resolving it through PATH", () => {
    expect(() => codexExecutableFromEnvironment({ VIBESURFER_CODEX_PATH: "codex" }))
      .toThrow("system Codex session");
  });
});
