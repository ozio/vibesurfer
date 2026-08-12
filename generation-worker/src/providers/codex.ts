import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import type { TokenUsage } from "../domain.js";
import type {
  GeneratedObject,
  GenerateObjectRequest,
  ModelExecutor,
} from "./executor.js";

const STDOUT_LIMIT_BYTES = 32 * 1024 * 1024;
const STDERR_LIMIT_BYTES = 1024 * 1024;
const CODEX_DEVELOPER_INSTRUCTIONS = [
  "You are a structured-data generator embedded in vibesurfer.",
  "Never call tools, execute commands, inspect files, access external resources, or modify the environment.",
  "Produce only the final JSON value that matches the supplied output schema.",
].join(" ");

interface CodexExecutorDescriptor {
  providerId: string;
  modelId: string;
  reasoningEffort?: string;
  serviceTier?: string;
  environment?: NodeJS.ProcessEnv;
}

interface CodexRunResult {
  finalMessage: string;
  usage: TokenUsage;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function abortError(): Error {
  const error = new Error("Codex generation was cancelled.");
  error.name = "AbortError";
  return error;
}

class CodexExecutionError extends Error {
  readonly statusCode?: number;

  constructor(detail: string) {
    super("The system Codex session could not complete the generation request.");
    this.name = "AI_APICallError";
    const normalized = detail.toLowerCase();
    if (
      normalized.includes("not logged in")
      || normalized.includes("authentication")
      || normalized.includes("unauthorized")
    ) {
      this.statusCode = 401;
    } else if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
      this.statusCode = 429;
    }
  }
}

class CodexOutputError extends Error {
  constructor() {
    super("Codex did not return a valid structured result.");
    this.name = "AI_NoObjectGeneratedError";
  }
}

function configString(value: string): string {
  return JSON.stringify(value);
}

export function codexExecutableFromEnvironment(environment: NodeJS.ProcessEnv): string {
  const executable = environment.VIBESURFER_CODEX_PATH?.trim();
  if (!executable || !isAbsolute(executable)) {
    throw new CodexExecutionError("VIBESURFER_CODEX_PATH is missing or is not absolute.");
  }
  return executable;
}

export function sanitizedCodexEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TERM: "dumb",
    NO_COLOR: "1",
  };
  const retained = [
    "HOME",
    "CODEX_HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "SystemRoot",
  ] as const;
  for (const key of retained) {
    const value = environment[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function buildCodexArguments(
  descriptor: Pick<CodexExecutorDescriptor, "modelId" | "reasoningEffort" | "serviceTier">,
  workspacePath: string,
  schemaPath: string,
  instructionsPath: string,
): string[] {
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--model",
    descriptor.modelId,
    "--sandbox",
    "read-only",
    "--cd",
    workspacePath,
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--output-schema",
    schemaPath,
    "--config",
    'approval_policy="never"',
    "--config",
    'web_search="disabled"',
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    "mcp_servers={}",
    "--config",
    "notify=[]",
    "--config",
    'shell_environment_policy.inherit="none"',
    "--config",
    "features.shell_tool=false",
    "--config",
    "features.unified_exec=false",
    "--config",
    "features.apps=false",
    "--config",
    `model_instructions_file=${configString(instructionsPath)}`,
  ];
  if (descriptor.reasoningEffort) {
    args.push("--config", `model_reasoning_effort=${configString(descriptor.reasoningEffort)}`);
  }
  if (descriptor.serviceTier) {
    args.push("--config", `service_tier=${configString(descriptor.serviceTier)}`);
  }
  args.push("-");
  return args;
}

function instructionsFor(request: GenerateObjectRequest<unknown>): string {
  return [
    CODEX_DEVELOPER_INSTRUCTIONS,
    "",
    request.prompt.system,
  ].join("\n");
}

function promptFor(request: GenerateObjectRequest<unknown>): string {
  return [
    request.prompt.prompt,
    "Return exactly one JSON value matching the supplied output schema. Do not use Markdown fences.",
  ].join("\n");
}

function textFromAgentItem(item: Record<string, unknown>): string | undefined {
  const direct = string(item.text);
  if (direct) return direct;
  if (!Array.isArray(item.content)) return undefined;
  const parts = item.content
    .map((part) => {
      const content = record(part);
      return string(content.text ?? content.output_text);
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("") : undefined;
}

function parseCodexEvents(stdout: string): CodexRunResult {
  let finalMessage: string | undefined;
  let failureDetail = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = record(JSON.parse(line));
    } catch {
      continue;
    }
    const type = string(event.type);
    const item = record(event.item);
    if (
      (type === "item.completed" || type === "item.updated")
      && string(item.type) === "agent_message"
    ) {
      finalMessage = textFromAgentItem(item) ?? finalMessage;
    }
    if (type === "turn.failed" || type === "error") {
      const error = record(event.error);
      failureDetail = string(error.message ?? event.message) ?? type;
    }
    if (type === "turn.completed") {
      const usage = record(event.usage);
      inputTokens = count(usage.input_tokens ?? usage.inputTokens);
      outputTokens = count(usage.output_tokens ?? usage.outputTokens);
      totalTokens = count(usage.total_tokens ?? usage.totalTokens);
    }
  }

  if (failureDetail) {
    throw new CodexExecutionError(failureDetail);
  }
  if (!finalMessage) {
    throw new CodexOutputError();
  }
  return {
    finalMessage,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: totalTokens || inputTokens + outputTokens,
      requests: 1,
    },
  };
}

