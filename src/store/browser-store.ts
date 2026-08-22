import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MODELS, PROFILE_PRESETS, PROFILES } from "../data/catalog";
import { deterministicGlyphFavicon, faviconSourceValue, systemFavicon } from "../lib/favicon";
import {
  DEFAULT_GENERATION_CAPABILITY_FLAGS,
  USER_CONFIGURABLE_CAPABILITY_IDS,
} from "../generation/capability-settings";
import {
  isExplicitRelativeReference,
  normalizeVirtualUrl,
  readableHost,
  resolveNavigation,
  resolveRealNavigation,
  type NavigationTarget,
} from "../lib/navigation";
import type {
  BrowserProfile,
  BrowserPreferences,
  BrowserTab,
  BrowsingHistoryEntry,
  CodexConnection,
  CodexGenerationSelection,
  CodexModel,
  Density,
  FaviconSource,
  GenerationError,
  GenerationJob,
  GenerationPhase,
  GenerationProgress,
  GenerationSettings,
  HistoryEntry,
  ImageGenerationSettings,
  NavigationDisposition,
  NavigationIntent,
  PageArtifact,
  PageSummary,
  ProfilePromptSnapshot,
  ProviderConnection,
  ProfileWorkspace,
  SiteIdentity,
  SiteWorld,
  TabKind,
  TabLayout,
  TabOpenerContext,
  ThemeId,
} from "../types/browser";

export interface AddTabOptions {
  disposition?: Exclude<NavigationDisposition, "current">;
  placement?: "end" | "after-opener";
  opener?: TabOpenerContext;
  baseUrl?: string;
  intent?: Partial<NavigationIntent>;
}

export interface NavigateOptions {
  baseUrl?: string;
  intent?: Partial<NavigationIntent>;
}

export interface GenerationProgressPatch {
  provisionalTitle?: string;
  provisionalFavicon?: FaviconSource;
}

export interface GenerationMetadataPatch extends GenerationProgressPatch {
  provisionalSummary?: string;
}

export interface BrowserState {
  profiles: BrowserProfile[];
  profileWorkspaces: Record<string, ProfileWorkspace>;
  tabs: BrowserTab[];
  activeTabId: string;
  activeModelId: string;
  activeProfileId: string;
  preferences: BrowserPreferences;
  codex: CodexConnection;
  codexModels: CodexModel[];
  codexSelection: CodexGenerationSelection;
  artifacts: Record<string, PageArtifact>;
  browsingHistory: BrowsingHistoryEntry[];
  generationJobs: Record<string, GenerationJob>;
  siteWorlds: Record<string, SiteWorld>;
  providerConnections: ProviderConnection[];
  generationSettings: GenerationSettings;
  addTab: (input?: string, options?: AddTabOptions) => string;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  reorderTabs: (activeId: string, overId: string) => void;
  navigate: (id: string, input: string, options?: NavigateOptions) => string | undefined;
  navigateReal: (id: string, input: string) => void;
  go: (id: string, delta: -1 | 1) => void;
  reload: (id: string) => void;
  regenerate: (id: string) => string | undefined;
  discoverLucky: (id: string) => string | undefined;
  setLoadState: (id: string, state: BrowserTab["loadState"]) => void;
  setTabMetadata: (
    id: string,
    patch: Pick<Partial<BrowserTab>, "title" | "favicon">,
    expectedJobId?: string,
  ) => boolean;
  beginGeneration: (jobId: string) => boolean;
  setGenerationPhase: (jobId: string, phase: GenerationPhase, patch?: GenerationProgressPatch) => boolean;
  setGenerationProgress: (jobId: string, progress: GenerationProgress) => boolean;
  addGenerationWarning: (jobId: string, warning: { code: string; message: string }) => boolean;
  setGenerationMetadata: (jobId: string, patch: GenerationMetadataPatch) => boolean;
  setGenerationPreview: (jobId: string, html: string, revision?: number) => boolean;
  commitArtifact: (jobId: string, artifact: PageArtifact) => boolean;
  commitCachedArtifact: (jobId: string, artifact: PageArtifact) => boolean;
  completeLucky: (jobId: string, artifact: PageArtifact) => string | undefined;
  failGeneration: (jobId: string, error: GenerationError) => boolean;
  cancelGeneration: (jobId: string) => boolean;
  cancelTabGeneration: (tabId: string) => boolean;
  recoverInterruptedJobs: () => void;
  hydrateArtifacts: (artifacts: PageArtifact[]) => void;
  hydrateSiteWorlds: (siteWorlds: SiteWorld[]) => void;
  upsertSiteWorld: (siteWorld: SiteWorld) => void;
  upsertProviderConnection: (connection: ProviderConnection) => void;
  removeProviderConnection: (id: string) => void;
  patchGenerationSettings: (patch: Partial<GenerationSettings>) => void;
  patchStyleSettings: (patch: Partial<GenerationSettings["style"]>) => void;
  patchImageSettings: (patch: Partial<ImageGenerationSettings>) => void;
  patchCapabilitySettings: (patch: Partial<GenerationSettings["capabilities"]>) => void;
  patchVoiceSettings: (patch: Partial<GenerationSettings["voice"]>) => void;
  patchPrivacySettings: (patch: Partial<GenerationSettings["privacy"]>) => void;
  openSettings: (section?: string) => string;
  openHistory: () => string;
  openActivity: (jobId?: string) => string;
  openCapabilities: () => string;
  openGenerationDebug: () => string;
  removeBrowsingHistoryEntry: (id: string) => void;
  clearBrowsingHistory: (profileId?: string) => void;
  setSettingsSection: (section: string) => void;
  setModel: (id: string) => void;
  setProfile: (id: string) => void;
  createProfile: (input: {
    preset?: keyof typeof PROFILE_PRESETS;
    name?: string;
    avatar?: string;
    chromeSkin?: ThemeId;
    vibe?: string;
    worldPrompt?: string;
  }) => string;
  updateProfile: (id: string, patch: Pick<Partial<BrowserProfile>, "name" | "avatar" | "chromeSkin">) => void;
  updateWorldPrompt: (input: Pick<ProfilePromptSnapshot, "vibe" | "prompt"> | string) => void;
  deleteProfile: (id: string) => boolean;
  startProfileFromScratch: () => void;
  reimagine: (id: string) => string | undefined;
  markFrameReady: (id: string) => void;
  restoreSiteWorld: (siteWorldId: string, sourceTabId: string) => boolean;
  setTabLayout: (layout: TabLayout) => void;
  setDensity: (density: Density) => void;
  patchPreferences: (patch: Partial<BrowserPreferences>) => void;
  patchCodex: (patch: Partial<CodexConnection>) => void;
  setCodexModels: (models: CodexModel[]) => void;
  patchCodexSelection: (patch: Partial<CodexGenerationSelection>) => void;
}

export const DEFAULT_BROWSER_PREFERENCES: BrowserPreferences = {
  theme: "native",
  colorScheme: "system",
  tabLayout: "horizontal",
  density: "comfortable",
  animations: true,
  reopenSession: true,
  openBlockedExternally: false,
  sidebarWidth: 240,
};

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  promptVersion: 18,
  strategy: "full",
  maxOutputTokens: 16_000,
  reuseCachedPages: true,
  dynamicMode: "active",
  style: {
    tailwindEnabled: true,
    tailwindVersion: "4.3.3",
    allowArbitraryUtilities: true,
    customCssInstruction: "",
    allowGeneratedScripts: false,
    progressiveRendering: true,
  },
  images: {
    enabled: true,
    provider: "tag-placeholder",
    safeContent: true,
    allowExternalRequests: true,
  },
  capabilities: {
    iconsEnabled: true,
    audioSpeechEnabled: true,
    externalMediaEnabled: false,
    experimentalEnabled: false,
    enabled: DEFAULT_GENERATION_CAPABILITY_FLAGS,
  },
  voice: {
    engine: "local",
    provider: "openai",
    model: "kokoro-82m-q8",
    voice: "af_heart",
    availableVoiceIds: ["af_heart"],
    speed: 1,
    musicMode: "built-in",
    musicVolume: 0.22,
  },
  privacy: {
    includeNavigationHistory: true,
    sameSiteSummariesOnly: true,
    diagnosticsEnabled: false,
  },
};

export const DEFAULT_CODEX_SELECTION: CodexGenerationSelection = {};

const initialTabs: BrowserTab[] = [
  makeTab({
    id: "welcome",
    title: "New tab",
    location: "vibe://new-tab",
    kind: "new-tab",
    favicon: systemFavicon("new-tab"),
  }),
  makeTab({
    id: "quiet-interface",
    title: "A quiet interface for ideas",
    location: "vibe://generated/quiet-interface",
    kind: "generated",
    prompt: "A quiet interface for ideas that are still taking shape",
    favicon: systemFavicon("new-tab"),
    generatedWith: "mock:preview",
  }),
];

