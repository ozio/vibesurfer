import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

import type { TokenUsage } from "../domain.js";
import {
  createModelExchange,
  type GeneratedText,
  type GeneratedObject,
  type GenerateTextRequest,
  type GenerateObjectRequest,
  type ModelExecutor,
} from "./executor.js";

const APP_SERVER_LINE_LIMIT_BYTES = 32 * 1024 * 1024;
const STDERR_LIMIT_BYTES = 1024 * 1024;
const CODEX_DEVELOPER_INSTRUCTIONS = [
  "You are a structured-data generator embedded in vibesurfer.",
  "Never call tools, execute commands, inspect files, access external resources, or modify the environment.",
  "Produce only the final JSON value that matches the supplied output schema.",
].join(" ");
const CODEX_TEXT_INSTRUCTIONS = [
  "You are a plain-text generator embedded in vibesurfer.",
  "Never call tools, execute commands, inspect files, access external resources, or modify the environment.",
  "Produce only the requested text without commentary or Markdown fences.",
].join(" ");

interface CodexExecutorDescriptor {
  providerId: string;
  modelId: string;
  reasoningEffort?: string;
  serviceTier?: string;
  generationMode?: "directed" | "compact";
  environment?: NodeJS.ProcessEnv;
}

interface CodexRunResult {
  finalMessage: string;
  usage: TokenUsage;
}

interface CodexRunOptions {
  executable: string;
  cwd: string;
  environment: NodeJS.ProcessEnv;
  modelId: string;
  reasoningEffort?: string;
  serviceTier?: string;
  developerInstructions: string;
  prompt: string;
  outputSchema?: unknown;
  signal: AbortSignal;
  onText?: (text: string) => void | Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function schemaRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function schemaAllowsNull(value: unknown): boolean {
  const schema = schemaRecord(value);
  if (!schema) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  return Array.isArray(schema.anyOf) && schema.anyOf.some(schemaAllowsNull);
}

/**
 * OpenAI structured outputs require every object property to appear in
 * `required`. Zod represents optional fields by omitting them from that list,
 * so expose those fields to Codex as required-but-nullable instead. The nulls
 * are removed again before the original Zod schema parses the result.
 */
export function normalizeCodexOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCodexOutputSchema);
  const schema = schemaRecord(value);
  if (!schema) return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(schema)) {
    normalized[key] = normalizeCodexOutputSchema(entry);
  }

  const properties = schemaRecord(schema.properties);
  if (!properties) return normalized;
  const originallyRequired = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [],
  );
  const normalizedProperties = schemaRecord(normalized.properties) ?? {};
  for (const key of Object.keys(properties)) {
    if (originallyRequired.has(key) || schemaAllowsNull(normalizedProperties[key])) continue;
    normalizedProperties[key] = {
      anyOf: [normalizedProperties[key], { type: "null" }],
    };
  }
  normalized.properties = normalizedProperties;
  normalized.required = Object.keys(properties);
  return normalized;
}

export function stripCodexOptionalNulls(value: unknown, schemaValue: unknown): void {
  const schema = schemaRecord(schemaValue);
  if (!schema) return;

  if (Array.isArray(value)) {
    for (const item of value) stripCodexOptionalNulls(item, schema.items);
    return;
  }

  if (typeof value === "object" && value !== null) {
    const output = value as Record<string, unknown>;
    const properties = schemaRecord(schema.properties);
    if (properties) {
      const originallyRequired = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter((entry): entry is string => typeof entry === "string")
          : [],
      );
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!originallyRequired.has(key) && output[key] === null) {
          delete output[key];
        } else if (key in output) {
          stripCodexOptionalNulls(output[key], propertySchema);
        }
      }
    }
  }

  for (const branch of Array.isArray(schema.anyOf) ? schema.anyOf : []) {
    stripCodexOptionalNulls(value, branch);
  }
  for (const branch of Array.isArray(schema.oneOf) ? schema.oneOf : []) {
    stripCodexOptionalNulls(value, branch);
  }
}

function abortError(): Error {
  const error = new Error("Codex generation was cancelled.");
  error.name = "AbortError";
  return error;
}

