import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { InMemoryProviderRegistry } from "../src/providers/registry.js";
import { PublicProviderConnectionSchema } from "../src/protocol/types.js";
import { WorkerRuntime } from "../src/runtime.js";
import { generationCommand } from "./helpers.js";

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  rawBody: string;
  body: Record<string, unknown>;
}

async function readRequest(request: IncomingMessage): Promise<CapturedRequest> {
  let rawBody = "";
  for await (const chunk of request) {
    rawBody += chunk.toString();
  }
  return {
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization,
    contentType: request.headers["content-type"],
    rawBody,
    body: JSON.parse(rawBody) as Record<string, unknown>,
  };
}

function sendStructuredStream(response: ServerResponse): void {
  const object = JSON.stringify({ headline: "Adapter contract passed", count: 7 });
  const split = Math.floor(object.length / 2);
  const common = {
    id: "chatcmpl-contract",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "contract-model",
  };
  const chunks = [
    {
      ...common,
      choices: [{ index: 0, delta: { role: "assistant", content: object.slice(0, split) }, finish_reason: null }],
    },
    {
      ...common,
      choices: [{ index: 0, delta: { content: object.slice(split) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    },
  ];

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe("OpenAI-compatible AI SDK HTTP contract", () => {
  it("sends auth and JSON Schema, parses structured SSE, and redacts public failures", async () => {
    const secret = "sk-contract-secret-never-emit";
    const captured: CapturedRequest[] = [];
    let responseMode: "success" | "authentication-error" = "success";
    const server = createServer((request, response) => {
      void readRequest(request).then((value) => {
        captured.push(value);
        if (responseMode === "authentication-error") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({
            error: {
              type: "authentication_error",
              code: "invalid_api_key",
              message: `The fake provider rejected ${secret}`,
            },
          }));
          return;
        }
        sendStructuredStream(response);
      }).catch(() => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "The fake provider could not read the request." } }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      const address = server.address() as AddressInfo;
      const loopbackBaseUrl = `http://127.0.0.1:${address.port}/v1`;
      const connection = {
        id: "contract-provider",
        kind: "openai-compatible" as const,
        displayName: "Local contract provider",
        baseUrl: loopbackBaseUrl,
        supportsStructuredOutputs: true,
        mockLatencyMs: 0,
      };

      // The host protocol remains HTTPS-only. This test deliberately enters at
      // the in-memory registry boundary so the real SDK transport can reach an
      // ephemeral loopback HTTP server without weakening production validation.
      expect(PublicProviderConnectionSchema.safeParse(connection).success).toBe(false);

      const registry = new InMemoryProviderRegistry();
      registry.upsert(connection, { apiKey: secret });
      const executor = registry.resolve(connection.id, "contract-model", "contract-seed");
      const schema = z.object({
        headline: z.string(),
        count: z.number().int(),
      }).strict();
      const invoke = () => executor.generateObject({
        purpose: "page-director" as const,
        schema,
        prompt: {
          system: "contract-system",
          prompt: "contract-prompt",
          fingerprint: "contract-fingerprint",
          version: 1,
        },
        abortSignal: AbortSignal.timeout(5_000),
        maxOutputTokens: 512,
      });

      const result = await invoke();
      expect(result).toMatchObject({
        output: { headline: "Adapter contract passed", count: 7 },
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, requests: 1 },
        exchange: {
          purpose: "page-director",
          providerId: "contract-provider",
          modelId: "contract-model",
          systemPrompt: "contract-system",
          prompt: "contract-prompt",
          response: '{"headline":"Adapter contract passed","count":7}',
        },
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(registry.list())).not.toContain(secret);

      expect(captured).toHaveLength(1);
      const request = captured[0];
      expect(request).toMatchObject({
        method: "POST",
        url: "/v1/chat/completions",
        authorization: `Bearer ${secret}`,
      });
      expect(request.contentType).toContain("application/json");
      expect(request.rawBody).not.toContain(secret);
      expect(request.body).toMatchObject({
        model: "contract-model",
        max_tokens: 512,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: "contract-system" },
          { role: "user", content: "contract-prompt" },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "vibesurfer_page_director",
            description: "A strictly validated vibesurfer generation-stage result.",
            strict: true,
          },
        },
      });

      const responseFormat = request.body.response_format as {
        json_schema: { schema: Record<string, unknown> };
      };
      expect(responseFormat.json_schema.schema).toMatchObject({
        type: "object",
        additionalProperties: false,
        properties: {
          headline: { type: "string" },
          count: { type: "integer" },
        },
      });
      expect(responseFormat.json_schema.schema.required).toEqual(expect.arrayContaining(["headline", "count"]));

      responseMode = "authentication-error";
      const outputs: Array<Record<string, unknown>> = [];
      let resolveTerminal!: () => void;
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const runtime = new WorkerRuntime((output) => {
        const value = output as Record<string, unknown>;
        outputs.push(value);
        if (value.type === "generation.failed") {
          resolveTerminal();
        }
      }, registry);
      try {
        await runtime.handle(generationCommand({
          requestId: "contract-error-request",
          jobId: "contract-error-job",
          provider: { connectionId: connection.id, modelId: "contract-model" },
        }));
        await Promise.race([
          terminal,
          new Promise<never>((_resolve, reject) => {
            AbortSignal.timeout(5_000).addEventListener("abort", () => reject(new Error("worker output timed out")), { once: true });
          }),
        ]);
      } finally {
        await runtime.close();
      }
      expect(outputs.find((output) => output.type === "generation.failed")).toMatchObject({
        type: "generation.failed",
        error: {
          code: "invalid-api-key",
          message: "The provider rejected the configured credential.",
          retryable: false,
        },
      });
      expect(JSON.stringify(outputs)).not.toContain(secret);
      expect(captured).toHaveLength(2);
      expect(captured[1].authorization).toBe(`Bearer ${secret}`);
      expect(captured[1].rawBody).not.toContain(secret);
    } finally {
      await closeServer(server);
    }
  });
});
