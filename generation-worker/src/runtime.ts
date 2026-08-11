import { z } from "zod";

import { PROTOCOL_VERSION, type GenerationPhase } from "./domain.js";
import { normalizeError } from "./errors.js";
import { runGenerationPipeline, type PipelineEmitter } from "./pipelines/index.js";
import { InMemoryProviderRegistry } from "./providers/registry.js";
import { normalizeHostGeneration, normalizeProviderVerification } from "./protocol/compat.js";
import { parseCommandLine } from "./protocol/parse.js";
import type {
  GenerateCommand,
  HostWorkerOutput,
  PublicProviderConnection,
  WorkerInput,
  WorkerOutput,
} from "./protocol/types.js";

const WORKER_VERSION = "0.1.0";

type AnyOutput = HostWorkerOutput | WorkerOutput | Record<string, unknown>;
export type OutputSink = (output: AnyOutput) => void | Promise<void>;
type SequencedHostOutput = Extract<HostWorkerOutput, { sequence: number }>;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, "sequence" | "at"> : never;
type JobOutputInput = WithoutEnvelope<SequencedHostOutput>;

interface ActiveJob {
  controller: AbortController;
  requestId: string;
  promise: Promise<void>;
  ephemeralConnectionId?: string;
}

function externalPhase(phase: GenerationPhase): string {
  switch (phase) {
    case "planning-site":
    case "planning-page":
      return "planning";
    case "repairing":
      return "validating";
    default:
      return phase;
  }
}

export class WorkerRuntime {
  readonly registry: InMemoryProviderRegistry;
  readonly #jobs = new Map<string, ActiveJob>();
  readonly #send: OutputSink;
  #shutdownRequested = false;

  constructor(send: OutputSink, registry = new InMemoryProviderRegistry()) {
    this.#send = send;
    this.registry = registry;
  }

  get activeJobCount(): number {
    return this.#jobs.size;
  }

  get shutdownRequested(): boolean {
    return this.#shutdownRequested;
  }

