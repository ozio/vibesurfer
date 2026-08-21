import { z } from "zod";

import {
  BrowserThemeSchema,
  DynamicRegionResultSchema,
  FaviconDescriptorSchema,
  GenerationContextSchema,
  GenerationSettingsSchema,
  PageArtifactSchema,
  ProfilePromptSnapshotSchema,
  ProviderKindSchema,
  ProviderReferenceSchema,
  SiteIdentitySchema,
  JsonValueSchema,
  PROTOCOL_VERSION,
  TokenUsageSchema,
  type FaviconDescriptor,
  type GenerationPhase,
  type HtmlIssue,
  type PageArtifact,
  type ProviderKind,
  type TokenUsage,
} from "../domain.js";

const IdSchema = z.string().min(1).max(160);
const HttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Only http and https URLs are supported");
const ProviderBaseUrlSchema = HttpUrlSchema.refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
}, "Provider base URLs must use HTTPS, except for HTTP loopback addresses");

export const PublicProviderConnectionSchema = z
  .object({
    id: IdSchema,
    kind: ProviderKindSchema,
    displayName: z.string().min(1).max(120),
    baseUrl: ProviderBaseUrlSchema.optional(),
    supportsStructuredOutputs: z.boolean().default(true),
    generationMode: z.enum(["directed", "compact"]).optional(),
    mockLatencyMs: z.number().int().min(0).max(30_000).default(0),
  })
  .strict();
export type PublicProviderConnection = z.infer<typeof PublicProviderConnectionSchema>;

export const ProviderCredentialsSchema = z
  .object({
    apiKey: z.string().min(1).max(16_384).optional(),
    headers: z.record(z.string().max(200), z.string().max(16_384)).optional(),
  })
  .strict();
export type ProviderCredentials = z.infer<typeof ProviderCredentialsSchema>;

export const PingCommandSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("ping"),
    requestId: IdSchema,
  })
  .strict();

export const ProviderUpsertCommandSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("provider.upsert"),
    requestId: IdSchema,
    connection: PublicProviderConnectionSchema,
    credentials: ProviderCredentialsSchema.optional(),
  })
  .strict();

export const ProviderRemoveCommandSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("provider.remove"),
    requestId: IdSchema,
    connectionId: IdSchema,
  })
  .strict();

export const ProviderListCommandSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("provider.list"),
    requestId: IdSchema,
  })
  .strict();

export const GenerateCommandSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("generate"),
    requestId: IdSchema,
    jobId: IdSchema,
    profileId: IdSchema,
    siteWorldId: IdSchema,
    url: HttpUrlSchema,
    browserTheme: BrowserThemeSchema.default("native"),
    discovery: z.object({ kind: z.literal("lucky-urls"), count: z.literal(10) }).strict().optional(),
    provider: ProviderReferenceSchema,
    worldPromptSnapshot: ProfilePromptSnapshotSchema,
    settings: GenerationSettingsSchema.default({
      tailwindEnabled: true,
      tailwindVersion: "4.3.3",
      allowGeneratedScripts: false,
      motionEnabled: true,
      dynamicMode: "active",
      capabilities: {
        audioSpeechEnabled: true,
        externalMediaEnabled: false,
        experimentalEnabled: false,
      },
      voice: { engine: "local", provider: "openai", model: "kokoro-82m-q8", voice: "af_heart", speed: 1, musicEnabled: true },
      images: { mode: "tag-placeholder", fetchExternal: true, safeContent: true },
      maxOutputTokens: 20_000,
      minInternalLinks: 4,
      maxArtifactBytes: 1_000_000,
    }),
    context: GenerationContextSchema,
  })
  .strict();
export type GenerateCommand = z.infer<typeof GenerateCommandSchema>;

