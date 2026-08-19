import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { PROFILE_PRESETS } from "../src/data/catalog";
import { useBrowserStore, migrateBrowserState } from "../src/store/browser-store";
import type { PageArtifact, SiteIdentity } from "../src/types/browser";

const initialState = useBrowserStore.getInitialState();
beforeEach(() => useBrowserStore.setState(initialState, true));

test("same-origin current links, new tabs, and direct input reuse one active identity per profile", () => {
  const firstJobId = useBrowserStore.getState().navigate("welcome", "https://bububu.com/")!;
  const firstJob = useBrowserStore.getState().generationJobs[firstJobId];
  useBrowserStore.getState().commitArtifact(firstJobId, artifact(firstJobId, firstJob.siteWorldId!, "https://bububu.com/", "Monster Search"));

  const currentJobId = useBrowserStore.getState().navigate("welcome", "/species", { baseUrl: "https://bububu.com/" })!;
  assert.equal(useBrowserStore.getState().generationJobs[currentJobId].siteWorldId, firstJob.siteWorldId);

  const linkedTab = useBrowserStore.getState().addTab("/signals", { baseUrl: "https://bububu.com/", opener: { tabId: "welcome" } });
  const linkedJobId = useBrowserStore.getState().tabs.find((tab) => tab.id === linkedTab)!.generationJobId!;
  assert.equal(useBrowserStore.getState().generationJobs[linkedJobId].siteWorldId, firstJob.siteWorldId);

  const directTab = useBrowserStore.getState().addTab("https://bububu.com/map");
  const directJobId = useBrowserStore.getState().tabs.find((tab) => tab.id === directTab)!.generationJobId!;
  assert.equal(useBrowserStore.getState().generationJobs[directJobId].siteWorldId, firstJob.siteWorldId);
});

test("the same origin is independent across profiles and profile prompt edits affect only new identities", () => {
  const firstJobId = useBrowserStore.getState().navigate("welcome", "https://bububu.com/")!;
  const firstJob = useBrowserStore.getState().generationJobs[firstJobId];
  useBrowserStore.getState().commitArtifact(firstJobId, artifact(firstJobId, firstJob.siteWorldId!, "https://bububu.com/", "Monster Search"));
  const frozenSnapshot = useBrowserStore.getState().siteWorlds[firstJob.siteWorldId!].promptSnapshot;

  useBrowserStore.getState().updateWorldPrompt({ vibe: "Web 2000", prompt: "A new universe revision." });
  const regenerateJobId = useBrowserStore.getState().regenerate("welcome")!;
  assert.deepEqual(useBrowserStore.getState().generationJobs[regenerateJobId].worldPromptSnapshot, frozenSnapshot);
  const newOriginJobId = useBrowserStore.getState().navigate("welcome", "https://new-world.example/")!;
  assert.equal(useBrowserStore.getState().generationJobs[newOriginJobId].worldPromptSnapshot.prompt, "A new universe revision.");
  assert.equal(useBrowserStore.getState().generationJobs[newOriginJobId].worldPromptSnapshot.vibe, "Web 2000");

  const otherProfileId = useBrowserStore.getState().createProfile({ preset: "cyberpunk" });
  const otherJobId = useBrowserStore.getState().navigate(useBrowserStore.getState().activeTabId, "https://bububu.com/")!;
  const otherJob = useBrowserStore.getState().generationJobs[otherJobId];
  assert.equal(otherJob.profileId, otherProfileId);
  assert.notEqual(otherJob.siteWorldId, firstJob.siteWorldId);
  assert.equal(otherJob.identityStrategy, "create");
});

test("profile appearance owns chrome skin and motion snapshots", () => {
  useBrowserStore.getState().patchPreferences({ theme: "cyberpunk", density: "compact" });
  assert.equal(useBrowserStore.getState().preferences.theme, "native");
  assert.equal(useBrowserStore.getState().preferences.density, "compact");
  useBrowserStore.getState().createProfile({ preset: "explorer" });
  assert.equal(useBrowserStore.getState().preferences.theme, "ie-classic");
  useBrowserStore.getState().patchPreferences({ theme: "sedative" });
  assert.equal(useBrowserStore.getState().preferences.theme, "ie-classic");
  const profileId = useBrowserStore.getState().activeProfileId;
  useBrowserStore.getState().updateProfile(profileId, { chromeSkin: "sedative" });
  assert.equal(useBrowserStore.getState().preferences.theme, "sedative");
  useBrowserStore.getState().patchPreferences({ animations: false });
  const jobId = useBrowserStore.getState().navigate(useBrowserStore.getState().activeTabId, "https://motion.example/")!;
  assert.equal(useBrowserStore.getState().generationJobs[jobId].motionEnabled, false);
});

test("creating a profile activates it with Profiles settings still open", () => {
  const before = useBrowserStore.getState().profiles.length;
  const id = useBrowserStore.getState().createProfile({ preset: "quiet" });
  const state = useBrowserStore.getState();
  assert.equal(state.profiles.length, before + 1);
  assert.equal(state.activeProfileId, id);
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0]?.kind, "settings");
  assert.equal(state.tabs[0]?.location, "vibe://settings/profiles");
  assert.equal(state.profiles.find((profile) => profile.id === id)?.worldPrompt.vibe, PROFILE_PRESETS.quiet.vibe);
});

