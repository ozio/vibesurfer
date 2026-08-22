import { describe, expect, it } from "vitest";

import { runGenerationPipeline, UnsafeOutputError, type PipelineEmitter } from "../src/pipelines/index.js";
import { normalizeGeneratedHtml } from "../src/pipelines/compact.js";
import { createProgressivePagePreview } from "../src/pipelines/shared.js";
import { DeterministicMockExecutor } from "../src/providers/mock.js";
import {
  createModelExchange,
  type GenerateObjectRequest,
  type GeneratedObject,
  type GeneratedText,
  type GenerateTextRequest,
  type ModelExecutor,
} from "../src/providers/executor.js";
import type { DirectorResult, SiteIdentity } from "../src/domain.js";
import { generationCommand } from "./helpers.js";

function emitter() {
  const phases: string[] = [];
  const validations: Array<{ issueCount: number }> = [];
  const value: PipelineEmitter = {
    phase: (phase) => void phases.push(phase),
    metadata: () => undefined,
    preview: () => undefined,
    validation: (issues) => void validations.push({ issueCount: issues.length }),
    warning: () => undefined,
  };
  return { value, phases, validations };
}

class BrokenBuilderExecutor implements ModelExecutor {
  readonly actualProviderKind = "mock" as const;
  readonly providerId = "mock";
  readonly modelId = "mock-v1";
  readonly calls: string[] = [];
  readonly #delegate = new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "broken" });

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    this.calls.push(request.purpose);
    const result = await this.#delegate.generateObject(request);
    if (request.purpose !== "page-builder") return result;
    const output = structuredClone(result.output) as T & { html: string };
    output.html = output.html.replaceAll(/href="[^"]+"/g, 'href="#"');
    return { ...result, output };
  }
}

class MutatingExistingDirectorExecutor implements ModelExecutor {
  readonly actualProviderKind = "mock" as const;
  readonly providerId = "mock";
  readonly modelId = "mock-v1";
  readonly calls: string[] = [];
  readonly #delegate = new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "mutating-existing" });

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    this.calls.push(request.purpose);
    const result = await this.#delegate.generateObject(request);
    if (request.purpose !== "page-director") return result;
    const output = structuredClone(result.output) as T & { direction: { palette: { accent: string } } };
    output.direction.palette.accent = "#ff0000";
    return { ...result, output };
  }
}

class DivergentNewDirectorExecutor implements ModelExecutor {
  readonly actualProviderKind = "mock" as const;
  readonly providerId = "mock";
  readonly modelId = "mock-v1";
  readonly #delegate = new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "divergent-new" });

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    const result = await this.#delegate.generateObject(request);
    if (request.purpose !== "page-director") return result;
    const output = structuredClone(result.output) as T & {
      direction: { era: string; palette: { accent: string } };
    };
    output.direction.era = "slightly different wording";
    output.direction.palette.accent = "#ff0000";
    return { ...result, output };
  }
}

class CompactLocalExecutor implements ModelExecutor {
  readonly actualProviderKind = "openai-compatible" as const;
  readonly providerId = "local-evo";
  readonly modelId = "small-local-model";
  readonly generationMode = "compact" as const;
  readonly calls: string[] = [];
  readonly textRequests: GenerateTextRequest[] = [];

  async generateObject<T>(_request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    throw new Error("Compact mode must not request structured output.");
  }

  async generateText(request: GenerateTextRequest): Promise<GeneratedText> {
    this.calls.push(request.purpose);
    this.textRequests.push(request);
    const startedAt = new Date();
    const text = `\`\`\`html
<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Карманная энциклопедия воды</title><meta name="description" content="Практическая памятка об обезвоживании"><style>body{font-family:Arial,sans-serif;max-width:50rem;margin:auto;padding:2rem}nav{display:flex;gap:1rem;flex-wrap:wrap}</style></head><body><nav><a href="/">Главная</a><a href="/symptoms">Симптомы</a><a href="/prevention">Профилактика</a><a href="/help">Помощь</a></nav><main><h1>Обезвоживание</h1><p>Обезвоживание возникает, когда организм теряет больше жидкости, чем получает.</p><h2>Что делать</h2><p>Пейте жидкость небольшими порциями и обращайтесь за помощью при выраженной слабости или спутанности сознания.</p></main></body></html>
\`\`\``;
    await request.onPartialText?.(text.slice(0, 240));
    await request.onPartialText?.(text);
    const inputTokens = Math.ceil((request.prompt.system.length + request.prompt.prompt.length) / 4);
    const outputTokens = Math.ceil(text.length / 4);
    const usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, requests: 1 };
    const completedAt = new Date();
    return {
      text,
      usage,
      exchange: createModelExchange({
        request,
        providerId: this.providerId,
        modelId: this.modelId,
        actualProviderKind: this.actualProviderKind,
        startedAt,
        completedAt,
        response: text,
        usage,
      }),
    };
  }
}