export const useBrowserStore = create<BrowserState>()(
  persist(
    (set, get) => ({
      tabs: initialTabs,
      activeTabId: "welcome",
      activeModelId: MODELS[0].id,
      activeProfileId: PROFILES[0].id,
      profiles: PROFILES,
      profileWorkspaces: {},
      preferences: DEFAULT_BROWSER_PREFERENCES,
      codex: {
        state: "signed-out",
        available: false,
        message: "Not connected",
      },
      codexModels: [],
      codexSelection: DEFAULT_CODEX_SELECTION,
      artifacts: {},
      browsingHistory: [],
      generationJobs: {},
      siteWorlds: {},
      providerConnections: [],
      generationSettings: DEFAULT_GENERATION_SETTINGS,
      addTab: (input, options = {}) => {
        const id = createId("tab");
        const state = get();
        const disposition = options.disposition ?? "foreground-tab";
        const target = input
          ? resolveNavigation(input, state.activeModelId, { baseUrl: options.baseUrl })
          : resolveNavigation("vibe://new-tab", state.activeModelId);
        const sourceTab = options.opener?.tabId
          ? state.tabs.find((tab) => tab.id === options.opener?.tabId)
          : undefined;
        const reusesCurrentArtifact = target.kind === "generated" && !target.requiresGeneration;
        const navigation = prepareNavigation(state, id, target, {
          requestedValue: input ?? "vibe://new-tab",
          disposition,
          trigger: options.intent?.trigger ?? "address-bar",
          intent: options.intent,
          sourceTabId: options.opener?.tabId,
          sourceArtifactId: options.opener?.artifactId,
        });
        const tab = makeTab({
          id,
          ...target,
          ...navigation.current,
          title: reusesCurrentArtifact ? sourceTab?.title ?? target.title : target.title,
          favicon: reusesCurrentArtifact ? sourceTab?.favicon ?? target.favicon : target.favicon,
          opener: options.opener,
          generatedWith: target.kind === "generated"
            ? reusesCurrentArtifact ? sourceTab?.generatedWith ?? state.activeModelId : state.activeModelId
            : undefined,
          loadState: loadStateForTarget(target, navigation.job),
        });
        const placement = options.placement ?? (options.opener ? "after-opener" : "end");
        const openerIndex = options.opener
          ? state.tabs.findIndex((item) => item.id === options.opener?.tabId)
          : -1;
        const insertAt = placement === "after-opener" && openerIndex >= 0 ? openerIndex + 1 : state.tabs.length;
        const tabs = [...state.tabs];
        tabs.splice(insertAt, 0, tab);
        set({
          tabs,
          activeTabId: disposition === "background-tab" ? state.activeTabId : id,
          generationJobs: navigation.generationJobs,
          siteWorlds: navigation.siteWorlds,
          browsingHistory: navigation.job
            ? appendBrowsingHistory(state.browsingHistory, navigation.job, target.title)
            : state.browsingHistory,
        });
        return id;
      },
      closeTab: (id) => {
        const state = get();
        const index = state.tabs.findIndex((tab) => tab.id === id);
        if (index < 0) return;
        const closingTab = state.tabs[index];
        const generationJobs = cancelJobRecord(
          cancelJobRecord(state.generationJobs, closingTab.generationJobId),
          closingTab.luckyJobId,
        );
        const tabs = state.tabs.filter((tab) => tab.id !== id);

        if (tabs.length === 0) {
          const replacement = makeTab({
            id: createId("tab"),
            title: "New tab",
            location: "vibe://new-tab",
            kind: "new-tab",
            favicon: systemFavicon("new-tab"),
          });
          set({
            tabs: [replacement],
            activeTabId: replacement.id,
            generationJobs,
            browsingHistory: markCancelledBrowsingHistory(state.browsingHistory, closingTab.generationJobId),
          });
          return;
        }

        const activeTabId =
          state.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeTabId;
        set({
          tabs,
          activeTabId,
          generationJobs,
          browsingHistory: markCancelledBrowsingHistory(state.browsingHistory, closingTab.generationJobId),
        });
      },
      activateTab: (id) => {
        if (get().tabs.some((tab) => tab.id === id)) set({ activeTabId: id });
      },
      reorderTabs: (activeId, overId) => {
        const tabs = [...get().tabs];
        const from = tabs.findIndex((tab) => tab.id === activeId);
        const to = tabs.findIndex((tab) => tab.id === overId);
        if (from < 0 || to < 0 || from === to) return;
        const [tab] = tabs.splice(from, 1);
        tabs.splice(to, 0, tab);
        set({ tabs });
      },
      navigate: (id, input, options = {}) => {
        const state = get();
        const currentTab = state.tabs.find((tab) => tab.id === id);
        if (!currentTab) return undefined;
        const baseUrl = options.baseUrl
          ?? (isExplicitRelativeReference(input) && normalizeVirtualUrl(currentTab.location)
            ? currentTab.location
            : undefined);
        const target = resolveNavigation(input, state.activeModelId, { baseUrl });
        const reusesCurrentArtifact = target.kind === "generated" && !target.requiresGeneration;
        const jobsWithoutLucky = cancelJobRecord(state.generationJobs, currentTab.luckyJobId);
        const generationJobs = reusesCurrentArtifact
          ? jobsWithoutLucky
          : cancelJobRecord(jobsWithoutLucky, currentTab.generationJobId);
        const stateWithCancelledJob = { ...state, generationJobs };
        const navigation = prepareNavigation(stateWithCancelledJob, id, target, {
          requestedValue: input,
          disposition: "current",
          trigger: options.intent?.trigger ?? "address-bar",
          intent: options.intent,
          sourceTabId: id,
          sourceArtifactId: currentTab.artifactId,
          sourceHistoryEntryId: currentTab.history[currentTab.historyIndex]?.id,
        });
        const history = currentTab.history.slice(0, currentTab.historyIndex + 1);
        history.push(
          makeHistoryEntry(target, {
            ...navigation.current,
            title: reusesCurrentArtifact ? currentTab.title : target.title,
            favicon: reusesCurrentArtifact ? currentTab.favicon : target.favicon,
          }),
        );
        const nextTab: BrowserTab = {
          ...currentTab,
          ...target,
          ...navigation.current,
          prompt: target.prompt,
          virtualLocation: target.virtualLocation,
          title: reusesCurrentArtifact ? currentTab.title : target.title,
          favicon: reusesCurrentArtifact ? currentTab.favicon : target.favicon,
          generatedWith: target.kind === "generated" ? state.activeModelId : undefined,
          fallbackArtifactId: navigation.job
            ? currentTab.artifactId ?? currentTab.fallbackArtifactId
            : undefined,
          luckyJobId: undefined,
          loadState: loadStateForTarget(target, navigation.job),
          history,
          historyIndex: history.length - 1,
        };
        const browsingHistory = markCancelledBrowsingHistory(state.browsingHistory, currentTab.generationJobId);
        set({
          tabs: state.tabs.map((tab) => (tab.id === id ? nextTab : tab)),
          generationJobs: navigation.generationJobs,
          siteWorlds: navigation.siteWorlds,
          browsingHistory: navigation.job
            ? appendBrowsingHistory(browsingHistory, navigation.job, target.title)
            : target.kind === "generated" && navigation.current.artifactId
              ? appendCachedHistoryEntry(
                  browsingHistory,
                  state.activeProfileId,
                  target.location,
                  reusesCurrentArtifact ? currentTab.title : target.title,
                  navigation.current.artifactId,
                )
              : browsingHistory,
        });
        return navigation.job?.id;
      },
      navigateReal: (id, input) => {
        const state = get();
        const currentTab = state.tabs.find((tab) => tab.id === id);
        if (!currentTab) return;
        const target = resolveRealNavigation(input);
        const history = currentTab.history.slice(0, currentTab.historyIndex + 1);
        history.push(makeHistoryEntry(target));
        const generationJobs = cancelJobRecord(
          cancelJobRecord(state.generationJobs, currentTab.generationJobId),
          currentTab.luckyJobId,
        );
        set({
          generationJobs,
          browsingHistory: markCancelledBrowsingHistory(state.browsingHistory, currentTab.generationJobId),
          tabs: state.tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  ...target,
                  prompt: undefined,
                  artifactId: undefined,
                  fallbackArtifactId: undefined,
                  generationJobId: undefined,
                  luckyJobId: undefined,
                  generatedWith: undefined,
                  loadState: "loading",
                  history,
                  historyIndex: history.length - 1,
                }
              : tab,
          ),
        });
      },
      go: (id, delta) => {
        const state = get();
        const currentTab = state.tabs.find((tab) => tab.id === id);
        if (!currentTab) return;
        const historyIndex = Math.max(0, Math.min(currentTab.history.length - 1, currentTab.historyIndex + delta));
        if (historyIndex === currentTab.historyIndex) return;
        const target = currentTab.history[historyIndex];
        const generationJobs = cancelJobRecord(state.generationJobs, currentTab.generationJobId);
        const targetJob = target.generationJobId ? generationJobs[target.generationJobId] : undefined;
        set({
          generationJobs,
          tabs: state.tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  title: target.title,
                  location: target.location,
                  favicon: target.favicon,
                  kind: target.kind,
                  prompt: target.prompt,
                  virtualLocation: target.virtualLocation,
                  artifactId: target.artifactId,
                  siteWorldId: target.siteWorldId,
                  archivedSiteWorldId: target.archivedSiteWorldId,
                  fallbackArtifactId: undefined,
                  generationJobId: target.generationJobId,
                  historyIndex,
                  loadState: loadStateForHistory(target, targetJob),
                  generatedWith: target.kind === "generated" ? targetJob?.modelId ?? tab.generatedWith : undefined,
                }
              : tab,
          ),
        });
      },
      reload: (id) => {
        const tab = get().tabs.find((item) => item.id === id);
        if (tab?.kind === "generated") {
          if (tab.archivedSiteWorldId) {
            set((state) => ({
              tabs: state.tabs.map((item) => item.id === id ? { ...item, reloadKey: item.reloadKey + 1 } : item),
            }));
            return;
          }
          get().regenerate(id);
          return;
        }
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === id
              ? { ...item, reloadKey: item.reloadKey + 1, loadState: item.kind === "remote" ? "idle" : item.loadState }
              : item,
          ),
        }));
      },
      regenerate: (id) => {
        const state = get();
        const tab = state.tabs.find((item) => item.id === id);
        if (!tab || tab.kind !== "generated" || tab.archivedSiteWorldId) return undefined;
        const target: NavigationTarget = {
          location: tab.location,
          title: tab.title,
          kind: "generated",
          prompt: tab.prompt,
          favicon: tab.favicon,
          virtualLocation: tab.virtualLocation,
          requiresGeneration: true,
        };
        const generationJobs = cancelJobRecord(
          cancelJobRecord(state.generationJobs, tab.generationJobId),
          tab.luckyJobId,
        );
        const sourceArtifact = tab.artifactId ? state.artifacts[tab.artifactId] : undefined;
        const sourceJob = tab.generationJobId ? state.generationJobs[tab.generationJobId] : undefined;
        const navigation = prepareNavigation({ ...state, generationJobs }, id, target, {
          requestedValue: tab.prompt ?? tab.location,
          disposition: "current",
          trigger: "regenerate",
          sourceTabId: id,
          sourceArtifactId: tab.artifactId,
          sourceHistoryEntryId: tab.history[tab.historyIndex]?.id,
          reuseSiteWorldId: sourceArtifact?.siteWorldId ?? sourceJob?.siteWorldId,
        });
        const history = [...tab.history];
        const currentEntry = history[tab.historyIndex];
        history[tab.historyIndex] = {
          ...currentEntry,
          generationJobId: navigation.job?.id,
          artifactId: tab.artifactId,
          siteWorldId: navigation.job?.siteWorldId,
        };
        set({
          generationJobs: navigation.generationJobs,
          siteWorlds: navigation.siteWorlds,
          browsingHistory: navigation.job
            ? appendBrowsingHistory(markCancelledBrowsingHistory(state.browsingHistory, tab.generationJobId), navigation.job, tab.title)
            : markCancelledBrowsingHistory(state.browsingHistory, tab.generationJobId),
          tabs: state.tabs.map((item) =>
            item.id === id
              ? {
                  ...item,
                  generationJobId: navigation.job?.id,
                  siteWorldId: navigation.job?.siteWorldId,
                  fallbackArtifactId: tab.artifactId ?? tab.fallbackArtifactId,
                  luckyJobId: undefined,
                  loadState: "loading",
                  generatedWith: state.activeModelId,
                  history,
                }
              : item,
          ),
        });
        return navigation.job?.id;
      },
      discoverLucky: (id) => {
        const state = get();
        const tab = state.tabs.find((item) => item.id === id);
        if (!tab) return undefined;
        const generationJobs = cancelJobRecord(state.generationJobs, tab.luckyJobId);
        const prompt = [
          "Privately invent exactly 10 unexpected, surprising absolute URLs that genuinely exist in this browser's current alternate internet.",
          "They must be diverse destinations, not ten pages of one site, and each must reveal a different piece of this world's lived-in lore.",
          "Build a private directory page whose site route hints contain exactly those 10 absolute URLs. Do not explain that this is a recommendation or generated list.",
        ].join(" ");
        const target = resolveNavigation(prompt, state.activeModelId);
        const navigation = prepareNavigation({ ...state, generationJobs }, id, target, {
          requestedValue: prompt,
          disposition: "current",
          trigger: "address-bar",
          sourceTabId: id,
          sourceArtifactId: tab.artifactId,
          sourceHistoryEntryId: tab.history[tab.historyIndex]?.id,
        });
        if (!navigation.job) return undefined;
        const luckyJob: GenerationJob = { ...navigation.job, purpose: "lucky-urls" };
        set({
          generationJobs: { ...navigation.generationJobs, [luckyJob.id]: luckyJob },
          siteWorlds: navigation.siteWorlds,
          tabs: state.tabs.map((item) => item.id === id ? { ...item, luckyJobId: luckyJob.id } : item),
        });
        return luckyJob.id;
      },
      setLoadState: (id, loadState) => {
        const state = get();
        const tab = state.tabs.find((item) => item.id === id);
        if (!tab) return;
        const generationJobs = loadState === "idle"
          ? cancelJobRecord(state.generationJobs, tab.generationJobId)
          : state.generationJobs;
        set({
          generationJobs,
          tabs: state.tabs.map((item) => (item.id === id ? { ...item, loadState } : item)),
        });
      },
      setTabMetadata: (id, patch, expectedJobId) => {
        const state = get();
        const tab = state.tabs.find((item) => item.id === id);
        if (!tab || (expectedJobId && tab.generationJobId !== expectedJobId)) return false;
        set({
          tabs: state.tabs.map((item) => {
            if (item.id !== id) return item;
            const history = patchCurrentHistory(item, patch);
            return { ...item, ...patch, history };
          }),
        });
        return true;
      },
      beginGeneration: (jobId) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job) return false;
        const now = new Date().toISOString();
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: {
              ...job,
              status: "running",
              phase: "preparing-context",
              startedAt: job.startedAt ?? now,
              updatedAt: now,
            },
          },
        });
        return true;
      },
      setGenerationPhase: (jobId, phase, patch = {}) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job || terminalPhase(phase)) return false;
        const now = new Date().toISOString();
        const titlePatch = patch.provisionalTitle ? { title: patch.provisionalTitle } : {};
        const faviconPatch = patch.provisionalFavicon ? { favicon: patch.provisionalFavicon } : {};
        const jobTabs = tabsForWorkspace(state, job.profileId);
        const nextTabs = jobTabs.map((tab) => {
          if (job.purpose === "lucky-urls" || tab.id !== job.tabId || tab.generationJobId !== jobId) return tab;
          const metadataPatch = { ...titlePatch, ...faviconPatch };
          return { ...tab, ...metadataPatch, history: patchCurrentHistory(tab, metadataPatch) };
        });
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: {
              ...job,
              ...patch,
              phase,
              status: phase === "queued" ? "queued" : "running",
              updatedAt: now,
            },
          },
          ...workspaceTabsPatch(state, job.profileId, nextTabs),
        });
        return true;
      },
      setGenerationProgress: (jobId, progress) => {
        const state = get();
        const job = state.generationJobs[jobId];
        if (!job || !isActiveJob(job)) return false;
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: { ...job, progress, updatedAt: progress.emittedAt },
          },
        });
        return true;
      },
      addGenerationWarning: (jobId, warning) => {
        const state = get();
        const job = state.generationJobs[jobId];
        if (!job) return false;
        const warnings = [...(job.warnings ?? []), warning].slice(-100);
        set({ generationJobs: { ...state.generationJobs, [jobId]: { ...job, warnings } } });
        return true;
      },
      setGenerationMetadata: (jobId, patch) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job) return false;
        const titlePatch = patch.provisionalTitle ? { title: patch.provisionalTitle } : {};
        const faviconPatch = patch.provisionalFavicon ? { favicon: patch.provisionalFavicon } : {};
        const metadataPatch = { ...titlePatch, ...faviconPatch };
        const jobTabs = tabsForWorkspace(state, job.profileId);
        const nextTabs = jobTabs.map((tab) =>
          job.purpose !== "lucky-urls" && tab.id === job.tabId && tab.generationJobId === jobId
            ? { ...tab, ...metadataPatch, history: patchCurrentHistory(tab, metadataPatch) }
            : tab);
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: { ...job, ...patch, updatedAt: new Date().toISOString() },
          },
          ...workspaceTabsPatch(state, job.profileId, nextTabs),
        });
        return true;
      },
      setGenerationPreview: (jobId, html, revision) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job) return false;
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: {
              ...job,
              previewHtml: html,
              previewRevision: revision ?? (job.previewRevision ?? 0) + 1,
              updatedAt: new Date().toISOString(),
            },
          },
        });
        return true;
      },
      commitArtifact: (jobId, artifact) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job || job.purpose === "lucky-urls" || artifact.generationJobId !== jobId) return false;
        const jobTabs = tabsForWorkspace(state, job.profileId);
        const tab = jobTabs.find((item) => item.id === job.tabId);
        if (!tab) return false;
        const now = new Date().toISOString();
        let siteWorlds = mergeArtifactIntoSiteWorld(state.siteWorlds, artifact, job, now);
        const favicon = siteWorlds[artifact.siteWorldId]?.identity.favicon ?? faviconValue(artifact) ?? tab.favicon;
        const history = patchCurrentHistory(tab, {
          title: artifact.title,
          favicon,
          artifactId: artifact.id,
          generationJobId: jobId,
          siteWorldId: artifact.siteWorldId,
        });
        let generationJobs = {
          ...state.generationJobs,
          [jobId]: {
            ...job,
            artifactId: artifact.id,
            previewHtml: undefined,
            usage: artifact.usage,
            status: "completed" as const,
            phase: "completed" as const,
            updatedAt: now,
          },
        };
        let nextTabs = jobTabs.map((item) =>
          item.id === job.tabId && item.generationJobId === jobId
            ? {
                ...item,
                title: artifact.title,
                favicon,
                artifactId: artifact.id,
                siteWorldId: artifact.siteWorldId,
                fallbackArtifactId: undefined,
                loadState: "idle" as const,
                hasUnseenUpdate: job.profileId !== state.activeProfileId || item.id !== state.activeTabId,
                history,
              }
            : item,
        );
        if (job.identityStrategy === "reimagine") {
          const origin = normalizeVirtualUrl(artifact.url)?.origin;
          const archivedIds = new Set<string>();
          if (origin) {
            const closedJobIds = nextTabs
              .filter((item) => item.id !== job.tabId && item.virtualLocation?.origin === origin)
              .flatMap((item) => [item.generationJobId, item.luckyJobId].filter((id): id is string => Boolean(id)));
            for (const closedJobId of closedJobIds) generationJobs = cancelJobRecord(generationJobs, closedJobId);
            siteWorlds = Object.fromEntries(Object.entries(siteWorlds).map(([id, world]) => {
              if (world.profileId === job.profileId && world.origin === origin && id !== artifact.siteWorldId && world.state === "active") {
                archivedIds.add(id);
                return [id, { ...world, state: "archived" as const, archivedAt: now, updatedAt: now }];
              }
              return [id, world];
            }));
            nextTabs = nextTabs
              .filter((item) => item.id === job.tabId || item.virtualLocation?.origin !== origin)
              .map((item) => ({
                ...item,
                history: item.history.map((entry) => entry.siteWorldId && archivedIds.has(entry.siteWorldId)
                  ? { ...entry, archivedSiteWorldId: entry.siteWorldId }
                  : entry),
              }));
          }
        }
        const workspacePatch = workspaceTabsPatch(state, job.profileId, nextTabs);
        if (job.identityStrategy === "reimagine" && "profileWorkspaces" in workspacePatch) {
          const workspace = workspacePatch.profileWorkspaces[job.profileId];
          if (workspace) workspacePatch.profileWorkspaces[job.profileId] = { ...workspace, activeTabId: job.tabId };
        }
        set({
          artifacts: { ...state.artifacts, [artifact.id]: { ...artifact, profileId: job.profileId } },
          siteWorlds,
          generationJobs,
          ...workspacePatch,
          ...(job.identityStrategy === "reimagine" && job.profileId === state.activeProfileId
            ? { activeTabId: job.tabId }
            : {}),
          browsingHistory: updateBrowsingHistory(state.browsingHistory, jobId, {
            status: "completed",
            title: artifact.title,
            favicon,
            artifactId: artifact.id,
            updatedAt: now,
          }),
        });
        return true;
      },
      commitCachedArtifact: (jobId, artifact) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job || job.purpose === "lucky-urls") return false;
        const jobTabs = tabsForWorkspace(state, job.profileId);
        const tab = jobTabs.find((item) => item.id === job.tabId);
        if (!tab) return false;
        const now = new Date().toISOString();
        const favicon = state.siteWorlds[artifact.siteWorldId]?.identity.favicon ?? faviconValue(artifact) ?? tab.favicon;
        const history = patchCurrentHistory(tab, {
          title: artifact.title,
          favicon,
          artifactId: artifact.id,
          generationJobId: jobId,
          siteWorldId: artifact.siteWorldId,
        });
        const nextTabs = jobTabs.map((item) => item.id === job.tabId && item.generationJobId === jobId
          ? {
              ...item,
              title: artifact.title,
              favicon,
              artifactId: artifact.id,
              siteWorldId: artifact.siteWorldId,
              fallbackArtifactId: undefined,
              loadState: "idle" as const,
              hasUnseenUpdate: job.profileId !== state.activeProfileId || item.id !== state.activeTabId,
              history,
            }
          : item);
        set({
          artifacts: { ...state.artifacts, [artifact.id]: { ...artifact, profileId: job.profileId } },
          generationJobs: {
            ...state.generationJobs,
            [jobId]: { ...job, artifactId: artifact.id, status: "completed", phase: "completed", updatedAt: now },
          },
          ...workspaceTabsPatch(state, job.profileId, nextTabs),
          browsingHistory: updateBrowsingHistory(state.browsingHistory, jobId, {
            status: "cached",
            title: artifact.title,
            favicon,
            artifactId: artifact.id,
            updatedAt: now,
          }),
        });
        return true;
      },
      completeLucky: (jobId, artifact) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job || job.purpose !== "lucky-urls") return undefined;
        const urls = luckyUrlsFromArtifact(artifact);
        const now = new Date().toISOString();
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: { ...job, status: "completed", phase: "completed", updatedAt: now },
          },
        });
        if (urls.length === 0) return undefined;
        return urls[Math.floor(Math.random() * urls.length)];
      },
      failGeneration: (jobId, error) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job) return false;
        const jobTabs = tabsForWorkspace(state, job.profileId);
        const nextTabs = jobTabs.map((tab) => {
          if (job.purpose === "lucky-urls") {
            return tab;
          }
          return tab.id === job.tabId && tab.generationJobId === jobId
            ? { ...tab, fallbackArtifactId: undefined, loadState: "error" as const }
            : tab;
        });
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: {
              ...job,
              error,
              status: "failed",
              phase: "failed",
              updatedAt: new Date().toISOString(),
            },
          },
          ...workspaceTabsPatch(state, job.profileId, nextTabs),
          browsingHistory: job.purpose === "lucky-urls"
            ? state.browsingHistory
            : updateBrowsingHistory(state.browsingHistory, jobId, {
                status: "error",
                errorMessage: error.message,
                updatedAt: new Date().toISOString(),
              }),
        });
        return true;
      },
      cancelGeneration: (jobId) => {
        const state = get();
        const job = state.generationJobs[jobId];
        if (!job || !isActiveJob(job)) return false;
        const generationJobs = cancelJobRecord(state.generationJobs, jobId);
        const jobTabs = tabsForWorkspace(state, job.profileId);
        const nextTabs = jobTabs.map((tab) =>
          tab.luckyJobId === jobId
            ? { ...tab, luckyJobId: undefined }
            : tab.generationJobId === jobId
              ? { ...tab, loadState: "idle" as const }
              : tab,
        );
        set({
          generationJobs,
          ...workspaceTabsPatch(state, job.profileId, nextTabs),
          browsingHistory: job.purpose === "lucky-urls"
            ? state.browsingHistory
            : markCancelledBrowsingHistory(state.browsingHistory, jobId),
        });
        return true;
      },
      cancelTabGeneration: (tabId) => {
        const tab = get().tabs.find((item) => item.id === tabId);
        return tab?.generationJobId ? get().cancelGeneration(tab.generationJobId) : false;
      },
      recoverInterruptedJobs: () => {
        const state = get();
        const interruptedIds = new Set(
          Object.values(state.generationJobs).filter(isActiveJob).map((job) => job.id),
        );
        if (interruptedIds.size === 0) return;
        const now = new Date().toISOString();
        const generationJobs = Object.fromEntries(
          Object.entries(state.generationJobs).map(([id, job]) => [
            id,
            interruptedIds.has(id)
              ? {
                  ...job,
                  status: "cancelled" as const,
                  phase: "cancelled" as const,
                  error: {
                    code: "cancelled" as const,
                    message: "Generation was interrupted when the session closed",
                    retryable: true,
                  },
                  updatedAt: now,
                }
              : job,
          ]),
        );
        const resetInterruptedTabs = (tabs: BrowserTab[]) => tabs.map((tab) =>
          tab.generationJobId && interruptedIds.has(tab.generationJobId)
            ? { ...tab, loadState: "idle" as const }
            : tab,
        );
        set({
          generationJobs,
          tabs: resetInterruptedTabs(state.tabs),
          profileWorkspaces: Object.fromEntries(Object.entries(state.profileWorkspaces).map(([profileId, workspace]) => [
            profileId,
            { ...workspace, tabs: resetInterruptedTabs(workspace.tabs) },
          ])),
        });
      },
      hydrateArtifacts: (artifacts) => {
        if (artifacts.length === 0) return;
        set((state) => ({
          artifacts: {
            ...state.artifacts,
            ...Object.fromEntries(artifacts.map((artifact) => [artifact.id, canonicalizeArtifactUrl(artifact)])),
          },
        }));
      },
      hydrateSiteWorlds: (siteWorlds) => {
        if (siteWorlds.length === 0) return;
        set((state) => {
          const merged = mergeHydratedSiteWorlds(state.siteWorlds, siteWorlds);
          return {
            siteWorlds: merged,
            tabs: applySiteWorldFavicons(state.tabs, merged),
            profileWorkspaces: Object.fromEntries(Object.entries(state.profileWorkspaces).map(([profileId, workspace]) => [
              profileId,
              { ...workspace, tabs: applySiteWorldFavicons(workspace.tabs, merged) },
            ])),
            browsingHistory: state.browsingHistory.map((entry) => {
              const world = activeSiteWorldForUrl(merged, entry.profileId, entry.url);
              return world ? { ...entry, favicon: world.identity.favicon } : entry;
            }),
          };
        });
      },
      upsertSiteWorld: (siteWorld) =>
        set((state) => ({ siteWorlds: { ...state.siteWorlds, [siteWorld.id]: siteWorld } })),
      upsertProviderConnection: (connection) =>
        set((state) => ({
          providerConnections: state.providerConnections.some((item) => item.id === connection.id)
            ? state.providerConnections.map((item) => (item.id === connection.id ? connection : item))
            : [...state.providerConnections, connection],
        })),
      removeProviderConnection: (id) =>
        set((state) => {
          const removed = state.providerConnections.find((item) => item.id === id);
          const removedModels = new Set(removed?.modelIds ?? []);
          return {
            providerConnections: state.providerConnections.filter((item) => item.id !== id),
            activeModelId: removedModels.has(state.activeModelId) ? MODELS[0].id : state.activeModelId,
          };
        }),
      patchGenerationSettings: (patch) =>
        set((state) => ({ generationSettings: { ...state.generationSettings, ...patch } })),
      patchStyleSettings: (patch) =>
        set((state) => ({
          generationSettings: {
            ...state.generationSettings,
            style: { ...state.generationSettings.style, ...patch },
          },
        })),
      patchImageSettings: (patch) =>
        set((state) => ({
          generationSettings: {
            ...state.generationSettings,
            images: { ...state.generationSettings.images, ...patch },
          },
        })),
      patchCapabilitySettings: (patch) =>
        set((state) => ({
          generationSettings: {
            ...state.generationSettings,
            capabilities: { ...state.generationSettings.capabilities, ...patch },
          },
        })),
      patchVoiceSettings: (patch) =>
        set((state) => ({
          generationSettings: {
            ...state.generationSettings,
            voice: { ...state.generationSettings.voice, ...patch },
          },
        })),
      patchPrivacySettings: (patch) =>
        set((state) => ({
          generationSettings: {
            ...state.generationSettings,
            privacy: { ...state.generationSettings.privacy, ...patch },
          },
        })),
      openSettings: (section = "general") => {
        const state = get();
        const existing = state.tabs.find((tab) => tab.kind === "settings");
        if (existing) {
          set({ activeTabId: existing.id });
          get().setSettingsSection(section);
          return existing.id;
        }
        const id = createId("tab");
        const location = `vibe://settings/${section}`;
        const tab = makeTab({ id, title: "Settings", location, kind: "settings", favicon: systemFavicon("settings") });
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },
      openHistory: () => {
        const state = get();
        const existing = state.tabs.find((tab) => tab.kind === "history");
        if (existing) {
          set({ activeTabId: existing.id });
          return existing.id;
        }
        const id = createId("tab");
        const tab = makeTab({ id, title: "History", location: "vibe://history", kind: "history", favicon: systemFavicon("history") });
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },
      openActivity: (jobId) => {
        const state = get();
        const location = jobId ? `vibe://activity?job=${encodeURIComponent(jobId)}` : "vibe://activity";
        const existing = state.tabs.find((tab) => tab.kind === "activity");
        if (existing) {
          const patch = { location, title: "Generation activity" };
          set({
            activeTabId: existing.id,
            tabs: state.tabs.map((tab) => tab.id === existing.id
              ? { ...tab, ...patch, history: patchCurrentHistory(tab, patch) }
              : tab),
          });
          return existing.id;
        }
        const id = createId("tab");
        const tab = makeTab({ id, title: "Generation activity", location, kind: "activity", favicon: systemFavicon("activity") });
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },
      openCapabilities: () => {
        const state = get();
        const existing = state.tabs.find((tab) => tab.kind === "capabilities");
        if (existing) {
          set({ activeTabId: existing.id });
          return existing.id;
        }
        const id = createId("tab");
        const tab = makeTab({ id, title: "Capability lab", location: "vibe://capabilities", kind: "capabilities", favicon: systemFavicon("capabilities") });
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },
      openGenerationDebug: () => {
        const state = get();
        const existing = state.tabs.find((tab) => tab.kind === "generation-debug");
        if (existing) {
          set({ activeTabId: existing.id });
          return existing.id;
        }
        const id = createId("tab");
        const tab = makeTab({ id, title: "Generation debug", location: "vibe://generation-debug", kind: "generation-debug", favicon: systemFavicon("generation-debug") });
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },
      removeBrowsingHistoryEntry: (id) =>
        set((state) => ({ browsingHistory: state.browsingHistory.filter((entry) => entry.id !== id) })),
      clearBrowsingHistory: (profileId) =>
        set((state) => ({
          browsingHistory: state.browsingHistory.filter((entry) => entry.profileId !== (profileId ?? state.activeProfileId)),
        })),
      setSettingsSection: (section) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== state.activeTabId || tab.kind !== "settings") return tab;
            const patch = { location: `vibe://settings/${section}`, title: "Settings" };
            return { ...tab, ...patch, history: patchCurrentHistory(tab, patch) };
          }),
        })),
      setModel: (activeModelId) => {
        const state = get();
        if (isSelectableModel(activeModelId, state.providerConnections, state.activeProfileId)) {
          set({ activeModelId });
        }
      },
      setProfile: (activeProfileId) => {
        const state = get();
        if (activeProfileId === state.activeProfileId || !state.profiles.some((profile) => profile.id === activeProfileId)) return;
        const currentWorkspace = snapshotWorkspace(state);
        const targetProfile = state.profiles.find((profile) => profile.id === activeProfileId)!;
        const targetWorkspace = state.profileWorkspaces[activeProfileId] ?? freshWorkspace(targetProfile.chromeSkin);
        set({
          activeProfileId,
          profileWorkspaces: { ...state.profileWorkspaces, [state.activeProfileId]: currentWorkspace },
          ...targetWorkspace,
          preferences: { ...targetWorkspace.preferences, theme: targetProfile.chromeSkin },
        });
      },
      createProfile: (input) => {
        const state = get();
        const preset = input.preset ? PROFILE_PRESETS[input.preset] : undefined;
        const id = createId("profile");
        const chromeSkin = input.chromeSkin ?? preset?.chromeSkin ?? "native";
        const name = input.name?.trim() || preset?.name || "New profile";
        const profile: BrowserProfile = {
          id,
          name,
          avatar: input.avatar?.trim().slice(0, 4) || preset?.avatar || name.slice(0, 1).toUpperCase(),
          caption: "Local browser workspace",
          chromeSkin,
          worldPrompt: {
            revision: 0,
            vibe: (input.vibe ?? preset?.vibe ?? "").slice(0, 1_000),
            prompt: (input.worldPrompt ?? preset?.prompt ?? "").slice(0, 20_000),
          },
          createdAt: new Date().toISOString(),
        };
        const targetWorkspace = settingsWorkspace(chromeSkin, "profiles");
        set({
          profiles: [...state.profiles, profile],
          profileWorkspaces: {
            ...state.profileWorkspaces,
            [state.activeProfileId]: snapshotWorkspace(state),
          },
          activeProfileId: id,
          ...targetWorkspace,
        });
        return id;
      },
      updateProfile: (id, patch) => set((state) => {
        const chromeSkin = patch.chromeSkin && themeValue(patch.chromeSkin);
        const profiles = state.profiles.map((profile) => profile.id === id
          ? {
              ...profile,
              ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
              ...(patch.avatar?.trim() ? { avatar: patch.avatar.trim().slice(0, 4) } : {}),
              ...(chromeSkin ? { chromeSkin } : {}),
            }
          : profile);
        if (!chromeSkin) return { profiles };
        if (id === state.activeProfileId) {
          return { profiles, preferences: { ...state.preferences, theme: chromeSkin } };
        }
        const workspace = state.profileWorkspaces[id];
        return {
          profiles,
          ...(workspace
            ? {
                profileWorkspaces: {
                  ...state.profileWorkspaces,
                  [id]: { ...workspace, preferences: { ...workspace.preferences, theme: chromeSkin } },
                },
              }
            : {}),
        };
      }),
      updateWorldPrompt: (input) => set((state) => ({
        profiles: state.profiles.map((profile) => profile.id === state.activeProfileId
          ? {
              ...profile,
              worldPrompt: {
                revision: profile.worldPrompt.revision + 1,
                vibe: (typeof input === "string" ? profile.worldPrompt.vibe : input.vibe).slice(0, 1_000),
                prompt: (typeof input === "string" ? input : input.prompt).slice(0, 20_000),
              },
            }
          : profile),
      })),
      deleteProfile: (id) => {
        const state = get();
        if (state.profiles.length <= 1 || !state.profiles.some((profile) => profile.id === id)) return false;
        const profiles = state.profiles.filter((profile) => profile.id !== id);
        const { [id]: _workspace, ...profileWorkspaces } = state.profileWorkspaces;
        const common = {
          profiles,
          profileWorkspaces,
          artifacts: Object.fromEntries(Object.entries(state.artifacts).filter(([, artifact]) => artifact.profileId !== id)),
          siteWorlds: Object.fromEntries(Object.entries(state.siteWorlds).filter(([, world]) => world.profileId !== id)),
          browsingHistory: state.browsingHistory.filter((entry) => entry.profileId !== id),
          generationJobs: Object.fromEntries(Object.entries(state.generationJobs).filter(([, job]) => job.profileId !== id)),
          providerConnections: state.providerConnections.filter((connection) => connection.profileId !== id),
        };
        if (id !== state.activeProfileId) {
          set(common);
          return true;
        }
        const nextProfile = profiles[0]!;
        const nextWorkspace = profileWorkspaces[nextProfile.id] ?? freshWorkspace(nextProfile.chromeSkin);
        set({ ...common, activeProfileId: nextProfile.id, ...nextWorkspace });
        return true;
      },
      startProfileFromScratch: () => {
        const state = get();
        const now = new Date().toISOString();
        const workspace = freshWorkspace(state.preferences.theme);
        const cancelledIds = Object.values(state.generationJobs)
          .filter((job) => job.profileId === state.activeProfileId && isActiveJob(job))
          .map((job) => job.id);
        const generationJobs = cancelledIds.reduce(cancelJobRecord, state.generationJobs);
        set({
          ...workspace,
          generationJobs,
          browsingHistory: cancelledIds.reduce(markCancelledBrowsingHistory, state.browsingHistory),
          siteWorlds: Object.fromEntries(Object.entries(state.siteWorlds).map(([id, world]) => [
            id,
            world.profileId === state.activeProfileId && world.state === "active"
              ? { ...world, state: "archived" as const, archivedAt: now, updatedAt: now }
              : world,
          ])),
        });
      },
      reimagine: (id) => {
        const state = get();
        const tab = state.tabs.find((item) => item.id === id);
        if (!tab?.virtualLocation || tab.archivedSiteWorldId) return undefined;
        const resolvedTarget = resolveNavigation(tab.virtualLocation.url, state.activeModelId, { baseUrl: tab.virtualLocation.url });
        if (resolvedTarget.kind !== "generated") return undefined;
        const target: NavigationTarget = { ...resolvedTarget, requiresGeneration: true };
        const navigation = prepareNavigation(state, id, target, {
          requestedValue: tab.virtualLocation.url,
          disposition: "current",
          trigger: "regenerate",
          sourceTabId: id,
          sourceArtifactId: tab.artifactId,
          identityStrategy: "reimagine",
        });
        if (!navigation.job) return undefined;
        const history = tab.history.slice(0, tab.historyIndex + 1);
        history.push(makeHistoryEntry({
          location: tab.location,
          title: tab.title,
          kind: tab.kind,
          prompt: tab.prompt,
          favicon: tab.favicon,
          virtualLocation: tab.virtualLocation,
          generationJobId: navigation.job.id,
          siteWorldId: navigation.job.siteWorldId,
        }));
        set({
          generationJobs: navigation.generationJobs,
          tabs: state.tabs.map((item) => item.id === id
            ? {
                ...item,
                generationJobId: navigation.job!.id,
                fallbackArtifactId: item.artifactId,
                siteWorldId: navigation.job!.siteWorldId,
                loadState: "loading",
                history,
                historyIndex: history.length - 1,
              }
            : item),
        });
        return navigation.job.id;
      },
      markFrameReady: (id) => set((state) => ({
        tabs: id === state.activeTabId
          ? state.tabs.map((tab) => tab.id === id ? { ...tab, hasUnseenUpdate: false } : tab)
          : state.tabs,
      })),
      restoreSiteWorld: (siteWorldId, sourceTabId) => {
        const state = get();
        const archived = state.siteWorlds[siteWorldId];
        if (!archived || archived.profileId !== state.activeProfileId || archived.state !== "archived") return false;
        const now = new Date().toISOString();
        const currentIds = new Set(Object.values(state.siteWorlds)
          .filter((world) => world.profileId === state.activeProfileId && world.origin === archived.origin && world.state === "active")
          .map((world) => world.id));
        const siteWorlds = Object.fromEntries(Object.entries(state.siteWorlds).map(([id, world]) => {
          if (id === siteWorldId) return [id, { ...world, state: "active" as const, archivedAt: undefined, updatedAt: now }];
          if (currentIds.has(id)) return [id, { ...world, state: "archived" as const, archivedAt: now, updatedAt: now }];
          return [id, world];
        }));
        const closedTabs = state.tabs.filter((tab) => tab.id !== sourceTabId && tab.siteWorldId && currentIds.has(tab.siteWorldId));
        const closedJobIds = closedTabs.flatMap((tab) => [tab.generationJobId, tab.luckyJobId].filter((id): id is string => Boolean(id)));
        const generationJobs = closedJobIds.reduce(cancelJobRecord, state.generationJobs);
        const tabs = state.tabs
          .filter((tab) => !closedTabs.some((closed) => closed.id === tab.id))
          .map((tab) => tab.id === sourceTabId ? { ...tab, siteWorldId, archivedSiteWorldId: undefined } : tab);
        set({
          siteWorlds,
          tabs,
          activeTabId: sourceTabId,
          generationJobs,
          browsingHistory: closedJobIds.reduce(markCancelledBrowsingHistory, state.browsingHistory),
        });
        return true;
      },
      setTabLayout: (tabLayout) => set((state) => ({ preferences: { ...state.preferences, tabLayout } })),
      setDensity: (density) => set((state) => ({ preferences: { ...state.preferences, density } })),
      patchPreferences: (patch) => set((state) => {
        const profile = state.profiles.find((candidate) => candidate.id === state.activeProfileId);
        return { preferences: { ...state.preferences, ...patch, theme: profile?.chromeSkin ?? state.preferences.theme } };
      }),
      patchCodex: (patch) => set((state) => ({ codex: { ...state.codex, ...patch } })),
      setCodexModels: (codexModels) =>
        set((state) => ({
          codexModels,
          codexSelection: normalizeCodexSelection(state.codexSelection, codexModels),
        })),
      patchCodexSelection: (patch) =>
        set((state) => {
          const changesModel = Object.prototype.hasOwnProperty.call(patch, "modelId")
            && patch.modelId !== state.codexSelection.modelId;
          const candidate = changesModel
            ? {
                modelId: patch.modelId,
                reasoningEffort: Object.prototype.hasOwnProperty.call(patch, "reasoningEffort")
                  ? patch.reasoningEffort
                  : undefined,
                serviceTier: Object.prototype.hasOwnProperty.call(patch, "serviceTier")
                  ? patch.serviceTier
                  : undefined,
              }
            : { ...state.codexSelection, ...patch };
          return { codexSelection: normalizeCodexSelection(candidate, state.codexModels) };
        }),
    }),
    {
      name: "vibesurfer-browser-state",
      version: 13,
      skipHydration: import.meta.env.VIBESURFER_STORYBOOK === true,
      migrate: (persistedState, version) => migrateBrowserState(persistedState, version) as BrowserState,
      partialize: (state) => ({
        tabs: state.preferences.reopenSession ? state.tabs : initialTabs,
        activeTabId: state.preferences.reopenSession ? state.activeTabId : "welcome",
        activeModelId: state.activeModelId,
        activeProfileId: state.activeProfileId,
        profiles: state.profiles,
        profileWorkspaces: {
          ...state.profileWorkspaces,
          [state.activeProfileId]: snapshotWorkspace(state),
        },
        preferences: state.preferences,
        codexSelection: state.codexSelection,
        artifacts: state.preferences.reopenSession && persistArtifactsInUiStorage() ? state.artifacts : {},
        browsingHistory: state.browsingHistory,
        generationJobs: state.preferences.reopenSession ? state.generationJobs : {},
        siteWorlds: state.preferences.reopenSession ? state.siteWorlds : {},
        providerConnections: state.providerConnections,
        generationSettings: state.generationSettings,
      }),
      onRehydrateStorage: () => (state) => state?.recoverInterruptedJobs(),
    },
  ),
);

