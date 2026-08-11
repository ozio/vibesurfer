import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_BROWSER_PREFERENCES,
  migrateBrowserState,
  useBrowserStore,
} from "../src/store/browser-store";
import type { PageArtifact } from "../src/types/browser";

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

beforeEach(() => {
  memoryStorage.clear();
  useBrowserStore.setState(initialState, true);
});

test("navigate creates a queued virtual job and history references it", () => {
  const jobId = useBrowserStore.getState().navigate("welcome", "yandex.ru");
  assert.ok(jobId);
  const state = useBrowserStore.getState();
  const tab = state.tabs.find((item) => item.id === "welcome");
  assert.equal(tab?.kind, "generated");
  assert.equal(tab?.location, "https://yandex.ru/");
  assert.equal(tab?.generationJobId, jobId);
  assert.equal(tab?.history.at(-1)?.generationJobId, jobId);
  assert.equal(state.generationJobs[jobId].status, "queued");
  assert.equal(state.generationJobs[jobId].normalizedUrl, "https://yandex.ru/");
  assert.ok(state.generationJobs[jobId].siteWorldId);
});

test("URL navigation clears a prompt left by a generated prompt tab", () => {
  const jobId = useBrowserStore.getState().navigate("quiet-interface", "example.com");
  assert.ok(jobId);
  const tab = useBrowserStore.getState().tabs.find((item) => item.id === "quiet-interface");
  assert.equal(tab?.prompt, undefined);
  assert.equal(tab?.location, "https://example.com/");
});

test("free-form prompt regeneration keeps its SiteWorld without sharing unrelated prompt worlds", () => {
  const prompt = "A calm research space for a new idea";
  const firstJobId = useBrowserStore.getState().navigate("welcome", prompt);
  assert.ok(firstJobId);
  const firstJob = useBrowserStore.getState().generationJobs[firstJobId];
  assert.ok(firstJob.siteWorldId);
  const firstWorld = useBrowserStore.getState().siteWorlds[firstJob.siteWorldId];
  assert.ok(firstWorld);
  assert.match(firstWorld.origin, /^https:\/\/prompt-[a-z0-9]+\.generated\.vibe\.local$/);

  const artifact = artifactFor(firstJobId, "artifact-prompt", `${firstWorld.origin}/concept`);
  assert.equal(useBrowserStore.getState().commitArtifact(firstJobId, artifact), true);
  const nextJobId = useBrowserStore.getState().regenerate("welcome");
  assert.ok(nextJobId);
  const nextJob = useBrowserStore.getState().generationJobs[nextJobId];
  assert.equal(nextJob.siteWorldId, firstWorld.id);
  assert.equal(nextJob.sourceArtifactId, artifact.id);

  const unrelatedTabId = useBrowserStore.getState().addTab("A playful kitchen inventory");
  const unrelatedTab = useBrowserStore.getState().tabs.find((tab) => tab.id === unrelatedTabId);
  assert.ok(unrelatedTab?.generationJobId);
  const unrelatedJob = useBrowserStore.getState().generationJobs[unrelatedTab.generationJobId];
  assert.ok(unrelatedJob.siteWorldId);
  assert.notEqual(unrelatedJob.siteWorldId, firstWorld.id);
  assert.notEqual(
    useBrowserStore.getState().siteWorlds[unrelatedJob.siteWorldId].origin,
    firstWorld.origin,
  );
});

test("background tabs preserve the active tab and opener context", () => {
  const tabId = useBrowserStore.getState().addTab("/news", {
    disposition: "background-tab",
    opener: { tabId: "welcome", artifactId: "artifact-parent" },
    baseUrl: "https://example.com/home",
    intent: { trigger: "link", linkText: "News" },
  });
  const state = useBrowserStore.getState();
  const tab = state.tabs.find((item) => item.id === tabId);
  assert.equal(state.activeTabId, "welcome");
  assert.deepEqual(tab?.opener, { tabId: "welcome", artifactId: "artifact-parent" });
  assert.equal(tab?.location, "https://example.com/news");
  assert.equal(state.generationJobs[tab!.generationJobId!].navigationIntent.disposition, "background-tab");
  assert.equal(state.generationJobs[tab!.generationJobId!].navigationIntent.sourceArtifactId, "artifact-parent");
});

