import { beforeEach, describe, expect, it } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { DEFAULT_GENERATION_SETTINGS, useBrowserStore, type BrowserState } from "../store/browser-store";
import type { GenerationJob, SiteIdentity, SiteWorld } from "../types/browser";
import { buildGenerationRequest, normalizeRuntimeEvent } from "./runtime";

const initialState = useBrowserStore.getInitialState();
const memoryStorage = new Map<string, string>();
useBrowserStore.persist.setOptions({
  storage: createJSONStorage(() => ({
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => void memoryStorage.set(key, value),
    removeItem: (key) => void memoryStorage.delete(key),
  })),
});

beforeEach(() => {
  memoryStorage.clear();
  useBrowserStore.setState(initialState, true);
});

const job: GenerationJob = {
  id: "job-test",
  profileId: "personal",
  tabId: "welcome",
  requestedUrl: "example.com/news",
  normalizedUrl: "https://example.com/news",
  siteWorldId: "site-example",
  providerId: "openai-main",
  modelId: "openai:gpt-test",
  identityStrategy: "reuse",
  browserTheme: "native",
  motionEnabled: true,
  worldPromptSnapshot: { revision: 3, vibe: "", prompt: "A bounded profile world." },
  generationSettingsSnapshot: structuredClone(DEFAULT_GENERATION_SETTINGS),
  status: "running",
  phase: "generating",
  navigationIntent: { trigger: "link", disposition: "current", requestedUrl: "/news", sourceTabId: "welcome", linkText: "News", linkContext: "News desk, 12 August edition" },
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:01.000Z",
};

describe("generation runtime protocol", () => {
  it("builds a profile- and incarnation-bound request while keeping credentials out of the payload", () => {
    const current = useBrowserStore.getState();
    const world = testWorld();
    const state: BrowserState = {
      ...current,
      providerConnections: [{ id: "openai-main", profileId: "personal", kind: "openai", displayName: "OpenAI personal", secretRef: "personal:openai-main", enabled: true, status: "valid", modelIds: ["openai:gpt-test"] }],
      siteWorlds: { [world.id]: world },
    };
    const input = buildGenerationRequest(state, job);
    expect(input.credentialRef).toBe("personal:openai-main");
    expect(input.request).toMatchObject({
      url: "https://example.com/news",
      profileId: "personal",
      siteWorldId: "site-example",
      browserTheme: "native",
      worldPromptSnapshot: job.worldPromptSnapshot,
      provider: { connectionId: "openai-main", kind: "openai", modelId: "gpt-test" },
      settings: { motionEnabled: true, maxOutputTokens: 16_000 },
      context: { siteWorld: world, identityStrategy: "reuse", navigationIntent: { linkContext: "News desk, 12 August edition" } },
    });
    expect(JSON.stringify(input.request)).not.toContain("personal:openai-main");
  });

  it("honors same-site history and max-token snapshots independently of later settings", () => {
    const summary = { artifactId: "artifact-old", url: "https://example.com/old", title: "Old page", purpose: "Prior context", factsIntroduced: [], outboundRoutes: [] };
    const world = testWorld({ visitedPageSummaries: [summary], pageSummaries: [summary] });
    const state = useBrowserStore.getState();
    const configuredJob: GenerationJob = {
      ...job,
      generationSettingsSnapshot: {
        ...structuredClone(DEFAULT_GENERATION_SETTINGS),
        maxOutputTokens: 7_680,
        privacy: { ...DEFAULT_GENERATION_SETTINGS.privacy, includeNavigationHistory: true },
      },
    };
    const included = buildGenerationRequest({ ...state, siteWorlds: { [world.id]: world } }, configuredJob);
    expect(included.request).toMatchObject({
      settings: { maxOutputTokens: 7_680 },
      context: { relevantHistory: [summary] },
    });
    const excluded = buildGenerationRequest({ ...state, siteWorlds: { [world.id]: world } }, {
      ...configuredJob,
      generationSettingsSnapshot: {
        ...configuredJob.generationSettingsSnapshot,
        privacy: { ...configuredJob.generationSettingsSnapshot.privacy, includeNavigationHistory: false },
      },
    });
    expect((excluded.request.context as { relevantHistory: unknown[] }).relevantHistory).toEqual([]);
  });

  it("keeps job chrome and world snapshots stable when the active profile changes later", () => {
    const state = useBrowserStore.getState();
    const input = buildGenerationRequest({ ...state, preferences: { ...state.preferences, theme: "cyberpunk" } }, job);
    expect(input.request.browserTheme).toBe("native");
    expect(input.request.worldPromptSnapshot).toEqual(job.worldPromptSnapshot);
  });

  it("normalizes the new Director phase and rejects removed planning/repair phases", () => {
    expect(normalizeRuntimeEvent({ type: "generation.phase", phase: "directing" }, job))
      .toEqual({ type: "generation.phase", jobId: job.id, phase: "directing" });
    expect(normalizeRuntimeEvent({ type: "generation.phase", phase: "repairing" }, job)).toBeUndefined();
  });

  it("normalizes exactly the two new model exchanges", () => {
    const event = normalizeRuntimeEvent({
      type: "generation.completed",
      jobId: job.id,
      artifact: {
        id: "artifact-test",
        siteId: job.siteWorldId,
        generationId: job.id,
        url: job.normalizedUrl,
        title: "Example News",
        html: "<!doctype html><title>Example News</title>",
        summary: "News",
        modelId: job.modelId,
        promptVersion: 10,
        settingsFingerprint: "new-contract",
        createdAt: "2026-08-12T00:00:02.000Z",
        warnings: [],
        capabilityManifest: [
          { id: "data-chart", version: "vega-lite-6.4.3", execution: "compiler", instances: 2, noticeIds: ["npm:vega-lite@6.4.3"] },
          { id: "native-shell", version: "1", execution: "native", instances: 1, noticeIds: [] },
        ],
        modelExchanges: [exchange("page-director"), exchange("page-builder"), exchange("page-repair")],
      },
    }, job);
    expect(event).toMatchObject({
      type: "generation.completed",
      artifact: {
        siteWorldId: "site-example",
        capabilityManifest: [{ id: "data-chart", version: "vega-lite-6.4.3", execution: "compiler", instances: 2, noticeIds: ["npm:vega-lite@6.4.3"] }],
        modelExchanges: [{ purpose: "page-director" }, { purpose: "page-builder" }],
      },
    });
  });
});