export function sanitizeCodexErrorDetail(detail: string): string {
  const sanitized = detail
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9._-]{8,}\b/g, "[redacted]")
    .replace(/\/(?:Users|home|private|var|tmp)\/[^\s,;]+/g, "[path]")
    .replace(/([?&](?:key|token|secret|credential|authorization)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, 420) || "Codex app-server rejected the request without an explanation.";
}

class CodexExecutionError extends Error {
  readonly statusCode?: number;

  constructor(detail: string) {
    super(`Codex request failed: ${sanitizeCodexErrorDetail(detail)}`);
    this.name = "AI_APICallError";
    const normalized = detail.toLowerCase();
    if (
      normalized.includes("not logged in")
      || normalized.includes("authentication")
      || normalized.includes("unauthorized")
    ) {
      this.statusCode = 401;
    } else if (
      normalized.includes("rate limit")
      || normalized.includes("usage limit")
      || normalized.includes("spending limit")
      || normalized.includes("too many requests")
      || normalized.includes("quota")
    ) {
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

export function buildCodexArguments(): string[] {
  return ["app-server", "--stdio"];
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

function usageFrom(value: unknown): TokenUsage {
  const usage = record(value);
  const inputTokens = count(usage.inputTokens ?? usage.input_tokens);
  const outputTokens = count(usage.outputTokens ?? usage.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: count(usage.totalTokens ?? usage.total_tokens) || inputTokens + outputTokens,
    requests: 1,
  };
}

function responseFailure(message: Record<string, unknown>): string | undefined {
  if (!("error" in message) || message.error == null) return undefined;
  const error = record(message.error);
  return string(error.message) ?? "Codex app-server rejected a request.";
}

async function runCodex(options: CodexRunOptions): Promise<CodexRunResult> {
  if (options.signal.aborted) throw abortError();

  return await new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn(options.executable, buildCodexArguments(), {
      cwd: options.cwd,
      env: sanitizedCodexEnvironment(options.environment),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    let stderr = "";
    let spawnFailure: Error | undefined;
    let settled = false;
    let shuttingDown = false;
    let killTimer: NodeJS.Timeout | undefined;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let finalMessage: string | undefined;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 1 };
    let notificationQueue = Promise.resolve();
    const messageByItem = new Map<string, string>();

    const stopChild = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      child.stdin.end();
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref();
    };

    const finish = (error?: unknown, result?: CodexRunResult) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", abort);
      lines.close();
      stopChild();
      void notificationQueue.then(
        () => {
          if (error !== undefined) reject(error);
          else if (result) resolve(result);
          else reject(new CodexOutputError());
        },
        (queueError) => reject(queueError),
      );
    };

    const abort = () => finish(abortError());
    options.signal.addEventListener("abort", abort, { once: true });

    const send = (message: Record<string, unknown>) => {
      if (settled || child.stdin.destroyed) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const sendThreadStart = () => {
      send({
        id: 2,
        method: "thread/start",
        params: {
          model: options.modelId,
          ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
          cwd: options.cwd,
          approvalPolicy: "never",
          sandbox: "read-only",
          developerInstructions: options.developerInstructions,
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
        },
      });
    };

    const sendTurnStart = () => {
      if (!threadId) return;
      send({
        id: 3,
        method: "turn/start",
        params: {
          threadId,
          input: [{ type: "text", text: options.prompt, text_elements: [] }],
          ...(options.outputSchema !== undefined ? { outputSchema: options.outputSchema } : {}),
          ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
          ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
        },
      });
    };

    const queueText = (text: string) => {
      if (!options.onText) return;
      notificationQueue = notificationQueue.then(() => options.onText?.(text));
      notificationQueue.catch((error) => finish(error));
    };

    const handleMessage = (message: Record<string, unknown>) => {
      const failure = responseFailure(message);
      if (failure) {
        finish(new CodexExecutionError(failure));
        return;
      }

      const id = message.id;
      if (id === 1) {
        send({ method: "initialized", params: {} });
        sendThreadStart();
        return;
      }
      if (id === 2) {
        threadId = string(record(record(message.result).thread).id);
        if (!threadId) {
          finish(new CodexExecutionError("Codex did not return a thread identifier."));
          return;
        }
        sendTurnStart();
        return;
      }
      if (id === 3) {
        turnId = string(record(record(message.result).turn).id);
        if (!turnId) finish(new CodexExecutionError("Codex did not return a turn identifier."));
        return;
      }

      const method = string(message.method);
      const params = record(message.params);
      if (!method) return;
      if ("id" in message) {
        send({
          id: message.id as string | number,
          error: { code: -32601, message: `Unsupported server request: ${method}` },
        });
        return;
      }
      if (threadId && string(params.threadId) && string(params.threadId) !== threadId) return;
      if (turnId && string(params.turnId) && string(params.turnId) !== turnId) return;

      if (method === "item/agentMessage/delta") {
        const itemId = string(params.itemId);
        const delta = typeof params.delta === "string" ? params.delta : undefined;
        if (!itemId || !delta) return;
        const accumulated = `${messageByItem.get(itemId) ?? ""}${delta}`;
        messageByItem.set(itemId, accumulated);
        finalMessage = accumulated;
        queueText(accumulated);
        return;
      }
      if (method === "item/completed") {
        const item = record(params.item);
        if (string(item.type) !== "agentMessage") return;
        const text = textFromAgentItem(item);
        if (!text) return;
        finalMessage = text;
        if (![...messageByItem.values()].includes(text)) queueText(text);
        return;
      }
      if (method === "thread/tokenUsage/updated") {
        const tokenUsage = record(params.tokenUsage);
        usage = usageFrom(tokenUsage.last ?? tokenUsage.total);
        return;
      }
      if (method === "error") {
        const error = record(params.error);
        finish(new CodexExecutionError(string(error.message ?? params.message) ?? "Codex app-server error."));
        return;
      }
      if (method !== "turn/completed") return;

      const turn = record(params.turn);
      const status = string(turn.status);
      if (status === "interrupted") {
        finish(abortError());
      } else if (status !== "completed") {
        const error = record(turn.error);
        finish(new CodexExecutionError(string(error.message) ?? "Codex could not complete the turn."));
      } else if (!finalMessage) {
        finish(new CodexOutputError());
      } else {
        finish(undefined, { finalMessage, usage });
      }
    };

    child.stdout.on("error", (error) => finish(new CodexExecutionError(error.message)));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (Buffer.byteLength(stderr) < STDERR_LIMIT_BYTES) stderr += chunk;
    });
    child.stdin.on("error", () => undefined);
    child.once("error", (error) => {
      spawnFailure = error;
    });
    child.once("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (settled || shuttingDown) return;
      if (options.signal.aborted) finish(abortError());
      else if (spawnFailure) finish(new CodexExecutionError(spawnFailure.message));
      else finish(new CodexExecutionError(code === 0 ? "Codex app-server ended early." : stderr));
    });
    lines.on("line", (line) => {
      if (settled || !line.trim()) return;
      if (Buffer.byteLength(line) > APP_SERVER_LINE_LIMIT_BYTES) {
        finish(new CodexExecutionError("Codex app-server output exceeded its safety limit."));
        return;
      }
      try {
        handleMessage(record(JSON.parse(line)));
      } catch (error) {
        finish(error);
      }
    });

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "vibesurfer", title: "vibesurfer", version: "0.1.0" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });
  });
}

