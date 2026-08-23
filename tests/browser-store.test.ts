import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_BROWSER_PREFERENCES,
  DEFAULT_GENERATION_SETTINGS,
  migrateBrowserState,
  useBrowserStore,
} from "../src/store/browser-store";
import { resetGenerationPreviews, useGenerationPreviewStore } from "../src/generation/preview-store";
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
  delete window.__TAURI_INTERNALS__;
  useBrowserStore.setState(initialState, true);
  resetGenerationPreviews();
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

test("a protocol invocation can open a fresh foreground tab without using its payload", () => {
  const before = useBrowserStore.getState();
  const tabId = before.addTab();
  const state = useBrowserStore.getState();
  const tab = state.tabs.find((item) => item.id === tabId);

  assert.equal(state.tabs.length, before.tabs.length + 1);
  assert.equal(state.activeTabId, tabId);
  assert.equal(tab?.kind, "new-tab");
  assert.equal(tab?.location, "vibe://new-tab");
  assert.equal(tab?.generationJobId, undefined);
});

test("settings open on General by default and reuse the existing tab at the requested section", () => {
  const settingsId = useBrowserStore.getState().openSettings();
  let state = useBrowserStore.getState();
  assert.equal(state.tabs.find((tab) => tab.id === settingsId)?.location, "vibe://settings/general");

  state.activateTab("welcome");
  const reusedId = useBrowserStore.getState().openSettings("privacy");
  state = useBrowserStore.getState();
  assert.equal(reusedId, settingsId);
  assert.equal(state.activeTabId, settingsId);
  assert.equal(state.tabs.find((tab) => tab.id === settingsId)?.location, "vibe://settings/privacy");
  assert.equal(state.tabs.filter((tab) => tab.kind === "settings").length, 1);
});

test("generation debug opens as one reusable host-owned tab", () => {
  const debugId = useBrowserStore.getState().openGenerationDebug();
  let state = useBrowserStore.getState();
  const debugTab = state.tabs.find((tab) => tab.id === debugId);
  assert.equal(debugTab?.kind, "generation-debug");
  assert.equal(debugTab?.location, "vibe://generation-debug");
  state.activateTab("welcome");
  assert.equal(useBrowserStore.getState().openGenerationDebug(), debugId);
  state = useBrowserStore.getState();
  assert.equal(state.activeTabId, debugId);
  assert.equal(state.tabs.filter((tab) => tab.kind === "generation-debug").length, 1);
});