  async handleLine(line: string): Promise<void> {
    const parsed = parseCommandLine(line);
    if (!parsed.ok) {
      await this.#send({
        v: PROTOCOL_VERSION,
        type: "error",
        ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
        code: "invalid-command",
        message: parsed.message,
        ...(parsed.issues ? { issues: parsed.issues } : {}),
      });
      return;
    }
    await this.handle(parsed.command);
  }

  async handle(command: WorkerInput): Promise<void> {
    switch (command.type) {
      case "initialize":
        await this.#send({
          type: "initialized",
          requestId: command.requestId,
          protocolVersion: PROTOCOL_VERSION,
          workerVersion: WORKER_VERSION,
          capabilities: {
            modes: ["quick", "deep"],
            providers: ["mock", "openai", "anthropic", "google", "openai-compatible", "codex"],
          },
        });
        return;
      case "ping":
        await this.#send({
          v: PROTOCOL_VERSION,
          type: "pong",
          requestId: command.requestId,
          activeJobs: this.#jobs.size,
        });
        return;
      case "provider.upsert":
        this.registry.upsert(command.connection, command.credentials);
        await this.#send({ v: PROTOCOL_VERSION, type: "ack", requestId: command.requestId, accepted: true });
        return;
      case "provider.remove":
        this.registry.remove(command.connectionId);
        await this.#send({ v: PROTOCOL_VERSION, type: "ack", requestId: command.requestId, accepted: true });
        return;
      case "provider.list":
        await this.#send({
          v: PROTOCOL_VERSION,
          type: "provider.list.result",
          requestId: command.requestId,
          connections: this.registry.list(),
        });
        return;
      case "provider.verify":
        await this.verifyProvider(command);
        return;
      case "generate":
        if ("request" in command) {
          const normalized = normalizeHostGeneration(command);
          this.registry.upsert(normalized.connection, normalized.credentials);
          await this.startJob(normalized.command, normalized.connection.id);
        } else {
          await this.startJob(command);
        }
        return;
      case "cancel":
        await this.cancelJob(command.requestId, command.jobId);
        return;
      case "shutdown":
        this.#shutdownRequested = true;
        for (const job of this.#jobs.values()) {
          job.controller.abort();
        }
        this.registry.clearSecrets();
        await this.#send({ v: PROTOCOL_VERSION, type: "ack", requestId: command.requestId, accepted: true });
        return;
    }
  }

  async close(): Promise<void> {
    for (const job of this.#jobs.values()) {
      job.controller.abort();
    }
    await Promise.allSettled([...this.#jobs.values()].map((job) => job.promise));
    this.registry.clearSecrets();
  }

  private async verifyProvider(command: Extract<WorkerInput, { type: "provider.verify" }>): Promise<void> {
    let connection: PublicProviderConnection | undefined;
    try {
      const normalized = normalizeProviderVerification(command);
      connection = normalized.connection;
      this.registry.upsert(normalized.connection, normalized.credentials);
      const executor = this.registry.resolve(connection.id, normalized.modelId, `verify:${command.requestId}`);
      if (executor.actualProviderKind !== "mock") {
        const signal = AbortSignal.timeout(25_000);
        const schema = z.object({ ok: z.boolean() }).strict();
        const prompt = {
          system: "This is a minimal provider connectivity check. Return only the requested structured object and do not include secrets or request metadata.",
          prompt: "Return an object whose ok field is true.",
          fingerprint: "provider-connectivity-check-v1",
          version: 1,
        };
        const result = await executor.generateObject({
          purpose: "quick-page",
          schema,
          prompt,
          abortSignal: signal,
          maxOutputTokens: 512,
        });
        if (!result.output.ok) {
          throw new Error("Provider returned a negative verification result.");
        }
      }
      await this.#send({
        type: "provider.verified",
        requestId: command.requestId,
        provider: { id: connection.id, kind: connection.kind, modelId: normalized.modelId },
      });
    } catch (error) {
      const normalized = normalizeError(error);
      await this.#send({
        type: "provider.failed",
        requestId: command.requestId,
        error: normalized,
      });
    } finally {
      if (connection) {
        this.registry.remove(connection.id);
      }
    }
  }

  private async startJob(request: GenerateCommand, ephemeralConnectionId?: string): Promise<void> {
    if (this.#jobs.has(request.jobId)) {
      await this.#send({
        v: PROTOCOL_VERSION,
        type: "error",
        requestId: request.requestId,
        code: "duplicate-job",
        message: "A generation with this jobId is already active.",
      });
      return;
    }
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => this.runJob(request, controller.signal)).finally(() => {
      this.#jobs.delete(request.jobId);
      if (ephemeralConnectionId) {
        this.registry.remove(ephemeralConnectionId);
      }
    });
    this.#jobs.set(request.jobId, {
      controller,
      requestId: request.requestId,
      promise,
      ...(ephemeralConnectionId ? { ephemeralConnectionId } : {}),
    });
    await this.#send({ v: PROTOCOL_VERSION, type: "ack", requestId: request.requestId, accepted: true });
  }

  private async cancelJob(requestId: string, jobId: string): Promise<void> {
    const job = this.#jobs.get(jobId);
    if (job) {
      job.controller.abort();
    }
    await this.#send({ v: PROTOCOL_VERSION, type: "ack", requestId, accepted: Boolean(job) });
  }

  private async runJob(request: GenerateCommand, signal: AbortSignal): Promise<void> {
    let sequence = 0;
    const sendJob = async (output: JobOutputInput) => {
      sequence += 1;
      await this.#send({ ...output, sequence, at: new Date().toISOString() });
    };

    try {
      const executor = this.registry.resolve(
        request.provider.connectionId,
        request.provider.modelId,
        `${request.jobId}:${request.url}`,
      );
      await sendJob({
        type: "generation.started",
        requestId: request.requestId,
        jobId: request.jobId,
        url: request.url,
        mode: request.mode,
        providerId: executor.providerId,
        modelId: executor.modelId,
        actualProviderKind: executor.actualProviderKind,
      });
      const emitter: PipelineEmitter = {
        phase: async (phase, progress) => {
          await sendJob({
            type: "generation.phase",
            requestId: request.requestId,
            jobId: request.jobId,
            phase: externalPhase(phase),
            progress,
          });
        },
        metadata: async (metadata) => {
          await sendJob({
            type: "generation.metadata",
            requestId: request.requestId,
            jobId: request.jobId,
            ...metadata,
          });
        },
        validation: async (issues, repairWillRun) => {
          await sendJob({
            type: "generation.validation",
            requestId: request.requestId,
            jobId: request.jobId,
            issues,
            repairWillRun,
          });
        },
        warning: async (warning) => {
          await sendJob({
            type: "generation.warning",
            requestId: request.requestId,
            jobId: request.jobId,
            code: warning.code,
            message: warning.message,
          });
        },
      };
      const result = await runGenerationPipeline({ request, executor, signal, emit: emitter });
      await emitter.phase("completed", 1);
      await sendJob({
        type: "generation.completed",
        requestId: request.requestId,
        jobId: request.jobId,
        artifact: result.artifact,
        usage: result.usage,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === "cancelled" || signal.aborted) {
        await sendJob({
          type: "generation.cancelled",
          requestId: request.requestId,
          jobId: request.jobId,
        });
      } else {
        await sendJob({
          type: "generation.failed",
          requestId: request.requestId,
          jobId: request.jobId,
          error: normalized,
        });
      }
    }
  }
}