test("a committed artifact is reused for hash navigation", () => {
  const jobId = useBrowserStore.getState().navigate("welcome", "https://example.com/product");
  assert.ok(jobId);
  const artifact = artifactFor(jobId, "artifact-one", "https://example.com/product");
  assert.equal(useBrowserStore.getState().commitArtifact(jobId, artifact), true);

  const hashJobId = useBrowserStore.getState().navigate("welcome", "#details", {
    baseUrl: artifact.url,
    intent: { trigger: "link" },
  });
  const tab = useBrowserStore.getState().tabs.find((item) => item.id === "welcome");
  assert.equal(hashJobId, undefined);
  assert.equal(tab?.location, "https://example.com/product#details");
  assert.equal(tab?.artifactId, artifact.id);
  assert.equal(tab?.history.at(-1)?.artifactId, artifact.id);
  assert.equal(tab?.reloadKey, 0);
});

test("same-document hash tabs reuse artifact metadata and honor disposition", () => {
  const jobId = useBrowserStore.getState().navigate("welcome", "https://example.com/product");
  assert.ok(jobId);
  const artifact = {
    ...artifactFor(jobId, "artifact-hash-tab", "https://example.com/product"),
    title: "Product details",
    favicon: {
      kind: "glyph" as const,
      glyph: "🧭",
      foreground: "#ffffff",
      background: "#112233",
      shape: "circle" as const,
    },
  };
  assert.equal(useBrowserStore.getState().commitArtifact(jobId, artifact), true);
  const jobCount = Object.keys(useBrowserStore.getState().generationJobs).length;

  const backgroundId = useBrowserStore.getState().addTab("#details", {
    disposition: "background-tab",
    opener: { tabId: "welcome", artifactId: artifact.id },
    baseUrl: artifact.url,
    intent: { trigger: "link" },
  });
  let state = useBrowserStore.getState();
  const background = state.tabs.find((tab) => tab.id === backgroundId);
  assert.equal(state.activeTabId, "welcome");
  assert.equal(background?.location, "https://example.com/product#details");
  assert.equal(background?.artifactId, artifact.id);
  assert.equal(background?.title, artifact.title);
  assert.equal(background?.favicon, "🧭");
  assert.equal(Object.keys(state.generationJobs).length, jobCount);

  const foregroundId = state.addTab("#specifications", {
    disposition: "foreground-tab",
    opener: { tabId: "welcome", artifactId: artifact.id },
    baseUrl: artifact.url,
    intent: { trigger: "link" },
  });
  state = useBrowserStore.getState();
  assert.equal(state.activeTabId, foregroundId);
  assert.equal(state.tabs.find((tab) => tab.id === foregroundId)?.artifactId, artifact.id);
  assert.equal(Object.keys(state.generationJobs).length, jobCount);
});

test("committing an artifact carries its site world into the next navigation", () => {
  const jobId = useBrowserStore.getState().navigate("welcome", "https://example.com/");
  assert.ok(jobId);
  const artifact = {
    ...artifactFor(jobId, "artifact-world", "https://example.com/"),
    sitePatch: {
      name: "Example Journal",
      purpose: "A fictional journal",
      audience: "Curious readers",
      visualLanguage: {
        palette: ["#111111", "#eeeeee"],
        typography: "Editorial sans",
        density: "comfortable" as const,
        radius: "subtle" as const,
        mood: "measured",
      },
      establishedFacts: ["The journal publishes daily."],
      routeHints: [
        { path: "/latest", label: "Latest", purpose: "Recent stories" },
        { path: "/topics", label: "Topics", purpose: "Browse subjects" },
        { path: "/about", label: "About", purpose: "About the journal" },
        { path: "/archive", label: "Archive", purpose: "Older stories" },
      ],
    },
  };
  assert.equal(useBrowserStore.getState().commitArtifact(jobId, artifact), true);
  const world = useBrowserStore.getState().siteWorlds[artifact.siteWorldId];
  assert.equal(world.name, "Example Journal");
  assert.equal(world.revision, 1);
  assert.equal(world.visitedPageSummaries[0]?.artifactId, artifact.id);
  assert.deepEqual(world.informationArchitecture.map((route) => route.path), ["/latest", "/topics", "/about", "/archive"]);

  const nextJobId = useBrowserStore.getState().navigate("welcome", "/latest", { baseUrl: artifact.url });
  assert.ok(nextJobId);
  assert.equal(useBrowserStore.getState().generationJobs[nextJobId].siteWorldId, world.id);
});