test("Reimagine is transactional, archives the old incarnation, closes sibling tabs, and restore swaps context", () => {
  const firstJobId = useBrowserStore.getState().navigate("welcome", "https://bububu.com/")!;
  const firstJob = useBrowserStore.getState().generationJobs[firstJobId];
  useBrowserStore.getState().commitArtifact(firstJobId, artifact(firstJobId, firstJob.siteWorldId!, "https://bububu.com/", "Monster Search"));
  const siblingId = useBrowserStore.getState().addTab("https://bububu.com/archive");

  const reimagineJobId = useBrowserStore.getState().reimagine("welcome")!;
  const reimagineJob = useBrowserStore.getState().generationJobs[reimagineJobId];
  assert.equal(useBrowserStore.getState().siteWorlds[firstJob.siteWorldId!].state, "active");
  assert.equal(useBrowserStore.getState().siteWorlds[reimagineJob.siteWorldId!], undefined);

  useBrowserStore.getState().commitArtifact(reimagineJobId, artifact(reimagineJobId, reimagineJob.siteWorldId!, "https://bububu.com/", "Orbital Choir"));
  let state = useBrowserStore.getState();
  assert.equal(state.siteWorlds[firstJob.siteWorldId!].state, "archived");
  assert.equal(state.siteWorlds[reimagineJob.siteWorldId!].state, "active");
  assert.equal(state.tabs.some((tab) => tab.id === siblingId), false);

  state.go("welcome", -1);
  state = useBrowserStore.getState();
  assert.equal(state.tabs.find((tab) => tab.id === "welcome")!.archivedSiteWorldId, firstJob.siteWorldId);
  const jobCount = Object.keys(state.generationJobs).length;
  const reloadKey = state.tabs.find((tab) => tab.id === "welcome")!.reloadKey;
  state.reload("welcome");
  assert.equal(Object.keys(useBrowserStore.getState().generationJobs).length, jobCount);
  assert.equal(useBrowserStore.getState().tabs.find((tab) => tab.id === "welcome")!.reloadKey, reloadKey + 1);
  assert.equal(useBrowserStore.getState().regenerate("welcome"), undefined);
  assert.equal(state.restoreSiteWorld(firstJob.siteWorldId!, "welcome"), true);
  state = useBrowserStore.getState();
  assert.equal(state.siteWorlds[firstJob.siteWorldId!].state, "active");
  assert.equal(state.siteWorlds[reimagineJob.siteWorldId!].state, "archived");
});

test("profile switching keeps jobs alive and completion updates the bound workspace with an unread dot", () => {
  const jobId = useBrowserStore.getState().navigate("welcome", "https://background.example/")!;
  const job = useBrowserStore.getState().generationJobs[jobId];
  const otherProfileId = useBrowserStore.getState().createProfile({ preset: "quiet" });
  assert.equal(useBrowserStore.getState().activeProfileId, otherProfileId);
  assert.equal(useBrowserStore.getState().generationJobs[jobId].status, "queued");

  useBrowserStore.getState().commitArtifact(jobId, artifact(jobId, job.siteWorldId!, "https://background.example/", "Background World"));
  const personalTab = useBrowserStore.getState().profileWorkspaces.personal.tabs.find((tab) => tab.id === "welcome")!;
  assert.equal(personalTab.hasUnseenUpdate, true);
  useBrowserStore.getState().setProfile("personal");
  assert.equal(useBrowserStore.getState().tabs.find((tab) => tab.id === "welcome")!.hasUnseenUpdate, true);
  useBrowserStore.getState().markFrameReady("welcome");
  assert.equal(useBrowserStore.getState().tabs.find((tab) => tab.id === "welcome")!.hasUnseenUpdate, false);
});

test("state migration wraps the existing session in Personal and moves custom instruction into world prompt revision", () => {
  const migrated = migrateBrowserState({
    tabs: [{ id: "legacy", title: "Legacy", location: "vibe://new-tab", kind: "new-tab", history: [], historyIndex: 0 }],
    activeTabId: "legacy",
    activeProfileId: "personal",
    preferences: { theme: "ie-classic" },
    generationSettings: { customInstruction: "An old global universe instruction." },
  }, 8);
  assert.equal(migrated.activeTabId, "legacy");
  assert.equal(migrated.profiles?.length, 1);
  assert.equal(migrated.profiles?.[0]?.chromeSkin, "ie-classic");
  assert.deepEqual(migrated.profiles?.[0]?.worldPrompt, { revision: 1, vibe: "", prompt: "An old global universe instruction." });
});

function artifact(jobId: string, siteWorldId: string, url: string, name: string): PageArtifact {
  const job = useBrowserStore.getState().generationJobs[jobId];
  const siteIdentity = identity(name);
  return { id: `artifact-${jobId}`, profileId: job.profileId, url, title: name, html: `<!doctype html><title>${name}</title>`, summary: `${name} home`, siteWorldId, generationJobId: jobId, modelId: job.modelId, promptVersion: 10, settingsFingerprint: "test", createdAt: new Date().toISOString(), warnings: [], siteIdentity, sitePatch: siteIdentity, worldPromptSnapshot: job.worldPromptSnapshot };
}

function identity(name: string): SiteIdentity {
  return { classification: "original", locale: "en-US", era: "contemporary", name, purpose: `${name} has one concrete function`, audience: "Specialist visitors", visualLanguage: { palette: ["#100f18", "#f7f2ff"], typography: "Arimo Variable", density: "compact", radius: "subtle", mood: "specific" }, establishedFacts: [`${name} exists.`], routeHints: [{ path: "/", label: "Home" }, { path: "/species", label: "Species" }, { path: "/signals", label: "Signals" }, { path: "/archive", label: "Archive" }], palette: { background: "#100f18", surface: "#1b1826", text: "#f7f2ff", mutedText: "#aaa0b8", accent: "#c084fc", accentText: "#100f18", border: "#40364c" }, fonts: { body: "Arimo Variable", heading: "Source Sans 3 Variable" }, layoutSystem: "Dense asymmetric index", favicon: { kind: "glyph", glyph: name.slice(0, 1), foreground: "#ffffff", background: "#6b21a8", shape: "rounded-square" } };
}