function findJsonStringStart(source: string, field: string): number | undefined {
  const key = JSON.stringify(field);
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(key, offset);
    if (index < 0) return undefined;
    let cursor = index + key.length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== ":") {
      offset = cursor;
      continue;
    }
    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] === "\"") return cursor + 1;
    offset = cursor;
  }
  return undefined;
}

export function extractPartialJsonStringField(source: string, field: string): string | undefined {
  const start = findJsonStringStart(source, field);
  if (start === undefined) return undefined;
  let result = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\"") return result;
    if (character !== "\\") {
      result += character;
      continue;
    }
    const escape = source[index + 1];
    if (escape === undefined) return result;
    const simple: Record<string, string> = {
      "\"": "\"",
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escape in simple) {
      result += simple[escape];
      index += 1;
      continue;
    }
    if (escape === "u") {
      const digits = source.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) return result;
      result += String.fromCharCode(Number.parseInt(digits, 16));
      index += 5;
      continue;
    }
    return result;
  }
  return result;
}

function partialObjectFromStructuredText(text: string): Record<string, unknown> | undefined {
  const html = extractPartialJsonStringField(text, "html");
  const title = extractPartialJsonStringField(text, "title");
  if (html === undefined && title === undefined) return undefined;
  return {
    ...(title !== undefined ? { meta: { title } } : {}),
    ...(html !== undefined ? { html } : {}),
  };
}

