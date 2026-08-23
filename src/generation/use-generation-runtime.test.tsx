import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { useBrowserStore } from "../store/browser-store";
import type { PageArtifact, ProviderConnection, SiteWorld } from "../types/browser";

const mocks = vi.hoisted(() => ({
  getPersistedArtifact: vi.fn(),
  getPersistedArtifactsByIds: vi.fn(),
  listPersistedBrowsingHistory: vi.fn(),
  listPersistedSiteWorlds: vi.fn(),
  listProviderConnections: vi.fn(),
  savePersistedSiteWorld: vi.fn(),
  upsertPersistedBrowsingHistory: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("../lib/platform", () => ({ isTauri: mocks.isTauri }));
vi.mock("./host-api", () => ({
  getPersistedArtifact: mocks.getPersistedArtifact,
  getPersistedArtifactsByIds: mocks.getPersistedArtifactsByIds,
  listPersistedBrowsingHistory: mocks.listPersistedBrowsingHistory,
  listPersistedSiteWorlds: mocks.listPersistedSiteWorlds,
  listProviderConnections: mocks.listProviderConnections,
  savePersistedSiteWorld: mocks.savePersistedSiteWorld,
  upsertPersistedBrowsingHistory: mocks.upsertPersistedBrowsingHistory,
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
    mocks.getPersistedArtifactsByIds.mockReset().mockResolvedValue([]);
    mocks.listPersistedBrowsingHistory.mockReset().mockResolvedValue({ items: [] });
    mocks.listProviderConnections.mockReset().mockResolvedValue([]);
    mocks.listPersistedSiteWorlds.mockReset().mockResolvedValue([siteWorld()]);
    mocks.savePersistedSiteWorld.mockReset().mockResolvedValue(true);
    mocks.upsertPersistedBrowsingHistory.mockReset().mockResolvedValue(0);
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
    expect(mocks.getPersistedArtifactsByIds).toHaveBeenCalledWith("personal", []);
    expect(mocks.listPersistedSiteWorlds).toHaveBeenCalledWith("personal");
    expect(mocks.listProviderConnections).toHaveBeenCalledWith("personal");
  });

  it("loads only current and fallback artifacts needed by restored tabs", async () => {
    const recent = pageArtifact("artifact-recent");
    const fallback = pageArtifact("artifact-fallback");
    const historyOnly = pageArtifact("artifact-history");
    const baseTab = useBrowserStore.getState().tabs[0];
    const baseEntry = baseTab.history[0];
    useBrowserStore.setState({
      tabs: [{
        ...baseTab,
        artifactId: recent.id,
        fallbackArtifactId: fallback.id,
        opener: { tabId: "source-tab", artifactId: historyOnly.id },
        history: [
          { ...baseEntry, id: "history-recent", artifactId: recent.id },
          { ...baseEntry, id: "history-referenced-one", artifactId: historyOnly.id },
          { ...baseEntry, id: "history-referenced-two", artifactId: historyOnly.id },
        ],
        historyIndex: 2,
      }],
      activeTabId: baseTab.id,
    });
    mocks.getPersistedArtifactsByIds.mockResolvedValue([recent, fallback]);

    render(<RuntimeHarness />);

    await waitFor(() => {
      expect(useBrowserStore.getState().artifacts).toMatchObject({
        [recent.id]: recent,
        [fallback.id]: fallback,
      });
    });
    expect(useBrowserStore.getState().artifacts[historyOnly.id]).toBeUndefined();
    expect(mocks.getPersistedArtifactsByIds).toHaveBeenCalledWith("personal", [recent.id, fallback.id]);
    expect(mocks.getPersistedArtifact).not.toHaveBeenCalled();
  });

  it("keeps a custom model selected after its host connection hydrates", async () => {
    const connection = providerConnection("openai:evo-local");
    useBrowserStore.setState({ activeModelId: "openai:evo-local", providerConnections: [] });
    mocks.listProviderConnections.mockResolvedValue([connection]);

    render(<RuntimeHarness />);

    await waitFor(() => {
      expect(useBrowserStore.getState().providerConnections).toEqual([connection]);
    });
    expect(useBrowserStore.getState().activeModelId).toBe("openai:evo-local");
  });

  it("falls back only after host hydration confirms a custom model is unavailable", async () => {
    useBrowserStore.setState({ activeModelId: "openai:removed-model", providerConnections: [] });

    render(<RuntimeHarness />);

    await waitFor(() => {
      expect(mocks.listProviderConnections).toHaveBeenCalledWith("personal");
      expect(useBrowserStore.getState().activeModelId).toBe("mock:preview");
    });
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
    promptSnapshot: { revision: 1, vibe: "", prompt: "Hydrated world" },
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

function providerConnection(modelId: string): ProviderConnection {
  return {
    id: "evo",
    profileId: "personal",
    kind: "openai",
    displayName: "Evo",
    enabled: true,
    status: "valid",
    modelIds: [modelId],
  };
}