export const DynamicGenerateCommandSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("dynamic.generate"),
  requestId: IdSchema,
  jobId: IdSchema,
  profileId: IdSchema,
  siteWorldId: IdSchema,
  url: HttpUrlSchema,
  provider: ProviderReferenceSchema,
  worldPromptSnapshot: ProfilePromptSnapshotSchema,
  siteIdentity: SiteIdentitySchema,
  page: z.object({
    title: z.string().min(1).max(240),
    summary: z.string().max(1_000),
  }).strict(),
  action: z.object({
    action: z.string().regex(/^(?:model:[a-z][a-z0-9.-]{0,63}|timer:refresh|manual:refresh)$/),
    trigger: z.enum(["action", "timer", "manual"]),
    targets: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)).min(1).max(16),
    fields: z.record(z.string().max(512), z.array(z.string().max(2_000)).max(32)).default({}),
  }).strict(),
  regions: z.array(z.object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
    html: z.string().max(64 * 1024),
    revision: z.number().int().nonnegative(),
  }).strict()).min(1).max(16),
  trustedState: JsonValueSchema,
  modelState: JsonValueSchema.optional(),
  settings: GenerationSettingsSchema,
  browserTheme: BrowserThemeSchema.default("native"),
}).strict();
export type DynamicGenerateCommand = z.infer<typeof DynamicGenerateCommandSchema>;

export const CancelCommandSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("cancel"),
    requestId: IdSchema,
    jobId: IdSchema,
  })
  .strict();

export const ShutdownCommandSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("shutdown"),
    requestId: IdSchema,
  })
  .strict();

export const WorkerCommandSchema = z.discriminatedUnion("type", [
  PingCommandSchema,
  ProviderUpsertCommandSchema,
  ProviderRemoveCommandSchema,
  ProviderListCommandSchema,
  GenerateCommandSchema,
  DynamicGenerateCommandSchema,
  CancelCommandSchema,
  ShutdownCommandSchema,
]);
export type WorkerCommand = z.infer<typeof WorkerCommandSchema>;

export const InitializeCommandSchema = z
  .object({
    type: z.literal("initialize"),
    requestId: IdSchema,
    protocolVersion: z.literal(PROTOCOL_VERSION),
    client: z
      .object({
        name: z.string().min(1).max(120),
        version: z.string().min(1).max(80),
      })
      .strict(),
  })
  .strict();

export const HostGenerateCommandSchema = z
  .object({
    type: z.literal("generate"),
    requestId: IdSchema,
    jobId: IdSchema,
    request: z.record(z.string(), z.unknown()),
    credential: z.string().min(1).max(16_384).optional(),
  })
  .strict();

export const ProviderVerifyCommandSchema = z
  .object({
    type: z.literal("provider.verify"),
    requestId: IdSchema,
    provider: z.record(z.string(), z.unknown()),
    credential: z.string().min(1).max(16_384),
  })
  .strict();

export const HostCancelCommandSchema = z
  .object({
    type: z.literal("cancel"),
    requestId: IdSchema,
    jobId: IdSchema,
  })
  .strict();

export type InitializeCommand = z.infer<typeof InitializeCommandSchema>;
export type HostGenerateCommand = z.infer<typeof HostGenerateCommandSchema>;
export type ProviderVerifyCommand = z.infer<typeof ProviderVerifyCommandSchema>;
export type HostCancelCommand = z.infer<typeof HostCancelCommandSchema>;
export type WorkerInput =
  | WorkerCommand
  | InitializeCommand
  | HostGenerateCommand
  | ProviderVerifyCommand
  | HostCancelCommand;

export type GenerationErrorCode =
  | "invalid-command"
  | "duplicate-job"
  | "provider-not-configured"
  | "invalid-api-key"
  | "rate-limited"
  | "provider-unavailable"
  | "timeout"
  | "cancelled"
  | "malformed-output"
  | "unsafe-output"
  | "style-compilation-failed"
  | "image-resolution-failed"
  | "provider-route-required"
  | "worker-error";

export type PublicConnectionStatus = PublicProviderConnection & {
  hasCredentials: boolean;
};

export type GenerationEvent =
  | {
      type: "generation.started";
      siteWorldId: string;
      url: string;
      providerId: string;
      modelId: string;
      actualProviderKind: ProviderKind;
    }
  | { type: "phase.changed"; phase: GenerationPhase; progress: number }
  | { type: "generation.progress"; stage: string; stageIndex: number; stageCount: number; currentOutputTokens?: number; maxOutputTokens?: number; approximate: boolean; percent: number }
  | { type: "generation.stage"; stage: string; status: string; startedAt: string; completedAt?: string; payload: Record<string, unknown> }
  | {
      type: "metadata.partial";
      title?: string;
      favicon?: FaviconDescriptor;
      summary?: string;
    }
  | { type: "validation.report"; issues: HtmlIssue[] }
  | { type: "generation.warning"; code: string; message: string }
  | { type: "generation.completed"; artifact: PageArtifact }
  | { type: "generation.cancelled" }
  | {
      type: "generation.failed";
      code: GenerationErrorCode;
      message: string;
      retryable: boolean;
    };