function snapshotWorkspace(state: BrowserState): ProfileWorkspace {
  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeModelId: state.activeModelId,
    preferences: state.preferences,
    codexSelection: state.codexSelection,
    generationSettings: state.generationSettings,
  };
}

function freshWorkspace(chromeSkin: ThemeId): ProfileWorkspace {
  const tab = makeTab({
    id: createId("tab"),
    title: "New tab",
    location: "vibe://new-tab",
    kind: "new-tab",
    favicon: "✦",
  });
  return {
    tabs: [tab],
    activeTabId: tab.id,
    activeModelId: MODELS[0].id,
    preferences: { ...DEFAULT_BROWSER_PREFERENCES, theme: chromeSkin },
    codexSelection: {},
    generationSettings: structuredClone(DEFAULT_GENERATION_SETTINGS),
  };
}

function settingsWorkspace(chromeSkin: ThemeId, section: string): ProfileWorkspace {
  const workspace = freshWorkspace(chromeSkin);
  const tab = makeTab({
    id: createId("tab"),
    title: "Settings",
    location: `vibe://settings/${section}`,
    kind: "settings",
    favicon: "⚙",
  });
  return { ...workspace, tabs: [tab], activeTabId: tab.id };
}

function tabsForWorkspace(state: BrowserState, profileId: string): BrowserTab[] {
  return profileId === state.activeProfileId
    ? state.tabs
    : state.profileWorkspaces[profileId]?.tabs ?? [];
}