export class CodexModelExecutor implements ModelExecutor {
  readonly actualProviderKind = "codex" as const;
  readonly providerId: string;
  readonly modelId: string;
  readonly generationMode: "directed" | "compact";
  readonly #reasoningEffort: string | undefined;
  readonly #serviceTier: string | undefined;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(descriptor: CodexExecutorDescriptor) {
    this.providerId = descriptor.providerId;
    this.modelId = descriptor.modelId;
    this.generationMode = descriptor.generationMode ?? "directed";
    this.#reasoningEffort = descriptor.reasoningEffort;
    this.#serviceTier = descriptor.serviceTier;
    this.#environment = descriptor.environment ?? process.env;
  }

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    const startedAt = new Date();
    const executable = codexExecutableFromEnvironment(this.#environment);
    const temporaryRoot = await mkdtemp(join(tmpdir(), "vibesurfer-codex-"));
    const workspacePath = join(temporaryRoot, "workspace");
    try {
      await mkdir(workspacePath, { mode: 0o700 });
      const sourceOutputSchema = z.toJSONSchema(request.schema, {
        target: "draft-07",
        io: "output",
      });
      const outputSchema = normalizeCodexOutputSchema(sourceOutputSchema);
      let lastPartialFingerprint = "";
      const result = await runCodex({
        executable,
        cwd: workspacePath,
        environment: this.#environment,
        modelId: this.modelId,
        ...(this.#reasoningEffort ? { reasoningEffort: this.#reasoningEffort } : {}),
        ...(this.#serviceTier ? { serviceTier: this.#serviceTier } : {}),
        developerInstructions: instructionsFor(request),
        prompt: promptFor(request),
        outputSchema,
        signal: request.abortSignal,
        ...(request.onPartial
          ? {
              onText: async (text: string) => {
                const partial = partialObjectFromStructuredText(text);
                if (!partial) return;
                const fingerprint = JSON.stringify(partial);
                if (fingerprint === lastPartialFingerprint) return;
                lastPartialFingerprint = fingerprint;
                await request.onPartial?.(partial);
              },
            }
          : {}),
      });
      let decoded: unknown;
      try {
        decoded = JSON.parse(result.finalMessage);
      } catch {
        throw new CodexOutputError();
      }
      stripCodexOptionalNulls(decoded, sourceOutputSchema);
      const output = request.schema.parse(decoded);
      if (request.onPartial) {
        await request.onPartial(output);
      }
      const completedAt = new Date();
      return {
        output,
        usage: result.usage,
        exchange: createModelExchange({
          request,
          providerId: this.providerId,
          modelId: this.modelId,
          actualProviderKind: this.actualProviderKind,
          startedAt,
          completedAt,
          response: result.finalMessage,
          usage: result.usage,
        }),
      };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async generateText(request: GenerateTextRequest): Promise<GeneratedText> {
    const startedAt = new Date();
    const executable = codexExecutableFromEnvironment(this.#environment);
    const temporaryRoot = await mkdtemp(join(tmpdir(), "vibesurfer-codex-"));
    const workspacePath = join(temporaryRoot, "workspace");
    try {
      await mkdir(workspacePath, { mode: 0o700 });
      const result = await runCodex({
        executable,
        cwd: workspacePath,
        environment: this.#environment,
        modelId: this.modelId,
        ...(this.#reasoningEffort ? { reasoningEffort: this.#reasoningEffort } : {}),
        ...(this.#serviceTier ? { serviceTier: this.#serviceTier } : {}),
        developerInstructions: [CODEX_TEXT_INSTRUCTIONS, "", request.prompt.system].join("\n"),
        prompt: request.prompt.prompt,
        signal: request.abortSignal,
        ...(request.onPartialText ? { onText: request.onPartialText } : {}),
      });
      const completedAt = new Date();
      return {
        text: result.finalMessage,
        usage: result.usage,
        exchange: createModelExchange({
          request,
          providerId: this.providerId,
          modelId: this.modelId,
          actualProviderKind: this.actualProviderKind,
          startedAt,
          completedAt,
          response: result.finalMessage,
          usage: result.usage,
        }),
      };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}