test("reload reuses the artifact while regenerate creates a version job", () => {
  const firstJobId = useBrowserStore.getState().navigate("welcome", "https://example.com/");
  assert.ok(firstJobId);
  const artifact = artifactFor(firstJobId, "artifact-first", "https://example.com/");
  useBrowserStore.getState().commitArtifact(firstJobId, artifact);
  const before = useBrowserStore.getState();
  const beforeTab = before.tabs.find((item) => item.id === "welcome")!;
  const jobCount = Object.keys(before.generationJobs).length;

  useBrowserStore.getState().reload("welcome");
  const reloaded = useBrowserStore.getState().tabs.find((item) => item.id === "welcome")!;
  assert.equal(reloaded.artifactId, artifact.id);
  assert.equal(reloaded.reloadKey, beforeTab.reloadKey + 1);
  assert.equal(Object.keys(useBrowserStore.getState().generationJobs).length, jobCount);

  const nextJobId = useBrowserStore.getState().regenerate("welcome");
  assert.ok(nextJobId);
  assert.notEqual(nextJobId, firstJobId);
  const regenerated = useBrowserStore.getState().tabs.find((item) => item.id === "welcome")!;
  assert.equal(regenerated.artifactId, artifact.id);
  assert.equal(regenerated.generationJobId, nextJobId);
  assert.equal(regenerated.history.length, beforeTab.history.length);
  assert.equal(useBrowserStore.getState().generationJobs[nextJobId].sourceArtifactId, artifact.id);
});

test("stale generation events cannot replace the current tab", () => {
  const staleJobId = useBrowserStore.getState().navigate("welcome", "https://example.com/one");
  const currentJobId = useBrowserStore.getState().navigate("welcome", "https://example.com/two");
  assert.ok(staleJobId && currentJobId);
  const state = useBrowserStore.getState();
  assert.equal(state.generationJobs[staleJobId].status, "cancelled");
  assert.equal(state.setGenerationPhase(staleJobId, "generating"), false);
  assert.equal(
    state.commitArtifact(staleJobId, artifactFor(staleJobId, "artifact-stale", "https://example.com/one")),
    false,
  );
  assert.equal(useBrowserStore.getState().tabs.find((item) => item.id === "welcome")?.generationJobId, currentJobId);
  assert.equal(useBrowserStore.getState().artifacts["artifact-stale"], undefined);
});

test("back restores optional history fields without replacing the tab id", () => {
  const firstJobId = useBrowserStore.getState().navigate("quiet-interface", "https://example.com/one");
  assert.ok(firstJobId);
  const firstArtifact = artifactFor(firstJobId, "artifact-history", "https://example.com/one");
  useBrowserStore.getState().commitArtifact(firstJobId, firstArtifact);
  const secondJobId = useBrowserStore.getState().navigate("quiet-interface", "https://example.com/two");
  assert.ok(secondJobId);

  useBrowserStore.getState().go("quiet-interface", -1);
  const tab = useBrowserStore.getState().tabs.find((item) => item.id === "quiet-interface");
  assert.equal(tab?.id, "quiet-interface");
  assert.equal(tab?.location, firstArtifact.url);
  assert.equal(tab?.artifactId, firstArtifact.id);
  assert.equal(tab?.generationJobId, firstJobId);
  assert.equal(tab?.prompt, undefined);
  assert.equal(tab?.virtualLocation?.url, firstArtifact.url);
  assert.equal(useBrowserStore.getState().activeTabId, "welcome");
});

test("stream actions update only the expected live job", () => {
  const jobId = useBrowserStore.getState().navigate("welcome", "example.com");
  assert.ok(jobId);
  assert.equal(useBrowserStore.getState().beginGeneration(jobId), true);
  assert.equal(useBrowserStore.getState().setGenerationPhase(jobId, "generating"), true);
  assert.equal(
    useBrowserStore.getState().setGenerationMetadata(jobId, { provisionalTitle: "Example home" }),
    true,
  );
  assert.equal(useBrowserStore.getState().setGenerationPreview(jobId, "<main>Preview</main>"), true);
  const state = useBrowserStore.getState();
  assert.equal(state.generationJobs[jobId].status, "running");
  assert.equal(state.generationJobs[jobId].phase, "generating");
  assert.equal(state.generationJobs[jobId].previewRevision, 1);
  assert.equal(state.tabs.find((item) => item.id === "welcome")?.title, "Example home");
  assert.equal(state.cancelGeneration(jobId), true);
  assert.equal(useBrowserStore.getState().setGenerationPreview(jobId, "stale"), false);
});