function workspaceTabsPatch(
  state: BrowserState,
  profileId: string,
  tabs: BrowserTab[],
): Pick<BrowserState, "tabs"> | Pick<BrowserState, "profileWorkspaces"> {
  if (profileId === state.activeProfileId) return { tabs };
  const profile = state.profiles.find((candidate) => candidate.id === profileId);
  const workspace = state.profileWorkspaces[profileId] ?? freshWorkspace(profile?.chromeSkin ?? "native");
  return {
    profileWorkspaces: {
      ...state.profileWorkspaces,
      [profileId]: { ...workspace, tabs },
    },
  };
}

interface PrepareNavigationOptions {
  requestedValue: string;
  disposition: NavigationDisposition;
  trigger: NavigationIntent["trigger"];
  intent?: Partial<NavigationIntent>;
  sourceTabId?: string;
  sourceArtifactId?: string;
  sourceHistoryEntryId?: string;
  reuseSiteWorldId?: string;
  identityStrategy?: "reuse" | "create" | "reimagine";
}

interface PreparedNavigation {
  current: Pick<BrowserTab, "artifactId" | "generationJobId" | "siteWorldId">;
  job?: GenerationJob;
  generationJobs: Record<string, GenerationJob>;
  siteWorlds: Record<string, SiteWorld>;
}

