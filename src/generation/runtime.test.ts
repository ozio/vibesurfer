import { beforeEach, describe, expect, it } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { useBrowserStore, type BrowserState } from "../store/browser-store";
import type { GenerationJob, PageArtifact, PageSummary, SiteWorld } from "../types/browser";
import { buildGenerationRequest, normalizeRuntimeEvent } from "./runtime";

const initialState = useBrowserStore.getInitialState();
const memoryStorage = new Map<string, string>();
useBrowserStore.persist.setOptions({
  storage: createJSONStorage(() => ({
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key) => {
      memoryStorage.delete(key);
    },
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
  mode: "quick",
  status: "running",
  phase: "generating",
  navigationIntent: {
    trigger: "link",
    disposition: "current",
    requestedUrl: "/news",
    sourceTabId: "welcome",
    linkText: "News",
  },
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:01.000Z",
};

describe("generation runtime protocol", () => {
  it("builds a bounded request while keeping the credential outside provider payload", () => {
    const current = useBrowserStore.getState();
    const state: BrowserState = {
      ...current,
      activeProfileId: "personal",
      providerConnections: [
        {
          id: "openai-main",
          profileId: "personal",
          kind: "openai",
          displayName: "OpenAI personal",
          secretRef: "personal:openai-main",
          enabled: true,
          status: "valid",
          modelIds: ["openai:gpt-test"],
        },
      ],
      siteWorlds: {
        "site-example": {
          id: "site-example",
          origin: "https://example.com",
          name: "Example",
          purpose: "A test world",
          audience: "Readers",
          visualLanguage: { palette: ["#000000", "#ffffff"], typography: "sans", layout: "grid", tone: "calm" },
          informationArchitecture: [],
          establishedFacts: [],
          visitedPageSummaries: [],
          revision: 1,
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
      },
    };

    const input = buildGenerationRequest(state, job);
    expect(input.credentialRef).toBe("personal:openai-main");
    expect(input.request).toMatchObject({
      url: "https://example.com/news",
      mode: "quick",
      provider: { connectionId: "openai-main", kind: "openai", modelId: "gpt-test" },
    });
    expect(JSON.stringify(input.request)).not.toContain("personal:openai-main");
  });

  it("normalizes legacy nested worker phases", () => {
    expect(
      normalizeRuntimeEvent(
        {
          type: "event",
          jobId: job.id,
          sequence: 4,
          event: { type: "phase.changed", phase: "planning-page", progress: 0.3 },
        },
        job,
      ),
    ).toEqual({ type: "generation.phase", jobId: job.id, phase: "planning" });
  });

  it("maps free-form prompts onto a synthetic HTTP world without losing the concept", () => {
    const state = useBrowserStore.getState();
    const promptJob = {
      ...job,
      requestedUrl: "A calm research space for a new idea",
      normalizedUrl: undefined,
      providerId: "mock",
      modelId: "mock:preview",
    };
    const input = buildGenerationRequest(state, promptJob);
    expect(input.request.url).toMatch(/^https:\/\/generated\.vibe\.local\//);
    expect(input.request.conceptPrompt).toBe(promptJob.requestedUrl);
  });

  it("regenerates a free-form prompt with its full SiteWorld and bounded source history", () => {
    const prompt = "A calm research space for a new idea";
    const firstJobId = useBrowserStore.getState().navigate("welcome", prompt);
    expect(firstJobId).toBeTruthy();
    const firstJob = useBrowserStore.getState().generationJobs[firstJobId!];
    expect(firstJob.siteWorldId).toBeTruthy();
    const initialWorld = useBrowserStore.getState().siteWorlds[firstJob.siteWorldId!];
    const priorHistory: PageSummary[] = Array.from({ length: 9 }, (_, index) => ({
      artifactId: `artifact-prior-${index}`,
      url: `${initialWorld.origin}/history/${index}`,
      title: `Prior ${index}`,
      purpose: `Earlier page ${index}`,
      factsIntroduced: [`Fact ${index}`],
      outboundRoutes: [`/history/${index + 1}`],
    }));
    useBrowserStore.getState().upsertSiteWorld({
      ...initialWorld,
      purpose: "A coherent research workspace",
      audience: "Curious researchers",
      visualLanguage: {
        palette: ["#102030", "#f5f7fa"],
        typography: "Editorial sans",
        layout: "modular grid",
        tone: "calm",
      },
      informationArchitecture: [{ path: "/library", label: "Library", purpose: "Saved research" }],
      establishedFacts: ["The workspace organizes research into collections."],
      visitedPageSummaries: priorHistory,
      revision: 9,
    });
    const firstRequest = buildGenerationRequest(useBrowserStore.getState(), firstJob);
    const firstUrl = firstRequest.request.url;
    expect(firstUrl).toEqual(expect.stringMatching(new RegExp(`^${initialWorld.origin}/`)));
    if (typeof firstUrl !== "string") throw new TypeError("Prompt request did not receive a URL");

    const artifact: PageArtifact = {
      id: "artifact-prompt-regression",
      url: firstUrl,
      title: "Calm Research",
      html: "<!doctype html><html><title>Calm Research</title></html>",
      summary: "A focused research home.",
      siteWorldId: initialWorld.id,
      generationJobId: firstJobId!,
      modelId: firstJob.modelId,
      mode: firstJob.mode,
      promptVersion: 1,
      settingsFingerprint: "prompt-regression",
      createdAt: "2026-08-12T00:00:10.000Z",
      warnings: [],
    };
    expect(useBrowserStore.getState().commitArtifact(firstJobId!, artifact)).toBe(true);
    const committedWorld = useBrowserStore.getState().siteWorlds[initialWorld.id];
    expect(committedWorld.visitedPageSummaries).toHaveLength(10);

    const regeneratedJobId = useBrowserStore.getState().regenerate("welcome");
    expect(regeneratedJobId).toBeTruthy();
    const regeneratedJob = useBrowserStore.getState().generationJobs[regeneratedJobId!];
    expect(regeneratedJob.siteWorldId).toBe(initialWorld.id);
    expect(regeneratedJob.sourceArtifactId).toBe(artifact.id);

    const input = buildGenerationRequest(useBrowserStore.getState(), regeneratedJob);
    const context = input.request.context as {
      siteWorld?: SiteWorld;
      sourcePage?: PageSummary;
      relevantHistory: PageSummary[];
      parentArtifactId?: string;
      navigationIntent: GenerationJob["navigationIntent"];
    };
    expect(context.siteWorld).toEqual(committedWorld);
    expect(context.siteWorld?.visitedPageSummaries).toHaveLength(10);
    expect(context.relevantHistory).toEqual(committedWorld.visitedPageSummaries.slice(-8));
    expect(context.relevantHistory).toHaveLength(8);
    expect(context.sourcePage).toMatchObject({
      artifactId: artifact.id,
      url: artifact.url,
      title: artifact.title,
      purpose: artifact.summary,
    });
    expect(context.parentArtifactId).toBe(artifact.id);
    expect(context.navigationIntent).toMatchObject({
      trigger: "regenerate",
      sourceArtifactId: artifact.id,
    });
  });

  it("normalizes worker artifacts to the browser contract", () => {
    const event = normalizeRuntimeEvent(
      {
        type: "generation.completed",
        jobId: job.id,
        artifact: {
          id: "artifact-test",
          siteId: "site-example",
          generationId: job.id,
          url: job.normalizedUrl,
          title: "Example News",
          html: "<!doctype html><title>Example News</title>",
          description: "The news page",
          modelId: "gpt-test",
          mode: "quick",
          promptVersion: 1,
          settingsFingerprint: "abc",
          createdAt: "2026-08-12T00:00:02.000Z",
          favicon: {
            kind: "glyph",
            glyph: "E",
            foreground: "#ffffff",
            background: "#000000",
            shape: "circle",
          },
          warnings: [],
        },
      },
      job,
    );

    expect(event).toMatchObject({
      type: "generation.completed",
      artifact: {
        id: "artifact-test",
        siteWorldId: "site-example",
        generationJobId: job.id,
        summary: "The news page",
      },
    });
  });
});