test("free-form prompt regeneration keeps its SiteWorld without sharing unrelated prompt worlds", () => {
  const prompt = "A calm research space for a new idea";
  const firstJobId = useBrowserStore.getState().navigate("welcome", prompt);
  assert.ok(firstJobId);
  const firstJob = useBrowserStore.getState().generationJobs[firstJobId];
  assert.ok(firstJob.siteWorldId);
  assert.equal(useBrowserStore.getState().siteWorlds[firstJob.siteWorldId], undefined);

  const artifact = artifactFor(firstJobId, "artifact-prompt", "https://generated.vibe.local/concept");
  assert.equal(useBrowserStore.getState().commitArtifact(firstJobId, artifact), true);
  const firstWorld = useBrowserStore.getState().siteWorlds[firstJob.siteWorldId];
  assert.ok(firstWorld);
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
  assert.deepEqual(background?.favicon, artifact.siteIdentity?.favicon);
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
  const baseArtifact = artifactFor(jobId, "artifact-world", "https://example.com/");
  const artifact = {
    ...baseArtifact,
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
    siteIdentity: {
      ...baseArtifact.siteIdentity!,
      name: "Example Journal",
      purpose: "A fictional journal",
      audience: "Curious readers",
      visualLanguage: {
        palette: ["#111111", "#eeeeee"], typography: "Arimo Variable", density: "comfortable" as const, radius: "subtle" as const, mood: "measured",
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
  assert.equal(useBrowserStore.getState().setGenerationPreview(jobId, "<main>Transient preview</main>"), true);
  assert.equal(useBrowserStore.getState().commitArtifact(jobId, artifact), true);
  assert.equal(useBrowserStore.getState().generationJobs[jobId].previewHtml, undefined);
  const world = useBrowserStore.getState().siteWorlds[artifact.siteWorldId];
  assert.equal(world.name, "Example Journal");
  assert.equal(world.revision, 1);
  assert.equal(world.visitedPageSummaries[0]?.artifactId, artifact.id);
  assert.deepEqual(world.informationArchitecture.map((route) => route.path), ["/latest", "/topics", "/about", "/archive"]);

  const nextJobId = useBrowserStore.getState().navigate("welcome", "/latest", { baseUrl: artifact.url });
  assert.ok(nextJobId);
  assert.equal(useBrowserStore.getState().generationJobs[nextJobId].siteWorldId, world.id);
});

test("reload deliberately creates a new generation while keeping the current artifact visible", () => {
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
  assert.equal(reloaded.fallbackArtifactId, artifact.id);
  assert.equal(reloaded.reloadKey, beforeTab.reloadKey);
  assert.equal(Object.keys(useBrowserStore.getState().generationJobs).length, jobCount + 1);
  assert.ok(reloaded.generationJobId);
  assert.notEqual(reloaded.generationJobId, firstJobId);
  assert.equal(reloaded.history.length, beforeTab.history.length);
  assert.equal(useBrowserStore.getState().generationJobs[reloaded.generationJobId].sourceArtifactId, artifact.id);
  assert.equal(useBrowserStore.getState().generationJobs[reloaded.generationJobId].navigationIntent.trigger, "regenerate");
});

test("a cached commit records another profile-scoped visit without creating a new artifact version", () => {
  const firstJobId = useBrowserStore.getState().navigate("welcome", "https://example.com/cached");
  assert.ok(firstJobId);
  const artifact = artifactFor(firstJobId, "artifact-cached", "https://example.com/cached");
  assert.equal(useBrowserStore.getState().commitArtifact(firstJobId, artifact), true);

  const secondJobId = useBrowserStore.getState().navigate("welcome", artifact.url);
  assert.ok(secondJobId);
  assert.equal(useBrowserStore.getState().commitCachedArtifact(secondJobId, artifact), true);
  const state = useBrowserStore.getState();
  assert.equal(state.tabs.find((item) => item.id === "welcome")?.artifactId, artifact.id);
  assert.deepEqual(state.browsingHistory.slice(0, 2).map((entry) => entry.status), ["cached", "completed"]);
  assert.ok(state.browsingHistory.slice(0, 2).every((entry) => entry.profileId === state.activeProfileId));
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
  assert.equal(state.generationJobs[jobId].previewRevision, undefined);
  assert.deepEqual(useGenerationPreviewStore.getState().previews[jobId], {
    html: "<main>Preview</main>",
    revision: 1,
  });
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
  assert.equal(migrated.generationSettings?.style.allowGeneratedScripts, false);
  assert.equal(migrated.generationSettings?.style.progressiveRendering, true);
  assert.equal(migrated.generationSettings?.images.provider, "tag-placeholder");
  assert.equal(migrated.generationSettings?.images.allowExternalRequests, true);
  assert.equal(migrated.generationSettings?.dynamicMode, "active");
});

test("migration preserves explicit dynamic modes and defaults legacy profiles to active", () => {
  assert.equal(migrateBrowserState({ generationSettings: {} }, 10).generationSettings?.dynamicMode, "active");
  assert.equal(migrateBrowserState({ generationSettings: { dynamicMode: "off" } }, 11).generationSettings?.dynamicMode, "off");
  assert.equal(migrateBrowserState({ generationSettings: { dynamicMode: "always" } }, 11).generationSettings?.dynamicMode, "always");
});

test("version-eleven sessions hydrate new voice defaults and typed system favicons", () => {
  const migrated = migrateBrowserState({
    tabs: [{
      id: "legacy-settings",
      title: "Settings",
      location: "vibe://settings/generation",
      kind: "settings",
      favicon: "⚙",
      history: [],
      historyIndex: 0,
    }],
    activeTabId: "legacy-settings",
    generationSettings: { capabilities: { experimentalEnabled: true } },
  }, 11);

  assert.deepEqual(migrated.tabs?.[0].favicon, { kind: "system", icon: "settings" });
  assert.deepEqual(migrated.generationSettings?.voice, DEFAULT_GENERATION_SETTINGS.voice);
  assert.equal(migrated.generationSettings?.capabilities.experimentalEnabled, true);
  assert.equal(migrated.generationSettings?.capabilities.enabled["data-chart"], true);
});

test("migration preserves individual capability flags and legacy audio opt-outs", () => {
  const explicit = migrateBrowserState({
    generationSettings: { capabilities: { enabled: { "data-chart": false, slideshow: true } } },
  }, 12).generationSettings!;
  assert.equal(explicit.capabilities.enabled["data-chart"], false);
  assert.equal(explicit.capabilities.enabled.slideshow, true);
  assert.equal(explicit.capabilities.enabled.diagram, true);

  const legacyAudio = migrateBrowserState({
    generationSettings: { capabilities: { audioSpeechEnabled: false } },
  }, 11).generationSettings!;
  assert.equal(legacyAudio.capabilities.enabled.speech, false);
  assert.equal(legacyAudio.capabilities.enabled.sound, false);
  assert.equal(legacyAudio.capabilities.enabled["pseudo-video"], true);
});

test("migration preserves an explicit generated JavaScript opt-in", () => {
  const migrated = migrateBrowserState({
    generationSettings: { style: { allowGeneratedScripts: true } },
  }, 6);

  assert.equal(migrated.generationSettings?.style.allowGeneratedScripts, true);
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

test("migration repairs escaped URLs in restored tabs, artifacts, jobs, and browsing history", () => {
  const brokenUrl = String.raw`https://wildberries.ru/%22/catalog/0/detail.aspx?cardId=845121\%22`;
  const canonicalUrl = "https://wildberries.ru/catalog/0/detail.aspx?cardId=845121";
  const migrated = migrateBrowserState({
    tabs: [{
      id: "broken-link-tab",
      title: "Wildberries",
      location: brokenUrl,
      kind: "generated",
      artifactId: "broken-link-artifact",
      generationJobId: "broken-link-job",
      history: [{ location: brokenUrl, title: "Wildberries", kind: "generated" }],
      historyIndex: 0,
    }],
    activeTabId: "broken-link-tab",
    generationJobs: {
      "broken-link-job": {
        id: "broken-link-job",
        tabId: "broken-link-tab",
        normalizedUrl: brokenUrl,
      },
    },
    artifacts: {
      "broken-link-artifact": {
        id: "broken-link-artifact",
        url: brokenUrl,
      },
    },
    browsingHistory: [{
      id: "broken-link-visit",
      profileId: "personal",
      url: brokenUrl,
      title: "Wildberries",
      status: "completed",
      openedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    }],
  }, 6);

  assert.equal(migrated.tabs?.[0].location, canonicalUrl);
  assert.equal(migrated.tabs?.[0].history[0].location, canonicalUrl);
  assert.equal(migrated.generationJobs?.["broken-link-job"].normalizedUrl, canonicalUrl);
  assert.equal(migrated.artifacts?.["broken-link-artifact"].url, canonicalUrl);
  assert.equal(migrated.browsingHistory?.[0].url, canonicalUrl);
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

test("desktop migration defers custom model validation until host connections hydrate", () => {
  window.__TAURI_INTERNALS__ = {} as typeof window.__TAURI_INTERNALS__;
  const sourceTab = useBrowserStore.getInitialState().tabs[0];
  const migrated = migrateBrowserState({
    activeModelId: "openai:evo-local",
    providerConnections: [],
    tabs: [{ ...sourceTab, artifactId: undefined, generatedWith: "openai:evo-local" }],
  }, 14);

  assert.equal(migrated.activeModelId, "openai:evo-local");
  assert.equal(migrated.tabs?.[0].generatedWith, "openai:evo-local");
});

test("removing a provider resets the selected profile model", () => {
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
  }));

  useBrowserStore.getState().removeProviderConnection("openai-main");
  const state = useBrowserStore.getState();
  assert.equal(state.activeModelId, "mock:preview");
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
    promptVersion: 10,
    settingsFingerprint: "test",
    createdAt: new Date().toISOString(),
    warnings: [],
    worldPromptSnapshot: job.worldPromptSnapshot,
    siteIdentity: {
      classification: "original",
      locale: "en-US",
      era: "contemporary",
      name: "Example",
      purpose: "Example site",
      audience: "Readers",
      visualLanguage: { palette: ["#111111", "#ffffff"], typography: "Arimo Variable", density: "comfortable", radius: "subtle", mood: "calm" },
      establishedFacts: [],
      routeHints: [{ path: "/", label: "Home" }, { path: "/news", label: "News" }, { path: "/about", label: "About" }, { path: "/archive", label: "Archive" }],
      palette: { background: "#ffffff", surface: "#ffffff", text: "#111111", mutedText: "#555555", accent: "#2255aa", accentText: "#ffffff", border: "#dddddd" },
      fonts: { body: "Arimo Variable", heading: "Source Sans 3 Variable" },
      layoutSystem: "Editorial grid",
      favicon: { kind: "glyph", glyph: "E", foreground: "#ffffff", background: "#2255aa", shape: "rounded-square" },
    },
  };
}