function prepareNavigation(
  state: BrowserState,
  tabId: string,
  target: NavigationTarget,
  options: PrepareNavigationOptions,
): PreparedNavigation {
  if (target.kind !== "generated" || !target.requiresGeneration) {
    const sourceTab = state.tabs.find((tab) => tab.id === options.sourceTabId);
    return {
      current: target.kind === "generated"
        ? { artifactId: sourceTab?.artifactId, generationJobId: sourceTab?.generationJobId, siteWorldId: sourceTab?.siteWorldId }
        : { artifactId: undefined, generationJobId: undefined, siteWorldId: undefined },
      generationJobs: state.generationJobs,
      siteWorlds: state.siteWorlds,
    };
  }

  const now = new Date().toISOString();
  const jobId = createId("job");
  const requestedStrategy = options.identityStrategy;
  const activeWorld = target.virtualLocation
    ? Object.values(state.siteWorlds).find((world) =>
        world.profileId === state.activeProfileId
        && world.origin === target.virtualLocation!.origin
        && world.state === "active")
    : options.reuseSiteWorldId ? state.siteWorlds[options.reuseSiteWorldId] : undefined;
  const identityStrategy = requestedStrategy === "reimagine"
    ? "reimagine"
    : activeWorld
      ? "reuse"
      : "create";
  const siteWorldId = identityStrategy === "reuse"
    ? activeWorld!.id
    : target.virtualLocation
      ? createId("site")
      : options.reuseSiteWorldId ?? siteWorldIdForPrompt(jobId);
  const generationModel = resolveGenerationModel(state.activeModelId, state.codexSelection, state.codexModels);
  const profile = state.profiles.find((candidate) => candidate.id === state.activeProfileId) ?? state.profiles[0]!;
  const intent: NavigationIntent = {
    trigger: options.trigger,
    disposition: options.disposition,
    requestedUrl: options.requestedValue,
    sourceTabId: options.sourceTabId,
    sourceArtifactId: options.sourceArtifactId,
    ...options.intent,
  };
  const job: GenerationJob = {
    id: jobId,
    profileId: state.activeProfileId,
    tabId,
    requestedUrl: options.requestedValue,
    normalizedUrl: target.virtualLocation?.url,
    siteWorldId,
    sourceArtifactId: options.sourceArtifactId,
    sourceHistoryEntryId: options.sourceHistoryEntryId,
    providerId: providerIdForModel(generationModel.modelId),
    modelId: generationModel.modelId,
    reasoningEffort: generationModel.reasoningEffort,
    serviceTier: generationModel.serviceTier,
    identityStrategy,
    browserTheme: profile.chromeSkin,
    worldPromptSnapshot: { ...(identityStrategy === "reuse" && activeWorld ? activeWorld.promptSnapshot : profile.worldPrompt) },
    generationSettingsSnapshot: structuredClone(state.generationSettings),
    motionEnabled: state.preferences.animations,
    status: "queued",
    phase: "queued",
    navigationIntent: intent,
    createdAt: now,
    updatedAt: now,
  };
  return {
    current: { artifactId: undefined, generationJobId: jobId, siteWorldId },
    job,
    generationJobs: { ...state.generationJobs, [jobId]: job },
    siteWorlds: state.siteWorlds,
  };
}

function providerIdForModel(modelId: string) {
  const separator = modelId.indexOf(":");
  return separator > 0 ? modelId.slice(0, separator) : undefined;
}

function resolveGenerationModel(
  configuredModelId: string,
  selection: CodexGenerationSelection,
  models: CodexModel[],
): { modelId: string; reasoningEffort?: string; serviceTier?: string } {
  if (configuredModelId !== "codex:chatgpt") return { modelId: configuredModelId };

  const normalized = normalizeCodexSelection(selection, models);
  const selected = findCodexModel(models, normalized.modelId);
  const actualModelId = selected?.model ?? normalized.modelId;
  if (!actualModelId) return { modelId: configuredModelId };

  return {
    modelId: actualModelId.startsWith("codex:") ? actualModelId : `codex:${actualModelId}`,
    reasoningEffort: normalized.reasoningEffort,
    serviceTier: normalized.serviceTier,
  };
}


function siteWorldIdForPrompt(jobId: string) {
  const token = jobId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-32);
  return `site-prompt-${token || stableHash(jobId)}`;
}

function loadStateForTarget(_target: NavigationTarget, job?: GenerationJob): BrowserTab["loadState"] {
  if (job) return "loading";
  return "idle";
}

function loadStateForHistory(_entry: HistoryEntry, job?: GenerationJob): BrowserTab["loadState"] {
  if (job?.status === "queued" || job?.status === "running") return "loading";
  if (job?.status === "failed") return "error";
  return "idle";
}

function activeCurrentJob(state: BrowserState, jobId: string) {
  const job = state.generationJobs[jobId];
  if (!job || !isActiveJob(job)) return undefined;
  const tab = tabsForWorkspace(state, job.profileId).find((item) => item.id === job.tabId);
  return tab?.generationJobId === jobId || tab?.luckyJobId === jobId ? job : undefined;
}

function isActiveJob(job: GenerationJob) {
  return job.status === "queued" || job.status === "running";
}