describe("directed generation pipeline", () => {
  it("coalesces rapid HTML deltas but always emits the latest trailing preview", async () => {
    const previews: string[] = [];
    const events = emitter();
    events.value.preview = (html) => void previews.push(html);
    const progressive = createProgressivePagePreview({ request: generationCommand(), emit: events.value });
    await progressive.handle({ html: "<main><h1>First fragment</h1></main>" });
    await progressive.handle({ html: "<main><h1>Second fragment</h1></main>" });
    await progressive.handle({ html: "<main><h1>Latest fragment</h1><p>Trailing HTML</p></main>" });
    await progressive.flush();
    expect(previews.length).toBeGreaterThanOrEqual(2);
    expect(previews.at(-1)).toContain("Latest fragment");
  });

  it("uses exactly Director then Builder and hides the full catalog from Builder", async () => {
    const request = generationCommand({ url: "https://bububu.com/" });
    const executor = new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "bububu" });
    const events = emitter();
    const result = await runGenerationPipeline({ request, executor, signal: new AbortController().signal, emit: events.value });

    expect(executor.calls).toEqual(["page-director", "page-builder"]);
    expect(result.usage.requests).toBe(2);
    expect(result.artifact.modelExchanges.map((exchange) => exchange.purpose)).toEqual(["page-director", "page-builder"]);
    expect(result.artifact.modelExchanges[0]!.prompt).toContain("<capability_catalog>");
    expect(result.artifact.modelExchanges[0]!.prompt).toContain("unknown hostname");
    expect(result.artifact.modelExchanges[1]!.prompt).not.toContain("<capability_catalog>");
    expect(result.artifact.modelExchanges[1]!.prompt).toContain("<approved_page_brief>");
    expect(result.artifact.modelExchanges[1]!.prompt).toContain("Selected Iconify set: `streamline-cyber`");
    expect(result.artifact.modelExchanges[1]!.response).toContain("<iconify-icon");
    expect(result.artifact.html).toContain("data-iconify-rendered");
    expect(result.artifact.html).toContain("<svg");
    expect(result.artifact.html).not.toContain("code.iconify.design");
    expect(result.artifact.payload).toMatchObject({ modelId: "mock-v1", siteIdentity: { classification: "original" } });
    expect(result.artifact.payload).toMatchObject({ pageDirection: { iconSet: "streamline-cyber" } });
    expect(result.artifact.payload).toMatchObject({ siteIdentity: { name: expect.stringMatching(/Exomonster/), purpose: expect.stringMatching(/deep-space/) } });
    expect(events.phases.at(-1)).toBe("committing");
  });

  it("selects dynamic regions for a live route but not for an ordinary article", async () => {
    const live = await runGenerationPipeline({
      request: generationCommand({ url: "https://example.com/chat" }),
      executor: new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "live-route" }),
      signal: new AbortController().signal,
      emit: emitter().value,
    });
    const article = await runGenerationPipeline({
      request: generationCommand({ url: "https://example.com/articles/quiet-gardens" }),
      executor: new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "static-route" }),
      signal: new AbortController().signal,
      emit: emitter().value,
    });

    expect(live.artifact.capabilityManifest.map((entry) => entry.id)).toContain("dynamic-regions");
    expect(live.artifact.dynamicManifest?.regions).toEqual([{ id: "live-thread", refreshSeconds: 60 }]);
    expect(article.artifact.capabilityManifest.map((entry) => entry.id)).not.toContain("dynamic-regions");
    expect(article.artifact.dynamicManifest).toBeUndefined();
  });

  it("never makes a semantic repair request after deterministic validation fails", async () => {
    const executor = new BrokenBuilderExecutor();
    const events = emitter();
    await expect(runGenerationPipeline({
      request: generationCommand(),
      executor,
      signal: new AbortController().signal,
      emit: events.value,
    })).rejects.toBeInstanceOf(UnsafeOutputError);
    expect(executor.calls).toEqual(["page-director", "page-builder"]);
    expect(events.validations).toContainEqual({ issueCount: expect.any(Number) });
  });

  it("uses the new SiteIdentity as canonical when duplicated direction fields diverge", async () => {
    const result = await runGenerationPipeline({
      request: generationCommand({ url: "https://new-world.example/" }),
      executor: new DivergentNewDirectorExecutor(),
      signal: new AbortController().signal,
      emit: emitter().value,
    });
    const identity = result.artifact.payload.siteIdentity as SiteIdentity;
    const direction = result.artifact.payload.pageDirection as DirectorResult["direction"];
    expect(direction.era).toBe(identity.era);
    expect(direction.palette).toEqual(identity.palette);
  });

  it("keeps the existing SiteIdentity canonical when the Director echoes different visual fields", async () => {
    const seedRequest = generationCommand({ url: "https://bububu.com/" });
    const seed = await runGenerationPipeline({
      request: seedRequest,
      executor: new DeterministicMockExecutor({ providerId: "mock", modelId: "mock-v1", seed: "existing-seed" }),
      signal: new AbortController().signal,
      emit: emitter().value,
    });
    const identity = seed.artifact.payload.siteIdentity as SiteIdentity;
    const request = generationCommand({
      url: "https://bububu.com/species",
      context: {
        ...seedRequest.context,
        identityStrategy: "reuse",
        siteWorld: {
          id: "site-bububu",
          profileId: "personal",
          origin: "https://bububu.com",
          state: "active",
          revision: 1,
          promptSnapshot: seedRequest.worldPromptSnapshot,
          identity,
          pageSummaries: [],
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:01.000Z",
        },
      },
    });
    const executor = new MutatingExistingDirectorExecutor();
    const result = await runGenerationPipeline({ request, executor, signal: new AbortController().signal, emit: emitter().value });
    const direction = result.artifact.payload.pageDirection as DirectorResult["direction"];
    expect(direction.palette).toEqual(identity.palette);
    expect(direction.favicon).toEqual(identity.favicon);
    expect(executor.calls).toEqual(["page-director", "page-builder"]);
  });
});