export type DynamicGenerationEvent =
  | { type: "dynamic.started"; providerId: string; modelId: string; actualProviderKind: ProviderKind }
  | { type: "dynamic.completed"; result: z.infer<typeof DynamicRegionResultSchema>; usage: TokenUsage }
  | { type: "dynamic.cancelled" }
  | { type: "dynamic.failed"; code: GenerationErrorCode; message: string; retryable: boolean };

export type WorkerOutput =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ready";
      workerVersion: string;
      capabilities: {
        generationStages: ["page-director", "page-builder", "region-builder"];
        providers: ProviderKind[];
        protocolVersion: typeof PROTOCOL_VERSION;
      };
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ack";
      requestId: string;
      accepted: boolean;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "pong";
      requestId: string;
      activeJobs: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "provider.list.result";
      requestId: string;
      connections: PublicConnectionStatus[];
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "event";
      jobId: string;
      sequence: number;
      timestamp: string;
      event: GenerationEvent | DynamicGenerationEvent;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "error";
      requestId?: string;
      code: GenerationErrorCode;
      message: string;
      issues?: Array<{ path: string; message: string }>;
    };

export type HostWorkerOutput =
  | {
      type: "initialized";
      requestId: string;
      protocolVersion: typeof PROTOCOL_VERSION;
      workerVersion: string;
      capabilities: {
        generationStages: ["page-director", "page-builder", "region-builder"];
        providers: ProviderKind[];
      };
    }
  | {
      type: "provider.verified";
      requestId: string;
      provider: { id: string; kind: ProviderKind; modelId: string };
    }
  | {
      type: "provider.failed";
      requestId: string;
      error: { code: GenerationErrorCode; message: string; retryable: boolean };
    }
  | {
      type: "generation.started";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      url: string;
      siteWorldId: string;
      providerId: string;
      modelId: string;
      actualProviderKind: ProviderKind;
    }
  | {
      type: "generation.phase";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      phase: string;
      progress: number;
    }
  | {
      type: "generation.metadata";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      title?: string;
      favicon?: FaviconDescriptor;
      summary?: string;
    }
  | {
      type: "generation.preview";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      html: string;
    }
  | {
      type: "generation.progress";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      stage: string;
      stageIndex: number;
      stageCount: number;
      currentOutputTokens?: number;
      maxOutputTokens?: number;
      approximate: boolean;
      percent: number;
    }
  | {
      type: "generation.stage";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      stage: string;
      status: string;
      startedAt: string;
      completedAt?: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "generation.validation";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      issues: HtmlIssue[];
    }
  | {
      type: "generation.warning";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      code: string;
      message: string;
    }
  | {
      type: "generation.completed";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      artifact: PageArtifact;
      usage: TokenUsage;
    }
  | {
      type: "generation.failed";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      error: { code: GenerationErrorCode; message: string; retryable: boolean };
    }
  | {
      type: "generation.cancelled";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
    }
  | {
      type: "dynamic.started";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      providerId: string;
      modelId: string;
      actualProviderKind: ProviderKind;
    }
  | {
      type: "dynamic.completed";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      result: z.infer<typeof DynamicRegionResultSchema>;
      usage: TokenUsage;
    }
  | {
      type: "dynamic.failed";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
      error: { code: GenerationErrorCode; message: string; retryable: boolean };
    }
  | {
      type: "dynamic.cancelled";
      requestId: string;
      jobId: string;
      sequence: number;
      at: string;
    };

export const ProtocolOutputSchemas = {
  favicon: FaviconDescriptorSchema,
  artifact: PageArtifactSchema,
  usage: TokenUsageSchema,
} as const;

export type { PageArtifact, TokenUsage };