function terminalPhase(phase: GenerationPhase) {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

function cancelJobRecord(jobs: Record<string, GenerationJob>, jobId?: string) {
  if (!jobId) return jobs;
  const job = jobs[jobId];
  if (!job || !isActiveJob(job)) return jobs;
  return {
    ...jobs,
    [jobId]: {
      ...job,
      status: "cancelled" as const,
      phase: "cancelled" as const,
      error: { code: "cancelled" as const, message: "Generation was cancelled", retryable: true },
      updatedAt: new Date().toISOString(),
    },
  };
}

function patchCurrentHistory(tab: BrowserTab, patch: Partial<HistoryEntry>) {
  return tab.history.map((entry, index) => (index === tab.historyIndex ? { ...entry, ...patch } : entry));
}

function faviconValue(artifact: PageArtifact): FaviconSource | undefined {
  return artifact.favicon ?? artifact.faviconUrl;
}

function canonicalizeArtifactUrl(artifact: PageArtifact): PageArtifact {
  const url = normalizeVirtualUrl(artifact.url)?.url ?? artifact.url;
  return url === artifact.url ? artifact : { ...artifact, url };
}

function mergeArtifactIntoSiteWorld(
  siteWorlds: Record<string, SiteWorld>,
  artifact: PageArtifact,
  job: GenerationJob,
  now: string,
): Record<string, SiteWorld> {
  const virtualLocation = normalizeVirtualUrl(artifact.url);
  const existing = siteWorlds[artifact.siteWorldId];
  if (!existing && !virtualLocation) return siteWorlds;
  const patch = artifact.sitePatch;
  const frozenIdentity = existing?.identity ?? artifact.siteIdentity;
  if (!frozenIdentity) return siteWorlds;
  const identity: SiteIdentity = patch
    ? {
        ...frozenIdentity,
        establishedFacts: [...new Set([...frozenIdentity.establishedFacts, ...patch.establishedFacts])].slice(-48),
        routeHints: [...frozenIdentity.routeHints, ...patch.routeHints]
          .filter((route, index, routes) => routes.findIndex((candidate) => candidate.path === route.path) === index)
          .slice(-60),
      }
    : frozenIdentity;
  const base: SiteWorld = existing ?? {
    id: artifact.siteWorldId,
    profileId: job.profileId,
    origin: virtualLocation!.origin,
    state: "active",
    promptSnapshot: artifact.worldPromptSnapshot ?? job.worldPromptSnapshot,
    identity,
    pageSummaries: [],
    name: identity.name,
    purpose: identity.purpose,
    audience: identity.audience,
    visualLanguage: {
      palette: identity.visualLanguage.palette,
      typography: identity.visualLanguage.typography,
      layout: identity.layoutSystem,
      tone: identity.visualLanguage.mood ?? "",
    },
    informationArchitecture: identity.routeHints,
    establishedFacts: identity.establishedFacts,
    visitedPageSummaries: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  const summaries = base.visitedPageSummaries.filter((summary) => summary.artifactId !== artifact.id);
  summaries.push({
    artifactId: artifact.id,
    url: artifact.url,
    title: artifact.title,
    purpose: artifact.summary,
    factsIntroduced: artifact.siteAdditions?.facts ?? patch?.establishedFacts ?? [],
    outboundRoutes: (artifact.siteAdditions?.routes ?? patch?.routeHints ?? []).map((route) => route.path),
  });
  const next: SiteWorld = {
    ...base,
    id: artifact.siteWorldId,
    profileId: job.profileId,
    state: "active",
    identity,
    name: identity.name,
    purpose: identity.purpose,
    audience: identity.audience,
    visualLanguage: {
      palette: identity.visualLanguage.palette,
      typography: identity.visualLanguage.typography,
      layout: identity.layoutSystem,
      tone: identity.visualLanguage.mood ?? base.visualLanguage.tone,
    },
    informationArchitecture: identity.routeHints,
    establishedFacts: identity.establishedFacts,
    visitedPageSummaries: summaries.slice(-24),
    pageSummaries: summaries.slice(-100),
    revision: base.revision + 1,
    updatedAt: now,
  };
  return { ...siteWorlds, [artifact.siteWorldId]: next };
}

function mergeHydratedSiteWorlds(
  current: Record<string, SiteWorld>,
  hydrated: SiteWorld[],
): Record<string, SiteWorld> {
  let merged = { ...current };
  for (const siteWorld of hydrated) {
    const existing = merged[siteWorld.id];
    if (existing && (
      existing.revision > siteWorld.revision ||
      (existing.revision === siteWorld.revision && existing.updatedAt > siteWorld.updatedAt)
    )) {
      continue;
    }
    merged[siteWorld.id] = siteWorld;
  }
  return merged;
}

function applySiteWorldFavicons(tabs: BrowserTab[], siteWorlds: Record<string, SiteWorld>): BrowserTab[] {
  return tabs.map((tab) => {
    const history = tab.history.map((entry) => {
      const world = siteWorldForEntry(siteWorlds, entry.siteWorldId, entry.virtualLocation?.origin, entry.location);
      return world ? { ...entry, favicon: world.identity.favicon } : entry;
    });
    const current = history[tab.historyIndex];
    const world = siteWorldForEntry(
      siteWorlds,
      tab.siteWorldId ?? current?.siteWorldId,
      tab.virtualLocation?.origin ?? current?.virtualLocation?.origin,
      tab.location,
    );
    return world ? { ...tab, favicon: world.identity.favicon, history } : { ...tab, history };
  });
}

function siteWorldForEntry(
  siteWorlds: Record<string, SiteWorld>,
  siteWorldId: string | undefined,
  origin: string | undefined,
  url: string,
): SiteWorld | undefined {
  if (siteWorldId && siteWorlds[siteWorldId]) return siteWorlds[siteWorldId];
  const resolvedOrigin = origin ?? normalizeVirtualUrl(url)?.origin;
  if (!resolvedOrigin) return undefined;
  return Object.values(siteWorlds).find((world) => world.state === "active" && world.origin === resolvedOrigin);
}

function activeSiteWorldForUrl(
  siteWorlds: Record<string, SiteWorld>,
  profileId: string,
  url: string,
): SiteWorld | undefined {
  const origin = normalizeVirtualUrl(url)?.origin;
  return origin
    ? Object.values(siteWorlds).find((world) => world.profileId === profileId && world.state === "active" && world.origin === origin)
    : undefined;
}

function appendBrowsingHistory(
  entries: BrowsingHistoryEntry[],
  job: GenerationJob,
  fallbackTitle: string,
): BrowsingHistoryEntry[] {
  if (job.purpose === "lucky-urls") return entries;
  const now = job.createdAt;
  const entry: BrowsingHistoryEntry = {
    id: createId("visit"),
    profileId: job.profileId,
    url: job.normalizedUrl ?? job.requestedUrl,
    title: fallbackTitle,
    status: "loading",
    generationJobId: job.id,
    openedAt: now,
    updatedAt: now,
  };
  return [entry, ...entries].slice(0, 5_000);
}

function appendCachedHistoryEntry(
  entries: BrowsingHistoryEntry[],
  profileId: string,
  url: string,
  title: string,
  artifactId: string,
): BrowsingHistoryEntry[] {
  const now = new Date().toISOString();
  const entry: BrowsingHistoryEntry = {
    id: createId("visit"),
    profileId,
    url,
    title,
    status: "cached",
    artifactId,
    openedAt: now,
    updatedAt: now,
  };
  return [entry, ...entries].slice(0, 5_000);
}

function updateBrowsingHistory(
  entries: BrowsingHistoryEntry[],
  jobId: string,
  patch: Partial<BrowsingHistoryEntry>,
): BrowsingHistoryEntry[] {
  return entries.map((entry) => entry.generationJobId === jobId ? { ...entry, ...patch } : entry);
}

function markCancelledBrowsingHistory(
  entries: BrowsingHistoryEntry[],
  jobId: string | undefined,
): BrowsingHistoryEntry[] {
  if (!jobId) return entries;
  const now = new Date().toISOString();
  return entries.map((entry) => entry.generationJobId === jobId && entry.status === "loading"
    ? { ...entry, status: "error" as const, errorMessage: "Cancelled", updatedAt: now }
    : entry);
}

function luckyUrlsFromArtifact(artifact: PageArtifact): string[] {
  const urls = new Set<string>();
  for (const route of artifact.sitePatch?.routeHints ?? []) {
    try {
      const url = new URL(route.path, artifact.url);
      if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.href);
    } catch {
      // Ignore malformed model suggestions; a Lucky result must be navigable.
    }
  }
  return [...urls].slice(0, 10);
}

function makeHistoryEntry(
  input: Omit<HistoryEntry, "id">,
  patch: Partial<Omit<HistoryEntry, "id">> = {},
): HistoryEntry {
  const merged = { ...input, ...patch };
  return {
    id: createId("history"),
    location: merged.location,
    title: merged.title,
    kind: merged.kind,
    prompt: merged.prompt,
    favicon: merged.favicon,
    virtualLocation: merged.virtualLocation,
    artifactId: merged.artifactId,
    generationJobId: merged.generationJobId,
    siteWorldId: merged.siteWorldId,
    archivedSiteWorldId: merged.archivedSiteWorldId,
  };
}

export function makeTab(
  input: Partial<BrowserTab> & Pick<BrowserTab, "id" | "title" | "location" | "kind">,
): BrowserTab {
  const entry = makeHistoryEntry({
    location: input.location,
    title: input.title,
    kind: input.kind,
    prompt: input.prompt,
    favicon: input.favicon,
    virtualLocation: input.virtualLocation,
    artifactId: input.artifactId,
    generationJobId: input.generationJobId,
    siteWorldId: input.siteWorldId,
    archivedSiteWorldId: input.archivedSiteWorldId,
  });
  return {
    id: input.id,
    title: input.title,
    location: input.location,
    kind: input.kind,
    prompt: input.prompt,
    favicon: input.favicon,
    virtualLocation: input.virtualLocation,
    artifactId: input.artifactId,
    fallbackArtifactId: input.fallbackArtifactId,
    generationJobId: input.generationJobId,
    siteWorldId: input.siteWorldId,
    archivedSiteWorldId: input.archivedSiteWorldId,
    luckyJobId: input.luckyJobId,
    opener: input.opener,
    loadState: input.loadState ?? "idle",
    reloadKey: input.reloadKey ?? 0,
    history: input.history ?? [entry],
    historyIndex: input.historyIndex ?? 0,
    generatedWith: input.generatedWith,
    hasUnseenUpdate: input.hasUnseenUpdate ?? false,
  };
}

export function migrateBrowserState(persistedState: unknown, version = 0): Partial<BrowserState> {
  const source = isRecord(persistedState) ? persistedState : {};
  const persistedGenerationJobs = recordOf<GenerationJob>(source.generationJobs);
  const rawTabs = Array.isArray(source.tabs) ? source.tabs : [];
  const migratedTabs = rawTabs.length > 0
    ? rawTabs.map((tab, index) => migrateTab(tab, index, persistedGenerationJobs))
    : initialTabs.map((tab) => ({ ...tab, history: tab.history.map((entry) => ({ ...entry })) }));
  const tabIdRemap = new Map<string, string>();
  rawTabs.forEach((tab, index) => {
    if (!isRecord(tab)) return;
    const oldId = optionalString(tab.id);
    const newId = migratedTabs[index]?.id;
    if (oldId && newId && oldId !== newId) tabIdRemap.set(oldId, newId);
  });
  const tabsWithOpeners = migratedTabs.map((tab) => ({
    ...tab,
    opener: tab.opener
      ? { ...tab.opener, tabId: tabIdRemap.get(tab.opener.tabId) ?? tab.opener.tabId }
      : undefined,
  }));
  const preferences = {
    ...DEFAULT_BROWSER_PREFERENCES,
    ...(isRecord(source.preferences) ? source.preferences : {}),
  } as BrowserPreferences;
  let generationSettings = migrateGenerationSettings(source.generationSettings, version);
  const legacyGenerationSettings = isRecord(source.generationSettings) ? source.generationSettings : {};
  const legacyWorldPrompt = stringValue(legacyGenerationSettings.customInstruction).slice(0, 20_000);
  const profiles: BrowserProfile[] = Array.isArray(source.profiles)
    ? source.profiles.filter(isRecord).flatMap((profile) => {
        const id = nonEmptyString(profile.id);
        if (!id) return [];
        const snapshot = isRecord(profile.worldPrompt) ? profile.worldPrompt : {};
        return [{
          id,
          name: nonEmptyString(profile.name) ?? "Profile",
          avatar: nonEmptyString(profile.avatar)?.slice(0, 4) ?? "P",
          caption: nonEmptyString(profile.caption) ?? "Local browser workspace",
          chromeSkin: themeValue(profile.chromeSkin) ?? preferences.theme,
          worldPrompt: {
            revision: Math.max(0, Math.round(numberValue(snapshot.revision) ?? 0)),
            vibe: stringValue(snapshot.vibe).slice(0, 1_000),
            prompt: stringValue(snapshot.prompt).slice(0, 20_000),
          },
          createdAt: nonEmptyString(profile.createdAt) ?? new Date().toISOString(),
        }];
      })
    : [];
  if (profiles.length === 0) {
    profiles.push({
      ...PROFILES[0],
      chromeSkin: preferences.theme,
      worldPrompt: { revision: legacyWorldPrompt ? 1 : 0, vibe: "", prompt: legacyWorldPrompt },
    });
  }
  const requestedProfileId = stringValue(source.activeProfileId);
  const activeProfileId = requestedProfileId && profiles.some((profile) => profile.id === requestedProfileId)
    ? requestedProfileId
    : profiles[0]!.id;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)!;
  preferences.theme = activeProfile.chromeSkin;
  const generationJobs = Object.fromEntries(
    Object.entries(persistedGenerationJobs).map(([id, job]) => [
      id,
      {
        ...job,
        profileId: job.profileId ?? activeProfileId,
        tabId: tabIdRemap.get(job.tabId) ?? job.tabId,
        normalizedUrl: job.normalizedUrl
          ? normalizeVirtualUrl(job.normalizedUrl)?.url ?? job.normalizedUrl
          : undefined,
        identityStrategy: job.identityStrategy ?? (job.siteWorldId ? "reuse" : "create"),
        browserTheme: job.browserTheme ?? activeProfile.chromeSkin,
        motionEnabled: booleanValue(job.motionEnabled) ?? preferences.animations,
        worldPromptSnapshot: normalizePromptSnapshot(job.worldPromptSnapshot, activeProfile.worldPrompt),
        generationSettingsSnapshot: job.generationSettingsSnapshot ?? generationSettings,
      },
    ]),
  );
  const artifacts = Object.fromEntries(
    Object.entries(recordOf<PageArtifact>(source.artifacts)).map(([id, artifact]) => [
      id,
      canonicalizeArtifactUrl({ ...artifact, profileId: artifact.profileId ?? activeProfileId }),
    ]),
  );
  const browsingHistory = Array.isArray(source.browsingHistory)
    ? source.browsingHistory.filter(isRecord).flatMap((entry) => migrateBrowsingHistoryEntry(entry, activeProfileId))
    : [];
  const siteWorlds = Object.fromEntries(Object.entries(recordOf<unknown>(source.siteWorlds)).flatMap(([id, world]) => {
    const migrated = migrateSiteWorld(world, id, activeProfileId, activeProfile.worldPrompt);
    return migrated ? [[id, migrated]] : [];
  }));
  const providerConnections = Array.isArray(source.providerConnections)
    ? source.providerConnections
        .filter(isRecord)
        .map((connection) => ({ ...connection, profileId: optionalString(connection.profileId) ?? activeProfileId })) as ProviderConnection[]
    : [];
  const requestedActiveModelId = stringValue(source.activeModelId) || MODELS[0].id;
  const activeModelId = isSelectableModel(requestedActiveModelId, providerConnections, activeProfileId)
    ? requestedActiveModelId
    : MODELS[0].id;
  const tabs = tabsWithOpeners.map((tab) => ({
    ...tab,
    generatedWith: tab.generatedWith && !tab.artifactId
      && !isSelectableModel(tab.generatedWith, providerConnections, activeProfileId)
      ? MODELS[0].id
      : tab.generatedWith,
  }));
  const requestedActiveTabId = stringValue(source.activeTabId);
  const remappedActiveTabId = tabIdRemap.get(requestedActiveTabId) ?? requestedActiveTabId;
  const activeTabId = tabs.some((tab) => tab.id === remappedActiveTabId) ? remappedActiveTabId : tabs[0].id;
  const codexSelection = migrateCodexSelection(source.codexSelection);
  const profileWorkspaces = Object.fromEntries(Object.entries(recordOf<unknown>(source.profileWorkspaces)).flatMap(([profileId, workspace]) => {
    if (profileId === activeProfileId || !profiles.some((profile) => profile.id === profileId)) return [];
    const migrated = migrateProfileWorkspace(workspace, profiles.find((profile) => profile.id === profileId)!);
    return migrated ? [[profileId, migrated]] : [];
  }));

  return {
    profiles,
    profileWorkspaces,
    tabs,
    activeTabId,
    activeModelId,
    activeProfileId,
    preferences,
    codexModels: [],
    codexSelection,
    artifacts,
    browsingHistory,
    generationJobs,
    siteWorlds,
    providerConnections,
    generationSettings,
  };
}