function exchange(purpose: string) {
  return { id: `exchange-${purpose}`, purpose, providerId: "openai-main", modelId: "gpt-test", actualProviderKind: "openai", startedAt: "2026-08-12T00:00:00.000Z", completedAt: "2026-08-12T00:00:01.000Z", durationMs: 1_000, systemPrompt: "system", prompt: "prompt", response: "response", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, requests: 1 } };
}

export function testIdentity(): SiteIdentity {
  return {
    classification: "original",
    locale: "en-US",
    era: "contemporary",
    name: "Example Atlas",
    purpose: "A test world",
    audience: "Readers",
    visualLanguage: { palette: ["#111111", "#ffffff"], typography: "Arimo Variable", density: "comfortable", radius: "subtle", mood: "calm" },
    establishedFacts: ["The atlas is updated hourly."],
    routeHints: [{ path: "/", label: "Home" }, { path: "/news", label: "News" }, { path: "/map", label: "Map" }, { path: "/about", label: "About" }],
    palette: { background: "#ffffff", surface: "#ffffff", text: "#111111", mutedText: "#555555", accent: "#2255aa", accentText: "#ffffff", border: "#dddddd" },
    fonts: { body: "Arimo Variable", heading: "Source Sans 3 Variable" },
    layoutSystem: "Editorial grid",
    favicon: { kind: "glyph", glyph: "E", foreground: "#ffffff", background: "#2255aa", shape: "rounded-square" },
  };
}

export function testWorld(overrides: Partial<SiteWorld> = {}): SiteWorld {
  const identity = testIdentity();
  return {
    id: "site-example",
    profileId: "personal",
    origin: "https://example.com",
    state: "active",
    promptSnapshot: { revision: 1, vibe: "", prompt: "Original world prompt." },
    identity,
    pageSummaries: [],
    name: identity.name,
    purpose: identity.purpose,
    audience: identity.audience,
    visualLanguage: { palette: identity.visualLanguage.palette, typography: identity.visualLanguage.typography, layout: identity.layoutSystem, tone: identity.visualLanguage.mood ?? "" },
    informationArchitecture: identity.routeHints,
    establishedFacts: identity.establishedFacts,
    visitedPageSummaries: [],
    revision: 1,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:01.000Z",
    ...overrides,
  };
}
