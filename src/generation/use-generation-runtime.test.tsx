import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { useBrowserStore } from "../store/browser-store";
import type { PageArtifact, SiteWorld } from "../types/browser";

const mocks = vi.hoisted(() => ({
  getPersistedArtifact: vi.fn(),
  listPersistedArtifacts: vi.fn(),
  listPersistedSiteWorlds: vi.fn(),
  listProviderConnections: vi.fn(),
  savePersistedSiteWorld: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("../lib/platform", () => ({ isTauri: mocks.isTauri }));
vi.mock("./host-api", () => ({
  getPersistedArtifact: mocks.getPersistedArtifact,
  listPersistedArtifacts: mocks.listPersistedArtifacts,
  listPersistedSiteWorlds: mocks.listPersistedSiteWorlds,
  listProviderConnections: mocks.listProviderConnections,
  savePersistedSiteWorld: mocks.savePersistedSiteWorld,
}));

import { useGenerationRuntime } from "./use-generation-runtime";

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

describe("generation runtime hydration", () => {
  beforeEach(() => {
    memoryStorage.clear();
    useBrowserStore.setState(initialState, true);
    mocks.isTauri.mockReturnValue(true);
    mocks.getPersistedArtifact.mockReset().mockResolvedValue(undefined);
    mocks.listPersistedArtifacts.mockReset().mockResolvedValue([]);
    mocks.listProviderConnections.mockReset().mockResolvedValue([]);
    mocks.listPersistedSiteWorlds.mockReset().mockResolvedValue([siteWorld()]);
    mocks.savePersistedSiteWorld.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    useBrowserStore.setState(initialState, true);
  });

  it("hydrates the active Personal profile from host storage at startup", async () => {
    render(<RuntimeHarness />);

    await waitFor(() => {
      expect(useBrowserStore.getState().siteWorlds["site-hydrated"]).toEqual(siteWorld());
    });
    expect(mocks.listPersistedArtifacts).toHaveBeenCalledWith("personal", 32);
    expect(mocks.listPersistedSiteWorlds).toHaveBeenCalledWith("personal");
    expect(mocks.listProviderConnections).toHaveBeenCalledWith("personal");
  });

  it("loads a small recent window plus deduplicated artifacts referenced by restored tabs", async () => {
    const recent = pageArtifact("artifact-recent");
    const referenced = pageArtifact("artifact-history");
    const baseTab = useBrowserStore.getState().tabs[0];
    const baseEntry = baseTab.history[0];
    useBrowserStore.setState({
      tabs: [{
        ...baseTab,
        artifactId: recent.id,
        opener: { tabId: "source-tab", artifactId: referenced.id },
        history: [
          { ...baseEntry, id: "history-recent", artifactId: recent.id },
          { ...baseEntry, id: "history-referenced-one", artifactId: referenced.id },
          { ...baseEntry, id: "history-referenced-two", artifactId: referenced.id },
        ],
        historyIndex: 2,
      }],
      activeTabId: baseTab.id,
    });
    mocks.listPersistedArtifacts.mockResolvedValue([recent]);
    mocks.getPersistedArtifact.mockImplementation(async (_profileId: string, id: string) =>
      id === referenced.id ? referenced : undefined);

    render(<RuntimeHarness />);

    await waitFor(() => {
      expect(useBrowserStore.getState().artifacts).toMatchObject({
        [recent.id]: recent,
        [referenced.id]: referenced,
      });
    });
    expect(mocks.listPersistedArtifacts).toHaveBeenCalledWith("personal", 32);
    expect(mocks.getPersistedArtifact).toHaveBeenCalledTimes(1);
    expect(mocks.getPersistedArtifact).toHaveBeenCalledWith("personal", referenced.id);
  });
});

function RuntimeHarness() {
  useGenerationRuntime();
  return null;
}

function siteWorld(): SiteWorld {
  const identity: SiteWorld["identity"] = {
    classification: "original", locale: "en-US", era: "contemporary", name: "Hydrated", purpose: "Persisted world", audience: "Readers",
    visualLanguage: { palette: ["#111111", "#ffffff"], typography: "Arimo Variable", density: "comfortable", radius: "subtle", mood: "calm" },
    establishedFacts: ["Stored in SQLite"], routeHints: [],
    palette: { background: "#ffffff", surface: "#ffffff", text: "#111111", mutedText: "#555555", accent: "#2255aa", accentText: "#ffffff", border: "#dddddd" },
    fonts: { body: "Arimo Variable", heading: "Source Sans 3 Variable" }, layoutSystem: "grid",
    favicon: { kind: "glyph", glyph: "H", foreground: "#ffffff", background: "#2255aa", shape: "rounded-square" },
  };
  return {
    id: "site-hydrated",
    profileId: "personal",
    origin: "https://hydrated.example",
    state: "active",
    promptSnapshot: { revision: 1, prompt: "Hydrated world" },
    identity,
    pageSummaries: [],
    name: "Hydrated",
    purpose: "Persisted world",
    audience: "Readers",
    visualLanguage: { palette: [], typography: "sans", layout: "grid", tone: "calm" },
    informationArchitecture: [],
    establishedFacts: ["Stored in SQLite"],
    visitedPageSummaries: [],
    revision: 7,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:07.000Z",
  };
}

function pageArtifact(id: string): PageArtifact {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    html: `<!doctype html><title>${id}</title>`,
    summary: "Persisted artifact",
    siteWorldId: "site-hydrated",
    generationJobId: `job-${id}`,
    modelId: "openai:gpt-5",
    promptVersion: 1,
    settingsFingerprint: "test",
    createdAt: "2026-08-12T00:00:00.000Z",
    warnings: [],
  };
}
