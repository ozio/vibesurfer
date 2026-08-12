import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  CodexModelExecutor,
  codexExecutableFromEnvironment,
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
const args = process.argv.slice(2);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const schemaIndex = args.indexOf("--output-schema");
  const instructionsArg = args.find((arg) => arg.startsWith("model_instructions_file="));
  const instructionsPath = JSON.parse(instructionsArg.slice("model_instructions_file=".length));
  fs.writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({
    args,
    cwd: process.cwd(),
    workspaceEntries: fs.readdirSync(process.cwd()),
    schema: JSON.parse(fs.readFileSync(args[schemaIndex + 1], "utf8")),
    instructions: fs.readFileSync(instructionsPath, "utf8"),
    input,
    env: {
      HOME: process.env.HOME,
      CODEX_HOME: process.env.CODEX_HOME,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      PATH: process.env.PATH,
    },
  }));
  if (${JSON.stringify(mode)} === "hang") {
    setInterval(() => undefined, 1000);
    return;
  }
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: JSON.stringify({ ok: true }) },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
  }) + "\\n");
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
    purpose: "quick-page" as const,
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
  it("uses only the selected system Codex binary with isolated, no-tool settings", async () => {
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
      expect(result).toEqual({
        output: { ok: true },
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, requests: 1 },
      });
      expect(onPartial).toHaveBeenCalledOnce();
      expect(onPartial).toHaveBeenCalledWith({ ok: true });

      const invocation = JSON.parse(await readFile(fake.invocationPath, "utf8")) as {
        args: string[];
        cwd: string;
        workspaceEntries: string[];
        schema: Record<string, unknown>;
        instructions: string;
        input: string;
        env: Record<string, string | undefined>;
      };
      expect(invocation.args.slice(0, 2)).toEqual(["exec", "--json"]);
      expect(invocation.args).toContain("--ignore-user-config");
      expect(invocation.args).toContain("--ignore-rules");
      expect(invocation.args).toContain("--ephemeral");
      expect(invocation.args).toContain("read-only");
      expect(invocation.args).toContain('approval_policy="never"');
      expect(invocation.args).toContain('web_search="disabled"');
      expect(invocation.args).toContain("project_doc_max_bytes=0");
      expect(invocation.args).toContain("mcp_servers={}");
      expect(invocation.args).toContain("notify=[]");
      expect(invocation.args).toContain('shell_environment_policy.inherit="none"');
      expect(invocation.args).toContain('model_reasoning_effort="xhigh"');
      expect(invocation.args).toContain('service_tier="fast"');
      expect(invocation.args).toContain("features.shell_tool=false");
      expect(invocation.args).toContain("features.unified_exec=false");
      expect(invocation.args).toContain("features.apps=false");
      expect(invocation.workspaceEntries).toEqual([]);
      const requestedCwd = invocation.args[invocation.args.indexOf("--cd") + 1];
      expect(requestedCwd).toBeDefined();
      expect(invocation.cwd.replace(/^\/private(?=\/var\/)/, "")).toBe(requestedCwd);
      expect(invocation.schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(invocation.input).toContain("Set ok to true.");
      expect(invocation.instructions).toContain("Generate a tiny structured object.");
      expect(invocation.input).not.toContain("Generate a tiny structured object.");
      expect(invocation.env).toEqual({
        HOME: "/fake/home",
        CODEX_HOME: "/fake/codex-home",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      });
    } finally {
      await fake.cleanup();
    }
  });

  it("terminates an in-flight Codex subprocess when generation is cancelled", async () => {
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