test("version-one persisted tabs migrate without changing explicit remote surfaces", () => {
  const migrated = migrateBrowserState({
    tabs: [
      {
        id: "legacy",
        title: "example.com",
        location: "https://example.com/",
        kind: "remote",
        loadState: "idle",
        reloadKey: 2,
        history: [{ location: "https://example.com/", title: "example.com", kind: "remote" }],
        historyIndex: 0,
      },
    ],
    activeTabId: "missing",
    preferences: { theme: "cyberpunk" },
  }, 1);
  assert.equal(migrated.tabs?.[0].kind, "remote");
  assert.equal(migrated.tabs?.[0].history[0].id, "legacy:history:0");
  assert.equal(migrated.activeTabId, "legacy");
  assert.equal(migrated.preferences?.theme, "cyberpunk");
  assert.equal(migrated.preferences?.reopenSession, DEFAULT_BROWSER_PREFERENCES.reopenSession);
  assert.deepEqual(migrated.artifacts, {});
  assert.equal(migrated.generationSettings?.style.tailwindEnabled, true);
});

test("migration repairs a tab id overwritten by a history entry", () => {
  const migrated = migrateBrowserState({
    tabs: [{
      id: "history-corrupted",
      title: "Example",
      location: "https://example.com/",
      kind: "generated",
      generationJobId: "job-restored",
      history: [{
        id: "history-corrupted",
        location: "https://example.com/",
        title: "Example",
        kind: "generated",
        generationJobId: "job-restored",
      }],
      historyIndex: 0,
    }],
    activeTabId: "history-corrupted",
    generationJobs: {
      "job-restored": { id: "job-restored", tabId: "original-tab" },
    },
  }, 2);
  assert.equal(migrated.tabs?.[0].id, "original-tab");
  assert.equal(migrated.activeTabId, "original-tab");
  assert.equal(migrated.generationJobs?.["job-restored"].tabId, "original-tab");
});

test("migration replaces an unavailable model but preserves a configured BYOK model", () => {
  const unavailable = migrateBrowserState({ activeModelId: "codex:auto" }, 3);
  assert.equal(unavailable.activeModelId, "mock:preview");

  const configured = migrateBrowserState({
    activeModelId: "openai:gpt-test",
    activeProfileId: "personal",
    providerConnections: [{
      id: "openai-main",
      profileId: "personal",
      kind: "openai",
      displayName: "OpenAI",
      enabled: true,
      status: "valid",
      modelIds: ["openai:gpt-test"],
    }],
  }, 3);
  assert.equal(configured.activeModelId, "openai:gpt-test");
});

test("removing a provider resets its selected and mode-specific models", () => {
  useBrowserStore.setState((state) => ({
    activeModelId: "openai:gpt-test",
    providerConnections: [{
      id: "openai-main",
      profileId: "personal",
      kind: "openai",
      displayName: "OpenAI",
      enabled: true,
      status: "valid",
      modelIds: ["openai:gpt-test"],
    }],
    generationSettings: {
      ...state.generationSettings,
      defaultModelByMode: { quick: "openai:gpt-test", deep: "mock:preview" },
    },
  }));

  useBrowserStore.getState().removeProviderConnection("openai-main");
  const state = useBrowserStore.getState();
  assert.equal(state.activeModelId, "mock:preview");
  assert.deepEqual(state.generationSettings.defaultModelByMode, { deep: "mock:preview" });
});

function artifactFor(jobId: string, id: string, url: string): PageArtifact {
  const job = useBrowserStore.getState().generationJobs[jobId];
  return {
    id,
    url,
    title: "Example",
    html: "<!doctype html><title>Example</title><main>Example</main>",
    summary: "Example page",
    siteWorldId: job.siteWorldId ?? "site-example",
    generationJobId: jobId,
    modelId: job.modelId,
    mode: job.mode,
    promptVersion: 1,
    settingsFingerprint: "test",
    createdAt: new Date().toISOString(),
    warnings: [],
  };
}