function migrateProfileWorkspace(value: unknown, profile: BrowserProfile): ProfileWorkspace | undefined {
  if (!isRecord(value)) return undefined;
  const tabs = Array.isArray(value.tabs) && value.tabs.length > 0
    ? value.tabs.map((tab, index) => migrateTab(tab, index, {}))
    : freshWorkspace(profile.chromeSkin).tabs;
  const activeTabId = nonEmptyString(value.activeTabId);
  return {
    tabs,
    activeTabId: activeTabId && tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]!.id,
    activeModelId: nonEmptyString(value.activeModelId) ?? MODELS[0].id,
    preferences: {
      ...DEFAULT_BROWSER_PREFERENCES,
      ...(isRecord(value.preferences) ? value.preferences : {}),
      theme: profile.chromeSkin,
    } as BrowserPreferences,
    codexSelection: migrateCodexSelection(value.codexSelection),
    generationSettings: migrateGenerationSettings(value.generationSettings, 13),
  };
}

function normalizePromptSnapshot(value: unknown, fallback: ProfilePromptSnapshot): ProfilePromptSnapshot {
  const snapshot = isRecord(value) ? value : {};
  const hasVibe = Object.prototype.hasOwnProperty.call(snapshot, "vibe");
  const hasPrompt = Object.prototype.hasOwnProperty.call(snapshot, "prompt");
  return {
    revision: Math.max(0, Math.round(numberValue(snapshot.revision) ?? fallback.revision)),
    vibe: (hasVibe ? stringValue(snapshot.vibe) : fallback.vibe).slice(0, 1_000),
    prompt: (hasPrompt ? stringValue(snapshot.prompt) : fallback.prompt).slice(0, 20_000),
  };
}

function migrateSiteWorld(
  value: unknown,
  fallbackId: string,
  fallbackProfileId: string,
  fallbackPrompt: BrowserProfile["worldPrompt"],
): SiteWorld | undefined {
  if (!isRecord(value)) return undefined;
  const origin = optionalString(value.origin);
  if (!origin) return undefined;
  const visual = isRecord(value.visualLanguage) ? value.visualLanguage : {};
  const rawIdentity = isRecord(value.identity) ? value.identity : {};
  const identityVisual = isRecord(rawIdentity.visualLanguage) ? rawIdentity.visualLanguage : visual;
  const palette = Array.isArray(identityVisual.palette)
    ? identityVisual.palette.filter((color): color is string => typeof color === "string").slice(0, 8)
    : [];
  const routes = (Array.isArray(rawIdentity.routeHints)
    ? rawIdentity.routeHints
    : Array.isArray(value.informationArchitecture) ? value.informationArchitecture : [])
    .filter(isRecord)
    .flatMap((route) => nonEmptyString(route.path) && nonEmptyString(route.label)
      ? [{ path: nonEmptyString(route.path)!, label: nonEmptyString(route.label)!, purpose: optionalString(route.purpose) }]
      : []);
  const prompt = isRecord(value.promptSnapshot) ? value.promptSnapshot : {};
  const name = nonEmptyString(rawIdentity.name ?? value.name) ?? readableHost(origin);
  const purpose = stringValue(rawIdentity.purpose ?? value.purpose);
  const audience = stringValue(rawIdentity.audience ?? value.audience);
  const favicon = faviconSourceValue(rawIdentity.favicon);
  const identityFavicon = typeof favicon === "object" && favicon.kind === "glyph"
    ? favicon
    : deterministicGlyphFavicon(origin, name.slice(0, 1).toUpperCase() || "•");
  const rolePalette = isRecord(rawIdentity.palette) ? rawIdentity.palette : {};
  const fonts = isRecord(rawIdentity.fonts) ? rawIdentity.fonts : {};
  const establishedFacts = (Array.isArray(rawIdentity.establishedFacts)
    ? rawIdentity.establishedFacts
    : Array.isArray(value.establishedFacts) ? value.establishedFacts : [])
    .filter((fact): fact is string => typeof fact === "string");
  const identity: SiteWorld["identity"] = {
    classification: rawIdentity.classification === "recognizable" ? "recognizable" : "original",
    locale: nonEmptyString(rawIdentity.locale) ?? "en",
    era: nonEmptyString(rawIdentity.era) ?? "contemporary",
    name,
    purpose,
    audience,
    visualLanguage: {
      palette: palette.length >= 2 ? palette : ["#0f172a", "#2563eb", "#f8fafc"],
      typography: nonEmptyString(identityVisual.typography) ?? "Arimo Variable",
      density: identityVisual.density === "compact" || identityVisual.density === "spacious" ? identityVisual.density : "comfortable",
      radius: identityVisual.radius === "none" || identityVisual.radius === "subtle" || identityVisual.radius === "pill" ? identityVisual.radius : "rounded",
      mood: nonEmptyString(identityVisual.mood ?? identityVisual.tone) ?? "clear",
    },
    establishedFacts,
    routeHints: routes,
    palette: {
      background: nonEmptyString(rolePalette.background) ?? palette[2] ?? "#f8fafc",
      surface: nonEmptyString(rolePalette.surface) ?? "#ffffff",
      text: nonEmptyString(rolePalette.text) ?? palette[0] ?? "#0f172a",
      mutedText: nonEmptyString(rolePalette.mutedText) ?? "#64748b",
      accent: nonEmptyString(rolePalette.accent) ?? palette[1] ?? "#2563eb",
      accentText: nonEmptyString(rolePalette.accentText) ?? "#ffffff",
      border: nonEmptyString(rolePalette.border) ?? "#cbd5e1",
    },
    fonts: {
      body: nonEmptyString(fonts.body) ?? "Arimo Variable",
      heading: nonEmptyString(fonts.heading) ?? "Arimo Variable",
      ...(nonEmptyString(fonts.mono) ? { mono: nonEmptyString(fonts.mono) } : {}),
    },
    layoutSystem: nonEmptyString(rawIdentity.layoutSystem) ?? nonEmptyString(visual.layout) ?? "Page-specific layout",
    favicon: identityFavicon,
  };
  const pageSummaries = (Array.isArray(value.pageSummaries)
    ? value.pageSummaries
    : Array.isArray(value.visitedPageSummaries) ? value.visitedPageSummaries : []) as PageSummary[];
  const createdAt = optionalString(value.createdAt) ?? new Date().toISOString();
  const updatedAt = optionalString(value.updatedAt) ?? createdAt;
  return {
    id: nonEmptyString(value.id) ?? fallbackId,
    profileId: nonEmptyString(value.profileId) ?? fallbackProfileId,
    origin,
    state: value.state === "archived" ? "archived" : "active",
    promptSnapshot: normalizePromptSnapshot(prompt, fallbackPrompt),
    identity,
    pageSummaries,
    archivedAt: optionalString(value.archivedAt),
    name: identity.name,
    purpose: identity.purpose,
    audience: identity.audience,
    visualLanguage: {
      palette: identity.visualLanguage.palette,
      typography: identity.visualLanguage.typography,
      layout: identity.layoutSystem,
      tone: identity.visualLanguage.mood ?? "",
    },
    informationArchitecture: identity.routeHints,
    establishedFacts: identity.establishedFacts,
    visitedPageSummaries: pageSummaries,
    revision: Math.max(0, Math.round(numberValue(value.revision) ?? 0)),
    createdAt,
    updatedAt,
  };
}

function migrateTab(value: unknown, index: number, generationJobs: Record<string, GenerationJob>): BrowserTab {
  const source = isRecord(value) ? value : {};
  const id = recoverTabId(source, index, generationJobs);
  const persistedLocation = stringValue(source.location) || "vibe://new-tab";
  const location = normalizeVirtualUrl(persistedLocation)?.url ?? persistedLocation;
  const kind = tabKind(source.kind, location);
  const title = stringValue(source.title) || (kind === "new-tab" ? "New tab" : readableHost(location));
  const rawHistory = Array.isArray(source.history) ? source.history : [];
  const history = rawHistory.length > 0
    ? rawHistory.map((entry, historyIndex) => migrateHistoryEntry(entry, id, historyIndex, { location, title, kind }))
    : [migrateHistoryEntry(source, id, 0, { location, title, kind })];
  const requestedIndex = numberValue(source.historyIndex);
  const historyIndex = Math.max(0, Math.min(history.length - 1, requestedIndex ?? history.length - 1));
  const current = history[historyIndex];
  const virtualLocation = virtualLocationValue(source.virtualLocation) ?? normalizeVirtualUrl(location);
  return {
    id,
    title,
    location,
    favicon: migrateSystemFavicon(kind, faviconSourceValue(source.favicon)),
    kind,
    prompt: optionalString(source.prompt),
    virtualLocation,
    artifactId: optionalString(source.artifactId) ?? current.artifactId,
    fallbackArtifactId: optionalString(source.fallbackArtifactId),
    generationJobId: optionalString(source.generationJobId) ?? current.generationJobId,
    siteWorldId: optionalString(source.siteWorldId) ?? current.siteWorldId,
    archivedSiteWorldId: optionalString(source.archivedSiteWorldId) ?? current.archivedSiteWorldId,
    luckyJobId: optionalString(source.luckyJobId),
    opener: openerValue(source.opener),
    loadState: loadStateValue(source.loadState),
    reloadKey: numberValue(source.reloadKey) ?? 0,
    history,
    historyIndex,
    generatedWith: optionalString(source.generatedWith),
    hasUnseenUpdate: booleanValue(source.hasUnseenUpdate) ?? false,
  };
}