async function runCodex(
  executable: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  prompt: string,
  signal: AbortSignal,
): Promise<CodexRunResult> {
  if (signal.aborted) throw abortError();

  return await new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: sanitizedCodexEnvironment(environment),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let spawnFailure: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > STDOUT_LIMIT_BYTES) {
        overflow = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (Buffer.byteLength(stderr) < STDERR_LIMIT_BYTES) {
        stderr += chunk;
      }
    });
    child.stdin.on("error", () => undefined);
    child.once("error", (error) => {
      spawnFailure = error;
    });

    const abort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref();
    };
    signal.addEventListener("abort", abort, { once: true });

    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      if (spawnFailure) {
        reject(new CodexExecutionError(spawnFailure.message));
        return;
      }
      if (overflow) {
        reject(new CodexExecutionError("Codex JSONL output exceeded its safety limit."));
        return;
      }
      if (code !== 0) {
        reject(new CodexExecutionError(stderr));
        return;
      }
      try {
        resolve(parseCodexEvents(stdout));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(prompt);
  });
}

export class CodexModelExecutor implements ModelExecutor {
  readonly actualProviderKind = "codex" as const;
  readonly providerId: string;
  readonly modelId: string;
  readonly #reasoningEffort: string | undefined;
  readonly #serviceTier: string | undefined;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(descriptor: CodexExecutorDescriptor) {
    this.providerId = descriptor.providerId;
    this.modelId = descriptor.modelId;
    this.#reasoningEffort = descriptor.reasoningEffort;
    this.#serviceTier = descriptor.serviceTier;
    this.#environment = descriptor.environment ?? process.env;
  }

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    const executable = codexExecutableFromEnvironment(this.#environment);
    const temporaryRoot = await mkdtemp(join(tmpdir(), "vibesurfer-codex-"));
    const workspacePath = join(temporaryRoot, "workspace");
    const schemaPath = join(temporaryRoot, "output-schema.json");
    const instructionsPath = join(temporaryRoot, "instructions.md");
    try {
      await mkdir(workspacePath, { mode: 0o700 });
      const outputSchema = z.toJSONSchema(request.schema, {
        target: "draft-07",
        io: "output",
      });
      await writeFile(schemaPath, JSON.stringify(outputSchema), { encoding: "utf8", mode: 0o600 });
      await writeFile(instructionsPath, instructionsFor(request), { encoding: "utf8", mode: 0o600 });
      const args = buildCodexArguments(
        {
          modelId: this.modelId,
          ...(this.#reasoningEffort ? { reasoningEffort: this.#reasoningEffort } : {}),
          ...(this.#serviceTier ? { serviceTier: this.#serviceTier } : {}),
        },
        workspacePath,
        schemaPath,
        instructionsPath,
      );
      const result = await runCodex(
        executable,
        args,
        workspacePath,
        this.#environment,
        promptFor(request),
        request.abortSignal,
      );
      let decoded: unknown;
      try {
        decoded = JSON.parse(result.finalMessage);
      } catch {
        throw new CodexOutputError();
      }
      const output = request.schema.parse(decoded);
      if (request.onPartial) {
        await request.onPartial(output);
      }
      return { output, usage: result.usage };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}
