import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { DEFAULT_GENERATION_SETTINGS, useBrowserStore } from "../store/browser-store";
import type { GenerationJob, PageArtifact, SiteIdentity, SiteWorld } from "../types/browser";

const mocks = vi.hoisted(() => ({ savePersistedSiteWorld: vi.fn() }));
vi.mock("./host-api", () => ({ savePersistedSiteWorld: mocks.savePersistedSiteWorld }));
import { dispatchRuntimeEvent } from "./runtime";

const memoryStorage = new Map<string, string>();
useBrowserStore.persist.setOptions({ storage: createJSONStorage(() => ({ getItem: (key) => memoryStorage.get(key) ?? null, setItem: (key, value) => void memoryStorage.set(key, value), removeItem: (key) => void memoryStorage.delete(key) })) });
const initialState = useBrowserStore.getInitialState();

describe("SiteWorld generation persistence", () => {
  beforeEach(() => {
    memoryStorage.clear();
    mocks.savePersistedSiteWorld.mockReset().mockResolvedValue(true);
    useBrowserStore.setState(initialState, true);
  });
  afterEach(() => useBrowserStore.setState(initialState, true));

  it("creates and persists an incarnation only after a successful Builder commit", () => {
    const job = generationJob();
    useBrowserStore.setState((state) => ({
      generationJobs: { [job.id]: job },
      tabs: state.tabs.map((tab) => tab.id === job.tabId ? { ...tab, generationJobId: job.id, siteWorldId: job.siteWorldId, loadState: "loading" } : tab),
    }));
    expect(useBrowserStore.getState().siteWorlds[job.siteWorldId!]).toBeUndefined();
    const artifact = pageArtifact();
    dispatchRuntimeEvent({ type: "generation.completed", jobId: job.id, artifact });
    const world = useBrowserStore.getState().siteWorlds[artifact.siteWorldId];
    expect(world).toMatchObject({ id: artifact.siteWorldId, profileId: "personal", state: "active", origin: "https://example.com", identity: { name: "Example Atlas" }, promptSnapshot: job.worldPromptSnapshot, revision: 1 });
    expect(world.pageSummaries).toContainEqual(expect.objectContaining({ artifactId: artifact.id }));
    expect(world.identity.establishedFacts).toContain("The eastern desk opened");
    expect(world.identity.routeHints).toContainEqual(expect.objectContaining({ path: "/east" }));
    expect(mocks.savePersistedSiteWorld).toHaveBeenCalledWith("personal", world);
  });

  it("does not mutate SiteWorld after a failed generation", () => {
    const old = siteWorld({ id: "site-old" });
    const job = generationJob({ id: "job-failed", siteWorldId: old.id, identityStrategy: "reuse" });
    useBrowserStore.setState({ siteWorlds: { [old.id]: old }, generationJobs: { [job.id]: job } });
    dispatchRuntimeEvent({ type: "generation.failed", jobId: job.id, error: { code: "unsafe-output", message: "bad HTML", retryable: true } });
    expect(useBrowserStore.getState().siteWorlds).toEqual({ [old.id]: old });
    expect(mocks.savePersistedSiteWorld).not.toHaveBeenCalled();
  });

  it("hydrates multiple incarnations of one origin without collapsing them", () => {
    const active = siteWorld({ id: "site-active", state: "active" });
    const archived = siteWorld({ id: "site-archived", state: "archived", archivedAt: "2026-08-12T00:00:05.000Z" });
    useBrowserStore.getState().hydrateSiteWorlds([active, archived]);
    expect(Object.keys(useBrowserStore.getState().siteWorlds).sort()).toEqual(["site-active", "site-archived"]);
  });
});

function generationJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-world",
    profileId: "personal",
    tabId: "welcome",
    requestedUrl: "https://example.com/news",
    normalizedUrl: "https://example.com/news",
    siteWorldId: "site-example",
    modelId: "mock:preview",
    identityStrategy: "create",
    browserTheme: "native",
    worldPromptSnapshot: { revision: 4, vibe: "", prompt: "A profile universe." },
    generationSettingsSnapshot: structuredClone(DEFAULT_GENERATION_SETTINGS),
    status: "running",
    phase: "generating",
    navigationIntent: { trigger: "link", disposition: "current", requestedUrl: "/news" },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:01.000Z",
    ...overrides,
    motionEnabled: overrides.motionEnabled ?? true,
  };
}

function identity(): SiteIdentity {
  return {
    classification: "original", locale: "en-US", era: "contemporary", name: "Example Atlas", purpose: "News and research", audience: "Readers",
    visualLanguage: { palette: ["#111111", "#ffffff"], typography: "Arimo Variable", density: "comfortable", radius: "subtle", mood: "measured" },
    establishedFacts: ["The newsroom publishes hourly"], routeHints: [{ path: "/archive", label: "Archive" }],
    palette: { background: "#ffffff", surface: "#ffffff", text: "#111111", mutedText: "#555555", accent: "#2255aa", accentText: "#ffffff", border: "#dddddd" },
    fonts: { body: "Arimo Variable", heading: "Source Sans 3 Variable" }, layoutSystem: "editorial grid",
    favicon: { kind: "glyph", glyph: "E", foreground: "#ffffff", background: "#2255aa", shape: "rounded-square" },
  };
}

function pageArtifact(): PageArtifact {
  const siteIdentity = identity();
  const additions = { facts: ["The eastern desk opened"], routes: [{ path: "/east", label: "Eastern desk" }] };
  return {
    id: "artifact-world", profileId: "personal", url: "https://example.com/news", title: "Example News", html: "<!doctype html><title>Example News</title>", summary: "The latest reports", siteWorldId: "site-example", generationJobId: "job-world", modelId: "mock:preview", promptVersion: 10, settingsFingerprint: "test", createdAt: "2026-08-12T00:00:02.000Z", warnings: [], siteIdentity, siteAdditions: additions, worldPromptSnapshot: { revision: 4, vibe: "", prompt: "A profile universe." }, sitePatch: { ...siteIdentity, establishedFacts: [...siteIdentity.establishedFacts, ...additions.facts], routeHints: [...siteIdentity.routeHints, ...additions.routes] },
  };
}

function siteWorld(overrides: Partial<SiteWorld> = {}): SiteWorld {
  const siteIdentity = identity();
  return { id: "site-example", profileId: "personal", origin: "https://example.com", state: "active", promptSnapshot: { revision: 1, vibe: "", prompt: "Old snapshot" }, identity: siteIdentity, pageSummaries: [], name: siteIdentity.name, purpose: siteIdentity.purpose, audience: siteIdentity.audience, visualLanguage: { palette: siteIdentity.visualLanguage.palette, typography: siteIdentity.visualLanguage.typography, layout: siteIdentity.layoutSystem, tone: siteIdentity.visualLanguage.mood ?? "" }, informationArchitecture: siteIdentity.routeHints, establishedFacts: siteIdentity.establishedFacts, visitedPageSummaries: [], revision: 1, createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:01.000Z", ...overrides };
}
