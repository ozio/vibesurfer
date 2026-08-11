import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { useBrowserStore } from "../store/browser-store";
import type { GenerationJob, PageArtifact, SiteWorld } from "../types/browser";

const mocks = vi.hoisted(() => ({
  savePersistedSiteWorld: vi.fn(),
}));

vi.mock("./host-api", () => ({
  savePersistedSiteWorld: mocks.savePersistedSiteWorld,
}));

import { dispatchRuntimeEvent } from "./runtime";

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
const initialState = useBrowserStore.getInitialState();

describe("SiteWorld generation persistence", () => {
  beforeEach(() => {
    memoryStorage.clear();
    mocks.savePersistedSiteWorld.mockReset().mockResolvedValue(true);
    useBrowserStore.setState(initialState, true);
  });

  afterEach(() => {
    useBrowserStore.setState(initialState, true);
  });

  it("persists the world produced by a successfully committed artifact", () => {
    const job = generationJob();
    useBrowserStore.setState((state) => ({
      generationJobs: { [job.id]: job },
      tabs: state.tabs.map((tab) => tab.id === job.tabId
        ? { ...tab, generationJobId: job.id, loadState: "loading" }
        : tab),
    }));
    const artifact = pageArtifact();

    dispatchRuntimeEvent({ type: "generation.completed", jobId: job.id, artifact });

    const world = useBrowserStore.getState().siteWorlds[artifact.siteWorldId];
    expect(world).toMatchObject({
      id: artifact.siteWorldId,
      origin: "https://example.com",
      name: "Example Atlas",
      revision: 1,
      establishedFacts: ["The newsroom publishes hourly"],
    });
    expect(world.visitedPageSummaries).toContainEqual(expect.objectContaining({
      artifactId: artifact.id,
      url: artifact.url,
    }));
    expect(mocks.savePersistedSiteWorld).toHaveBeenCalledTimes(1);
    expect(mocks.savePersistedSiteWorld).toHaveBeenCalledWith("personal", world);

    dispatchRuntimeEvent({ type: "generation.completed", jobId: job.id, artifact });
    expect(mocks.savePersistedSiteWorld).toHaveBeenCalledTimes(1);
  });

  it("hydrates newer host worlds without regressing a newer local revision", () => {
    const local = siteWorld({ id: "site-local", revision: 4, updatedAt: "2026-08-12T00:00:04.000Z" });
    useBrowserStore.setState({ siteWorlds: { [local.id]: local } });

    useBrowserStore.getState().hydrateSiteWorlds([
      siteWorld({ id: "site-stale", revision: 3, updatedAt: "2026-08-12T00:00:05.000Z" }),
    ]);
    expect(useBrowserStore.getState().siteWorlds).toEqual({ [local.id]: local });

    const fresh = siteWorld({ id: "site-host", revision: 5, updatedAt: "2026-08-12T00:00:06.000Z" });
    useBrowserStore.getState().hydrateSiteWorlds([fresh]);
    expect(useBrowserStore.getState().siteWorlds).toEqual({ [fresh.id]: fresh });
  });
});

function generationJob(): GenerationJob {
  return {
    id: "job-world",
    profileId: "personal",
    tabId: "welcome",
    requestedUrl: "https://example.com/news",
    normalizedUrl: "https://example.com/news",
    siteWorldId: "site-example",
    modelId: "mock:preview",
    mode: "quick",
    status: "running",
    phase: "generating",
    navigationIntent: {
      trigger: "link",
      disposition: "current",
      requestedUrl: "/news",
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:01.000Z",
  };
}

function pageArtifact(): PageArtifact {
  return {
    id: "artifact-world",
    url: "https://example.com/news",
    title: "Example News",
    html: "<!doctype html><title>Example News</title>",
    summary: "The latest reports",
    siteWorldId: "site-example",
    generationJobId: "job-world",
    modelId: "mock:preview",
    mode: "quick",
    promptVersion: 1,
    settingsFingerprint: "test",
    createdAt: "2026-08-12T00:00:02.000Z",
    warnings: [],
    sitePatch: {
      name: "Example Atlas",
      purpose: "News and research",
      audience: "Readers",
      visualLanguage: {
        palette: ["#111111", "#ffffff"],
        typography: "sans",
        layout: "editorial grid",
        tone: "measured",
      },
      establishedFacts: ["The newsroom publishes hourly"],
      routeHints: [{ path: "/archive", label: "Archive" }],
    },
  };
}

function siteWorld(patch: Partial<SiteWorld>): SiteWorld {
  return {
    id: "site-example",
    origin: "https://example.com",
    name: "Example",
    purpose: "News",
    audience: "Readers",
    visualLanguage: { palette: [], typography: "", layout: "", tone: "" },
    informationArchitecture: [],
    establishedFacts: [],
    visitedPageSummaries: [],
    revision: 1,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:01.000Z",
    ...patch,
  };
}