describe("compact local-model pipeline", () => {
  it("accepts Markdown-fenced HTML without any structured-output request", async () => {
    const executor = new CompactLocalExecutor();
    const previews: string[] = [];
    const events = emitter();
    events.value.preview = (html) => void previews.push(html);
    const result = await runGenerationPipeline({
      request: generationCommand({ url: "https://offline-pocket.example/dehydration" }),
      executor,
      signal: new AbortController().signal,
      emit: events.value,
    });

    expect(executor.calls).toEqual(["page-builder"]);
    expect(result.usage.requests).toBe(1);
    expect(result.artifact.title).toBe("Карманная энциклопедия воды");
    expect(result.artifact.modelExchanges).toHaveLength(1);
    expect(result.artifact.payload).toMatchObject({ pipeline: "compact" });
    expect(result.artifact.allowGeneratedScripts).toBe(false);
    expect(result.artifact.dynamicManifest).toBeUndefined();
    expect(result.artifact.capabilityManifest.map((entry) => entry.id).sort()).toEqual(["inline-page-css", "semantic-navigation"]);
    expect(result.artifact.html).toContain("Обезвоживание");
    expect(result.artifact.html).not.toContain("```html");
    expect(previews.at(-1)).toContain("Обезвоживание");
  });

  it("keeps Turbo static, bounded, and focused on the navigation context", async () => {
    const executor = new CompactLocalExecutor();
    const request = generationCommand({
      settings: {
        ...generationCommand().settings,
        tailwindEnabled: true,
        allowGeneratedScripts: true,
        motionEnabled: false,
      },
      context: {
        ...generationCommand().context,
        navigationIntent: {
          ...generationCommand().context.navigationIntent,
          kind: "link",
          anchorText: "Letter from grandma",
          linkContext: "Message 1023 from grandma, subject Hello",
        },
      },
    });
    await runGenerationPipeline({
      request,
      executor,
      signal: new AbortController().signal,
      emit: emitter().value,
    });

    const prompt = executor.textRequests[0]?.prompt;
    const textRequest = executor.textRequests[0];
    expect(prompt?.system).toContain("one inline <style> element");
    expect(prompt?.system).toContain("Do not use scripts");
    expect(prompt?.system).not.toContain("Tailwind");
    expect(prompt?.system.length).toBeLessThan(800);
    expect(prompt?.prompt.length).toBeLessThan(3_000);
    expect(prompt?.prompt).toContain("Message 1023 from grandma");
    expect(textRequest).toMatchObject({
      maxOutputTokens: 4_096,
      maxRetries: 0,
      stopSequences: ["</html>"],
    });
  });

  it("wraps a useful plain-text fragment instead of discarding it", () => {
    const html = normalizeGeneratedHtml("Короткая, но полезная памятка от локальной модели.");
    expect(html).toContain("<pre");
    expect(html).toContain("полезная памятка");
  });

  it("hard-bounds Turbo input even when profile and navigation context are large", async () => {
    const executor = new CompactLocalExecutor();
    const base = generationCommand();
    await runGenerationPipeline({
      request: generationCommand({
        worldPromptSnapshot: { revision: 9, vibe: "v".repeat(1_000), prompt: "world ".repeat(3_000) },
        context: {
          ...base.context,
          relevantHistory: [{
            artifactId: "prior",
            url: "https://example.com/previous?context=large",
            title: "Prior title ".repeat(20),
            purpose: "Prior purpose ".repeat(50),
            factsIntroduced: [],
            outboundRoutes: [],
          }],
          navigationIntent: {
            ...base.context.navigationIntent,
            kind: "form",
            anchorText: "anchor ".repeat(100),
            linkContext: "context ".repeat(300),
            surroundingText: "nearby ".repeat(300),
            formFields: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field-${index}`, "value ".repeat(200)])),
          },
        },
      }),
      executor,
      signal: new AbortController().signal,
      emit: emitter().value,
    });

    const bundle = executor.textRequests[0]!.prompt;
    expect(bundle.system.length + bundle.prompt.length).toBeLessThan(4_800);
  });
});
