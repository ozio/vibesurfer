import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderV4 } from "@ai-sdk/provider";
import { createProviderRegistry } from "ai";

import type { ProviderCredentials, PublicConnectionStatus, PublicProviderConnection } from "../protocol/types.js";
import { AiSdkModelExecutor, type ModelExecutor } from "./executor.js";
import { DeterministicMockExecutor } from "./mock.js";

interface ConnectionRecord {
  public: PublicProviderConnection;
  credentials?: ProviderCredentials;
}

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderRouteRequiredError extends Error {
  constructor() {
    super("Codex generation is host-owned and must be routed through the Codex App Server adapter.");
    this.name = "ProviderRouteRequiredError";
  }
}

function createSdkModel(provider: ProviderV4, modelId: string) {
  const registry = createProviderRegistry({ selected: provider }, { separator: "::" });
  return registry.languageModel(`selected::${modelId}`);
}

export class InMemoryProviderRegistry {
  readonly #connections = new Map<string, ConnectionRecord>();

  constructor() {
    this.#connections.set("mock", {
      public: {
        id: "mock",
        kind: "mock",
        displayName: "Deterministic mock",
        supportsStructuredOutputs: true,
        mockLatencyMs: 0,
      },
    });
  }

  upsert(connection: PublicProviderConnection, credentials?: ProviderCredentials): void {
    const current = this.#connections.get(connection.id);
    this.#connections.set(connection.id, {
      public: structuredClone(connection),
      ...(credentials !== undefined
        ? { credentials: structuredClone(credentials) }
        : current?.credentials
          ? { credentials: current.credentials }
          : {}),
    });
  }

  remove(connectionId: string): boolean {
    if (connectionId === "mock") {
      return false;
    }
    return this.#connections.delete(connectionId);
  }

  clearSecrets(): void {
    for (const record of this.#connections.values()) {
      delete record.credentials;
    }
  }

  list(): PublicConnectionStatus[] {
    return [...this.#connections.values()].map((record) => ({
      ...structuredClone(record.public),
      hasCredentials: Boolean(record.credentials?.apiKey),
    }));
  }

  resolve(connectionId: string, modelId: string, seed: string): ModelExecutor {
    const record = this.#connections.get(connectionId);
    if (!record) {
      throw new ProviderConfigurationError("The selected provider connection does not exist.");
    }

    const apiKey = record.credentials?.apiKey;
    if (record.public.kind === "codex") {
      throw new ProviderRouteRequiredError();
    }
    if (record.public.kind === "mock") {
      return new DeterministicMockExecutor({
        providerId: connectionId,
        modelId,
        seed,
        latencyMs: record.public.mockLatencyMs,
      });
    }
    if (!apiKey) {
      throw new ProviderConfigurationError("The selected provider connection has no API credential.");
    }

    const shared = {
      apiKey,
      ...(record.public.baseUrl ? { baseURL: record.public.baseUrl } : {}),
      ...(record.credentials?.headers ? { headers: record.credentials.headers } : {}),
    };

    let provider: ProviderV4;
    switch (record.public.kind) {
      case "openai":
        provider = createOpenAI({ ...shared, name: `vibesurfer-${connectionId}` });
        break;
      case "anthropic":
        provider = createAnthropic({ ...shared, name: `vibesurfer-${connectionId}` });
        break;
      case "google":
        provider = createGoogleGenerativeAI({ ...shared, name: `vibesurfer-${connectionId}` });
        break;
      case "openai-compatible":
        if (!record.public.baseUrl) {
          throw new ProviderConfigurationError("OpenAI-compatible providers require an HTTPS baseUrl.");
        }
        provider = createOpenAICompatible({
          ...shared,
          baseURL: record.public.baseUrl,
          name: `vibesurfer-${connectionId}`,
          includeUsage: true,
          supportsStructuredOutputs: record.public.supportsStructuredOutputs,
        });
        break;
    }

    return new AiSdkModelExecutor(createSdkModel(provider, modelId), {
      providerId: connectionId,
      modelId,
      actualProviderKind: record.public.kind,
    });
  }
}