function recoverTabId(source: Record<string, unknown>, index: number, generationJobs: Record<string, GenerationJob>) {
  const persistedId = stringValue(source.id) || `restored-tab-${index}`;
  if (!persistedId.startsWith("history-")) return persistedId;
  const jobIds = [
    optionalString(source.generationJobId),
    ...(Array.isArray(source.history)
      ? source.history.flatMap((entry) => isRecord(entry) ? [optionalString(entry.generationJobId)] : [])
      : []),
  ];
  for (const jobId of jobIds) {
    if (!jobId) continue;
    const originalTabId = generationJobs[jobId]?.tabId;
    if (originalTabId && !originalTabId.startsWith("history-")) return originalTabId;
  }
  return `restored-tab-${index}-${stableHash(persistedId)}`;
}

function migrateHistoryEntry(
  value: unknown,
  tabId: string,
  index: number,
  fallback: Pick<HistoryEntry, "location" | "title" | "kind">,
): HistoryEntry {
  const source = isRecord(value) ? value : {};
  const persistedLocation = stringValue(source.location) || fallback.location;
  const location = normalizeVirtualUrl(persistedLocation)?.url ?? persistedLocation;
  const kind = tabKind(source.kind, location) || fallback.kind;
  return {
    id: stringValue(source.id) || `${tabId}:history:${index}`,
    location,
    title: stringValue(source.title) || fallback.title,
    kind,
    prompt: optionalString(source.prompt),
    favicon: faviconSourceValue(source.favicon),
    virtualLocation: virtualLocationValue(source.virtualLocation) ?? normalizeVirtualUrl(location),
    artifactId: optionalString(source.artifactId),
    generationJobId: optionalString(source.generationJobId),
    siteWorldId: optionalString(source.siteWorldId),
    archivedSiteWorldId: optionalString(source.archivedSiteWorldId),
  };
}

function migrateBrowsingHistoryEntry(
  source: Record<string, unknown>,
  fallbackProfileId: string,
): BrowsingHistoryEntry[] {
  const url = optionalString(source.url);
  const openedAt = optionalString(source.openedAt);
  if (!url || !openedAt) return [];
  const canonicalUrl = normalizeVirtualUrl(url)?.url ?? url;
  const status = source.status === "loading" || source.status === "cached" || source.status === "error"
    ? source.status
    : "completed";
  return [{
    id: optionalString(source.id) ?? createId("visit"),
    profileId: optionalString(source.profileId) ?? fallbackProfileId,
    url: canonicalUrl,
    title: optionalString(source.title) ?? readableHost(canonicalUrl),
    status,
    openedAt,
    updatedAt: optionalString(source.updatedAt) ?? openedAt,
    favicon: faviconSourceValue(source.favicon),
    artifactId: optionalString(source.artifactId),
    generationJobId: optionalString(source.generationJobId),
    errorMessage: optionalString(source.errorMessage),
  }];
}

export function migrateGenerationSettings(value: unknown, version: number): GenerationSettings {
  const source = isRecord(value) ? value : {};
  const style = isRecord(source.style) ? source.style : {};
  const images = isRecord(source.images) ? source.images : {};
  const capabilities = isRecord(source.capabilities) ? source.capabilities : {};
  const voice = isRecord(source.voice) ? source.voice : {};
  const privacy = isRecord(source.privacy) ? source.privacy : {};
  const imageProvider = images.provider === "off" ? "off" : "tag-placeholder";
  const imagesEnabled = (booleanValue(images.enabled) ?? DEFAULT_GENERATION_SETTINGS.images.enabled)
    && imageProvider !== "off";
  const audioSpeechEnabled = booleanValue(capabilities.audioSpeechEnabled)
    ?? DEFAULT_GENERATION_SETTINGS.capabilities.audioSpeechEnabled;
  return {
    promptVersion: DEFAULT_GENERATION_SETTINGS.promptVersion,
    strategy: source.strategy === "turbo" ? "turbo" : "full",
    maxOutputTokens: clampInteger(
      numberValue(source.maxOutputTokens) ?? DEFAULT_GENERATION_SETTINGS.maxOutputTokens,
      512,
      100_000,
    ),
    reuseCachedPages: booleanValue(source.reuseCachedPages) ?? DEFAULT_GENERATION_SETTINGS.reuseCachedPages,
    dynamicMode: source.dynamicMode === "off" || source.dynamicMode === "always" ? source.dynamicMode : "active",
    style: {
      tailwindEnabled: booleanValue(style.tailwindEnabled) ?? DEFAULT_GENERATION_SETTINGS.style.tailwindEnabled,
      tailwindVersion: DEFAULT_GENERATION_SETTINGS.style.tailwindVersion,
      allowArbitraryUtilities: true,
      customCssInstruction: stringValue(style.customCssInstruction).slice(0, 2_000),
      allowGeneratedScripts: booleanValue(style.allowGeneratedScripts)
        ?? DEFAULT_GENERATION_SETTINGS.style.allowGeneratedScripts,
      progressiveRendering: true,
    },
    images: {
      enabled: imagesEnabled,
      provider: imagesEnabled ? imageProvider : "off",
      safeContent: booleanValue(images.safeContent) ?? true,
      allowExternalRequests: imagesEnabled
        && imageProvider === "tag-placeholder"
        && (version < 6
          ? true
          : booleanValue(images.allowExternalRequests) ?? DEFAULT_GENERATION_SETTINGS.images.allowExternalRequests),
    },
    capabilities: {
      iconsEnabled: booleanValue(capabilities.iconsEnabled)
        ?? DEFAULT_GENERATION_SETTINGS.capabilities.iconsEnabled,
      audioSpeechEnabled,
      externalMediaEnabled: booleanValue(capabilities.externalMediaEnabled)
        ?? DEFAULT_GENERATION_SETTINGS.capabilities.externalMediaEnabled,
      experimentalEnabled: booleanValue(capabilities.experimentalEnabled)
        ?? DEFAULT_GENERATION_SETTINGS.capabilities.experimentalEnabled,
      enabled: Object.fromEntries(USER_CONFIGURABLE_CAPABILITY_IDS.map((id) => [
        id,
        booleanValue(isRecord(capabilities.enabled) ? capabilities.enabled[id] : undefined)
          ?? ((id === "speech" || id === "sound") ? audioSpeechEnabled : DEFAULT_GENERATION_SETTINGS.capabilities.enabled[id])
          ?? true,
      ])),
    },
    voice: {
      engine: voice.engine === "system" || voice.engine === "cloud" ? voice.engine : "local",
      provider: voice.provider === "elevenlabs" || voice.provider === "deepgram" ? voice.provider : "openai",
      ...(optionalString(voice.mediaConnectionId) ? { mediaConnectionId: optionalString(voice.mediaConnectionId) } : {}),
      model: optionalString(voice.model) ?? DEFAULT_GENERATION_SETTINGS.voice.model,
      voice: optionalString(voice.voice) ?? DEFAULT_GENERATION_SETTINGS.voice.voice,
      availableVoiceIds: Array.isArray(voice.availableVoiceIds)
        ? voice.availableVoiceIds.flatMap((id) => typeof id === "string" && id.trim() ? [id.trim().slice(0, 120)] : []).slice(0, 100)
        : [optionalString(voice.voice) ?? DEFAULT_GENERATION_SETTINGS.voice.voice],
      speed: Math.min(1.5, Math.max(0.6, numberValue(voice.speed) ?? DEFAULT_GENERATION_SETTINGS.voice.speed)),
      musicMode: voice.musicMode === "off" || voice.musicMode === "generate-if-requested"
        ? voice.musicMode
        : booleanValue(voice.musicEnabled) === false ? "off" : "built-in",
      musicVolume: Math.min(1, Math.max(0, numberValue(voice.musicVolume) ?? DEFAULT_GENERATION_SETTINGS.voice.musicVolume)),
    },
    privacy: {
      includeNavigationHistory: booleanValue(privacy.includeNavigationHistory)
        ?? DEFAULT_GENERATION_SETTINGS.privacy.includeNavigationHistory,
      sameSiteSummariesOnly: true,
      diagnosticsEnabled: booleanValue(privacy.diagnosticsEnabled)
        ?? DEFAULT_GENERATION_SETTINGS.privacy.diagnosticsEnabled,
    },
  };
}

function migrateCodexSelection(value: unknown): CodexGenerationSelection {
  if (!isRecord(value)) return DEFAULT_CODEX_SELECTION;
  return {
    modelId: nonEmptyString(value.modelId),
    reasoningEffort: nonEmptyString(value.reasoningEffort),
    serviceTier: nonEmptyString(value.serviceTier),
  };
}

function normalizeCodexSelection(
  value: CodexGenerationSelection,
  models: CodexModel[],
): CodexGenerationSelection {
  const persisted = {
    modelId: nonEmptyString(value.modelId),
    reasoningEffort: nonEmptyString(value.reasoningEffort),
    serviceTier: nonEmptyString(value.serviceTier),
  };
  if (models.length === 0) return persisted;

  const model = findCodexModel(models, persisted.modelId)
    ?? models.find((candidate) => candidate.isDefault)
    ?? models[0];
  const supportedEfforts = new Set(model.supportedReasoningEfforts.map((option) => option.reasoningEffort));
  const reasoningEffort = persisted.reasoningEffort && supportedEfforts.has(persisted.reasoningEffort)
    ? persisted.reasoningEffort
    : supportedEfforts.has(model.defaultReasoningEffort ?? "")
      ? model.defaultReasoningEffort
      : undefined;
  const supportedTiers = new Set(model.serviceTiers.map((tier) => tier.id));
  const serviceTier = persisted.serviceTier && supportedTiers.has(persisted.serviceTier)
    ? persisted.serviceTier
    : undefined;

  return {
    modelId: model.id,
    reasoningEffort,
    serviceTier,
  };
}

function findCodexModel(models: CodexModel[], modelId?: string) {
  return modelId
    ? models.find((candidate) => candidate.id === modelId || candidate.model === modelId)
    : undefined;
}

function virtualLocationValue(value: unknown) {
  if (!isRecord(value)) return undefined;
  const url = optionalString(value.url);
  return url ? normalizeVirtualUrl(url) : undefined;
}

function openerValue(value: unknown): TabOpenerContext | undefined {
  if (!isRecord(value)) return undefined;
  const tabId = optionalString(value.tabId);
  return tabId ? { tabId, artifactId: optionalString(value.artifactId) } : undefined;
}

function tabKind(value: unknown, location: string): TabKind {
  if (value === "new-tab" || value === "remote" || value === "generated" || value === "settings" || value === "history" || value === "activity" || value === "capabilities" || value === "generation-debug") return value;
  if (location === "vibe://new-tab") return "new-tab";
  if (location === "vibe://history") return "history";
  if (location.startsWith("vibe://settings")) return "settings";
  if (location.startsWith("vibe://activity")) return "activity";
  if (location === "vibe://capabilities") return "capabilities";
  if (location === "vibe://generation-debug") return "generation-debug";
  if (location.startsWith("vibe://generated")) return "generated";
  return normalizeVirtualUrl(location) ? "remote" : "generated";
}

function migrateSystemFavicon(kind: TabKind, favicon: FaviconSource | undefined): FaviconSource | undefined {
  if (kind === "new-tab" && (!favicon || favicon === "✦")) return systemFavicon("new-tab");
  if (kind === "settings" && (!favicon || favicon === "⚙")) return systemFavicon("settings");
  if (kind === "history" && (!favicon || favicon === "◷")) return systemFavicon("history");
  if (kind === "activity") return systemFavicon("activity");
  if (kind === "capabilities") return systemFavicon("capabilities");
  if (kind === "generation-debug") return systemFavicon("generation-debug");
  return favicon;
}

function loadStateValue(value: unknown): BrowserTab["loadState"] {
  return value === "loading" || value === "error" ? value : "idle";
}

function recordOf<T>(value: unknown): Record<string, T> {
  return isRecord(value) ? value as Record<string, T> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function themeValue(value: unknown): ThemeId | undefined {
  return value === "native" || value === "sedative" || value === "ie-classic" || value === "cyberpunk"
    ? value
    : undefined;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isSelectableModel(modelId: string, connections: ProviderConnection[], profileId: string) {
  const staticModel = MODELS.find((model) => model.id === modelId);
  if (staticModel) return staticModel.available;
  return connections.some((connection) =>
    connection.profileId === profileId && connection.enabled && connection.modelIds.includes(modelId),
  );
}

function persistArtifactsInUiStorage() {
  if (typeof window === "undefined") return true;
  return !Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function createId(prefix: string) {
  return typeof crypto.randomUUID === "function"
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
