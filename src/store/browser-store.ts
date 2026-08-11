import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MODELS, PROFILES } from "../data/catalog";
import {
  isExplicitRelativeReference,
  normalizeVirtualUrl,
  readableHost,
  resolveNavigation,
  resolveRealNavigation,
  type NavigationTarget,
} from "../lib/navigation";
import type {
  BrowserPreferences,
  BrowserTab,
  CodexConnection,
  Density,
  GenerationError,
  GenerationJob,
  GenerationMode,
  GenerationPhase,
  GenerationSettings,
  HistoryEntry,
  ImageGenerationSettings,
  NavigationDisposition,
  NavigationIntent,
  PageArtifact,
  ProviderConnection,
  SiteWorld,
  TabKind,
  TabLayout,
  TabOpenerContext,
  ThemeId,
} from "../types/browser";

export interface AddTabOptions {
  disposition?: Exclude<NavigationDisposition, "current">;
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
  provisionalFavicon?: string;
}

export interface GenerationMetadataPatch extends GenerationProgressPatch {
  provisionalSummary?: string;
}

export interface BrowserState {
  tabs: BrowserTab[];
  activeTabId: string;
  activeModelId: string;
  activeProfileId: string;
  preferences: BrowserPreferences;
  codex: CodexConnection;
  artifacts: Record<string, PageArtifact>;
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
  setLoadState: (id: string, state: BrowserTab["loadState"]) => void;
  setTabMetadata: (
    id: string,
    patch: Pick<Partial<BrowserTab>, "title" | "favicon">,
    expectedJobId?: string,
  ) => boolean;
  beginGeneration: (jobId: string) => boolean;
  setGenerationPhase: (jobId: string, phase: GenerationPhase, patch?: GenerationProgressPatch) => boolean;
  setGenerationMetadata: (jobId: string, patch: GenerationMetadataPatch) => boolean;
  setGenerationPreview: (jobId: string, html: string, revision?: number) => boolean;
  commitArtifact: (jobId: string, artifact: PageArtifact) => boolean;
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
  patchPrivacySettings: (patch: Partial<GenerationSettings["privacy"]>) => void;
  openSettings: (section?: string) => string;
  setSettingsSection: (section: string) => void;
  setModel: (id: string) => void;
  setProfile: (id: string) => void;
  setTheme: (theme: ThemeId) => void;
  setTabLayout: (layout: TabLayout) => void;
  setDensity: (density: Density) => void;
  patchPreferences: (patch: Partial<BrowserPreferences>) => void;
  patchCodex: (patch: Partial<CodexConnection>) => void;
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
  defaultMode: "quick",
  defaultModelByMode: {},
  customInstruction: "",
  promptVersion: 1,
  maxRequests: 4,
  maxOutputTokens: 16_000,
  autoRepair: true,
  reuseCachedPages: true,
  style: {
    tailwindEnabled: true,
    tailwindVersion: "4.3.3",
    allowArbitraryUtilities: false,
    customCssInstruction: "",
    allowGeneratedScripts: false,
    progressiveRendering: false,
  },
  images: {
    enabled: true,
    provider: "tag-placeholder",
    safeContent: true,
    allowExternalRequests: false,
  },
  privacy: {
    includeNavigationHistory: true,
    sameSiteSummariesOnly: true,
    diagnosticsEnabled: false,
  },
};

const initialTabs: BrowserTab[] = [
  makeTab({
    id: "welcome",
    title: "New tab",
    location: "vibe://new-tab",
    kind: "new-tab",
    favicon: "✦",
  }),
  makeTab({
    id: "quiet-interface",
    title: "A quiet interface for ideas",
    location: "vibe://generated/quiet-interface",
    kind: "generated",
    prompt: "A quiet interface for ideas that are still taking shape",
    favicon: "✦",
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
      preferences: DEFAULT_BROWSER_PREFERENCES,
      codex: {
        state: "signed-out",
        available: false,
        message: "Not connected",
      },
      artifacts: {},
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
        const openerId = options.opener?.tabId ?? state.activeTabId;
        const openerIndex = state.tabs.findIndex((item) => item.id === openerId);
        const insertAt = openerIndex < 0 ? state.tabs.length : openerIndex + 1;
        const tabs = [...state.tabs];
        tabs.splice(insertAt, 0, tab);
        set({
          tabs,
          activeTabId: disposition === "background-tab" ? state.activeTabId : id,
          generationJobs: navigation.generationJobs,
          siteWorlds: navigation.siteWorlds,
        });
        return id;
      },
      closeTab: (id) => {
        const state = get();
        const index = state.tabs.findIndex((tab) => tab.id === id);
        if (index < 0) return;
        const closingTab = state.tabs[index];
        const generationJobs = cancelJobRecord(state.generationJobs, closingTab.generationJobId);
        const tabs = state.tabs.filter((tab) => tab.id !== id);

        if (tabs.length === 0) {
          const replacement = makeTab({
            id: createId("tab"),
            title: "New tab",
            location: "vibe://new-tab",
            kind: "new-tab",
            favicon: "✦",
          });
          set({ tabs: [replacement], activeTabId: replacement.id, generationJobs });
          return;
        }

        const activeTabId =
          state.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeTabId;
        set({ tabs, activeTabId, generationJobs });
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
        const generationJobs = reusesCurrentArtifact
          ? state.generationJobs
          : cancelJobRecord(state.generationJobs, currentTab.generationJobId);
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
          loadState: loadStateForTarget(target, navigation.job),
          history,
          historyIndex: history.length - 1,
        };
        set({
          tabs: state.tabs.map((tab) => (tab.id === id ? nextTab : tab)),
          generationJobs: navigation.generationJobs,
          siteWorlds: navigation.siteWorlds,
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
        const generationJobs = cancelJobRecord(state.generationJobs, currentTab.generationJobId);
        set({
          generationJobs,
          tabs: state.tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  ...target,
                  prompt: undefined,
                  artifactId: undefined,
                  generationJobId: undefined,
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
                  generationJobId: target.generationJobId,
                  historyIndex,
                  loadState: loadStateForHistory(target, targetJob),
                  generatedWith: target.kind === "generated" ? targetJob?.modelId ?? tab.generatedWith : undefined,
                }
              : tab,
          ),
        });
      },
      reload: (id) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  reloadKey: tab.reloadKey + 1,
                  loadState: tab.kind === "remote" ? "idle" : tab.loadState,
                }
              : tab,
          ),
        })),
      regenerate: (id) => {
        const state = get();
        const tab = state.tabs.find((item) => item.id === id);
        if (!tab || tab.kind !== "generated") return undefined;
        const target: NavigationTarget = {
          location: tab.location,
          title: tab.title,
          kind: "generated",
          prompt: tab.prompt,
          favicon: tab.favicon,
          virtualLocation: tab.virtualLocation,
          requiresGeneration: true,
        };
        const generationJobs = cancelJobRecord(state.generationJobs, tab.generationJobId);
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
        };
        set({
          generationJobs: navigation.generationJobs,
          siteWorlds: navigation.siteWorlds,
          tabs: state.tabs.map((item) =>
            item.id === id
              ? {
                  ...item,
                  generationJobId: navigation.job?.id,
                  loadState: "loading",
                  generatedWith: state.activeModelId,
                  history,
                }
              : item,
          ),
        });
        return navigation.job?.id;
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
          tabs: state.tabs.map((tab) => {
            if (tab.id !== job.tabId || tab.generationJobId !== jobId) return tab;
            const metadataPatch = { ...titlePatch, ...faviconPatch };
            return { ...tab, ...metadataPatch, history: patchCurrentHistory(tab, metadataPatch) };
          }),
        });
        return true;
      },
      setGenerationMetadata: (jobId, patch) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job) return false;
        const titlePatch = patch.provisionalTitle ? { title: patch.provisionalTitle } : {};
        const faviconPatch = patch.provisionalFavicon ? { favicon: patch.provisionalFavicon } : {};
        const metadataPatch = { ...titlePatch, ...faviconPatch };
        set({
          generationJobs: {
            ...state.generationJobs,
            [jobId]: { ...job, ...patch, updatedAt: new Date().toISOString() },
          },
          tabs: state.tabs.map((tab) =>
            tab.id === job.tabId && tab.generationJobId === jobId
              ? { ...tab, ...metadataPatch, history: patchCurrentHistory(tab, metadataPatch) }
              : tab,
          ),
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
        if (!job || artifact.generationJobId !== jobId) return false;
        const tab = state.tabs.find((item) => item.id === job.tabId);
        if (!tab) return false;
        const favicon = faviconValue(artifact) ?? tab.favicon;
        const history = patchCurrentHistory(tab, {
          title: artifact.title,
          favicon,
          artifactId: artifact.id,
          generationJobId: jobId,
        });
        const now = new Date().toISOString();
        const siteWorlds = mergeArtifactIntoSiteWorld(state.siteWorlds, artifact, now);
        set({
          artifacts: { ...state.artifacts, [artifact.id]: artifact },
          siteWorlds,
          generationJobs: {
            ...state.generationJobs,
            [jobId]: {
              ...job,
              artifactId: artifact.id,
              usage: artifact.usage,
              status: "completed",
              phase: "completed",
              updatedAt: now,
            },
          },
          tabs: state.tabs.map((item) =>
            item.id === job.tabId && item.generationJobId === jobId
              ? {
                  ...item,
                  title: artifact.title,
                  favicon,
                  artifactId: artifact.id,
                  loadState: "idle",
                  history,
                }
              : item,
          ),
        });
        return true;
      },
      failGeneration: (jobId, error) => {
        const state = get();
        const job = activeCurrentJob(state, jobId);
        if (!job) return false;
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
          tabs: state.tabs.map((tab) =>
            tab.id === job.tabId && tab.generationJobId === jobId ? { ...tab, loadState: "error" } : tab,
          ),
        });
        return true;
      },
      cancelGeneration: (jobId) => {
        const state = get();
        const job = state.generationJobs[jobId];
        if (!job || !isActiveJob(job)) return false;
        const generationJobs = cancelJobRecord(state.generationJobs, jobId);
        set({
          generationJobs,
          tabs: state.tabs.map((tab) =>
            tab.generationJobId === jobId ? { ...tab, loadState: "idle" } : tab,
          ),
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
        set({
          generationJobs,
          tabs: state.tabs.map((tab) =>
            tab.generationJobId && interruptedIds.has(tab.generationJobId) ? { ...tab, loadState: "idle" } : tab,
          ),
        });
      },
      hydrateArtifacts: (artifacts) => {
        if (artifacts.length === 0) return;
        set((state) => ({
          artifacts: {
            ...state.artifacts,
            ...Object.fromEntries(artifacts.map((artifact) => [artifact.id, artifact])),
          },
        }));
      },
      hydrateSiteWorlds: (siteWorlds) => {
        if (siteWorlds.length === 0) return;
        set((state) => ({ siteWorlds: mergeHydratedSiteWorlds(state.siteWorlds, siteWorlds) }));
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
          const defaultModelByMode = Object.fromEntries(
            Object.entries(state.generationSettings.defaultModelByMode)
              .filter(([, modelId]) => !modelId || !removedModels.has(modelId)),
          ) as GenerationSettings["defaultModelByMode"];
          return {
            providerConnections: state.providerConnections.filter((item) => item.id !== id),
            activeModelId: removedModels.has(state.activeModelId) ? MODELS[0].id : state.activeModelId,
            generationSettings: {
              ...state.generationSettings,
              defaultModelByMode,
            },
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
      patchPrivacySettings: (patch) =>
        set((state) => ({
          generationSettings: {
            ...state.generationSettings,
            privacy: { ...state.generationSettings.privacy, ...patch },
          },
        })),
      openSettings: (section = "appearance") => {
        const state = get();
        const existing = state.tabs.find((tab) => tab.kind === "settings");
        if (existing) {
          set({ activeTabId: existing.id });
          get().setSettingsSection(section);
          return existing.id;
        }
        const id = createId("tab");
        const location = `vibe://settings/${section}`;
        const tab = makeTab({ id, title: "Settings", location, kind: "settings", favicon: "⚙" });
        set({ tabs: [...state.tabs, tab], activeTabId: id });
        return id;
      },
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
        if (PROFILES.some((profile) => profile.id === activeProfileId)) set({ activeProfileId });
      },
      setTheme: (theme) => set((state) => ({ preferences: { ...state.preferences, theme } })),
      setTabLayout: (tabLayout) => set((state) => ({ preferences: { ...state.preferences, tabLayout } })),
      setDensity: (density) => set((state) => ({ preferences: { ...state.preferences, density } })),
      patchPreferences: (patch) => set((state) => ({ preferences: { ...state.preferences, ...patch } })),
      patchCodex: (patch) => set((state) => ({ codex: { ...state.codex, ...patch } })),
    }),
    {
      name: "vibesurfer-browser-state",
      version: 4,
      migrate: (persistedState, version) => migrateBrowserState(persistedState, version) as BrowserState,
      partialize: (state) => ({
        tabs: state.preferences.reopenSession ? state.tabs : initialTabs,
        activeTabId: state.preferences.reopenSession ? state.activeTabId : "welcome",
        activeModelId: state.activeModelId,
        activeProfileId: state.activeProfileId,
        preferences: state.preferences,
        artifacts: state.preferences.reopenSession && persistArtifactsInUiStorage() ? state.artifacts : {},
        generationJobs: state.preferences.reopenSession ? state.generationJobs : {},
        siteWorlds: state.preferences.reopenSession ? state.siteWorlds : {},
        providerConnections: state.providerConnections,
        generationSettings: state.generationSettings,
      }),
      onRehydrateStorage: () => (state) => state?.recoverInterruptedJobs(),
    },
  ),
);

interface PrepareNavigationOptions {
  requestedValue: string;
  disposition: NavigationDisposition;
  trigger: NavigationIntent["trigger"];
  intent?: Partial<NavigationIntent>;
  sourceTabId?: string;
  sourceArtifactId?: string;
  sourceHistoryEntryId?: string;
  reuseSiteWorldId?: string;
}

interface PreparedNavigation {
  current: Pick<BrowserTab, "artifactId" | "generationJobId">;
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
        ? { artifactId: sourceTab?.artifactId, generationJobId: sourceTab?.generationJobId }
        : { artifactId: undefined, generationJobId: undefined },
      generationJobs: state.generationJobs,
      siteWorlds: state.siteWorlds,
    };
  }

  const now = new Date().toISOString();
  const jobId = createId("job");
  const siteWorld = target.virtualLocation
    ? findOrCreateSiteWorld(state.siteWorlds, target.virtualLocation.origin, now)
    : findOrCreatePromptSiteWorld(
        state.siteWorlds,
        options.reuseSiteWorldId ?? siteWorldIdForPrompt(jobId),
        target.prompt ?? options.requestedValue,
        now,
      );
  const mode = state.generationSettings.defaultMode;
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
    siteWorldId: siteWorld?.id,
    sourceArtifactId: options.sourceArtifactId,
    sourceHistoryEntryId: options.sourceHistoryEntryId,
    providerId: providerIdForModel(state.activeModelId),
    modelId: modelForMode(state.activeModelId, state.generationSettings, mode),
    mode,
    status: "queued",
    phase: "queued",
    navigationIntent: intent,
    createdAt: now,
    updatedAt: now,
  };
  return {
    current: { artifactId: undefined, generationJobId: jobId },
    job,
    generationJobs: { ...state.generationJobs, [jobId]: job },
    siteWorlds: siteWorld ? { ...state.siteWorlds, [siteWorld.id]: siteWorld } : state.siteWorlds,
  };
}

function modelForMode(activeModelId: string, settings: GenerationSettings, mode: GenerationMode) {
  return settings.defaultModelByMode[mode] ?? activeModelId;
}

function providerIdForModel(modelId: string) {
  const separator = modelId.indexOf(":");
  return separator > 0 ? modelId.slice(0, separator) : undefined;
}

function findOrCreateSiteWorld(siteWorlds: Record<string, SiteWorld>, origin: string, now: string) {
  const existing = Object.values(siteWorlds).find((siteWorld) => siteWorld.origin === origin);
  if (existing) return existing;
  return {
    id: `site-${stableHash(origin)}`,
    origin,
    name: readableHost(origin),
    purpose: "",
    audience: "",
    visualLanguage: { palette: [], typography: "", layout: "", tone: "" },
    informationArchitecture: [],
    establishedFacts: [],
    visitedPageSummaries: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  } satisfies SiteWorld;
}

function findOrCreatePromptSiteWorld(
  siteWorlds: Record<string, SiteWorld>,
  id: string,
  prompt: string,
  now: string,
) {
  const existing = siteWorlds[id];
  if (existing) return existing;
  return {
    id,
    origin: `https://prompt-${stableHash(id)}.generated.vibe.local`,
    name: prompt.length > 80 ? `${prompt.slice(0, 79)}…` : prompt,
    purpose: prompt,
    audience: "",
    visualLanguage: { palette: [], typography: "", layout: "", tone: "" },
    informationArchitecture: [],
    establishedFacts: [],
    visitedPageSummaries: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  } satisfies SiteWorld;
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
  const tab = state.tabs.find((item) => item.id === job.tabId);
  return tab?.generationJobId === jobId ? job : undefined;
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

function faviconValue(artifact: PageArtifact) {
  if (artifact.faviconUrl) return artifact.faviconUrl;
  if (!artifact.favicon) return undefined;
  return artifact.favicon.kind === "glyph" ? artifact.favicon.glyph : artifact.favicon.src;
}

function mergeArtifactIntoSiteWorld(
  siteWorlds: Record<string, SiteWorld>,
  artifact: PageArtifact,
  now: string,
): Record<string, SiteWorld> {
  const virtualLocation = normalizeVirtualUrl(artifact.url);
  const existing = siteWorlds[artifact.siteWorldId]
    ?? (virtualLocation
      ? Object.values(siteWorlds).find((siteWorld) => siteWorld.origin === virtualLocation.origin)
      : undefined);
  if (!existing && !virtualLocation) return siteWorlds;
  const patch = artifact.sitePatch;
  const base: SiteWorld = existing ?? {
    id: artifact.siteWorldId,
    origin: virtualLocation!.origin,
    name: patch?.name ?? readableHost(artifact.url),
    purpose: patch?.purpose ?? "",
    audience: patch?.audience ?? "",
    visualLanguage: { palette: [], typography: "", layout: "", tone: "" },
    informationArchitecture: [],
    establishedFacts: [],
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
    factsIntroduced: patch?.establishedFacts ?? [],
    outboundRoutes: patch?.routeHints.map((route) => route.path) ?? [],
  });
  const next: SiteWorld = {
    ...base,
    id: artifact.siteWorldId,
    name: patch?.name ?? base.name,
    purpose: patch?.purpose ?? base.purpose,
    audience: patch?.audience ?? base.audience,
    visualLanguage: patch
      ? {
          palette: patch.visualLanguage.palette,
          typography: patch.visualLanguage.typography,
          layout: patch.visualLanguage.layout
            ?? [patch.visualLanguage.density, patch.visualLanguage.radius].filter(Boolean).join(", "),
          tone: patch.visualLanguage.tone ?? patch.visualLanguage.mood ?? base.visualLanguage.tone,
        }
      : base.visualLanguage,
    informationArchitecture: patch?.routeHints ?? base.informationArchitecture,
    establishedFacts: patch
      ? [...new Set([...base.establishedFacts, ...patch.establishedFacts])].slice(-48)
      : base.establishedFacts,
    visitedPageSummaries: summaries.slice(-24),
    revision: base.revision + 1,
    updatedAt: now,
  };
  if (existing && existing.id !== artifact.siteWorldId) {
    const { [existing.id]: _removed, ...remaining } = siteWorlds;
    return { ...remaining, [artifact.siteWorldId]: next };
  }
  return { ...siteWorlds, [artifact.siteWorldId]: next };
}

function mergeHydratedSiteWorlds(
  current: Record<string, SiteWorld>,
  hydrated: SiteWorld[],
): Record<string, SiteWorld> {
  let merged = { ...current };
  for (const siteWorld of hydrated) {
    const existing = merged[siteWorld.id]
      ?? Object.values(merged).find((candidate) => candidate.origin === siteWorld.origin);
    if (existing && (
      existing.revision > siteWorld.revision ||
      (existing.revision === siteWorld.revision && existing.updatedAt > siteWorld.updatedAt)
    )) {
      continue;
    }
    if (existing && existing.id !== siteWorld.id) {
      const { [existing.id]: _removed, ...remaining } = merged;
      merged = remaining;
    }
    merged[siteWorld.id] = siteWorld;
  }
  return merged;
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
    generationJobId: input.generationJobId,
    opener: input.opener,
    loadState: input.loadState ?? "idle",
    reloadKey: input.reloadKey ?? 0,
    history: input.history ?? [entry],
    historyIndex: input.historyIndex ?? 0,
    generatedWith: input.generatedWith,
  };
}

export function migrateBrowserState(persistedState: unknown, _version = 0): Partial<BrowserState> {
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
  let generationSettings = migrateGenerationSettings(source.generationSettings);
  const requestedProfileId = stringValue(source.activeProfileId);
  const activeProfileId = requestedProfileId && PROFILES.some((profile) => profile.id === requestedProfileId)
    ? requestedProfileId
    : PROFILES[0].id;
  const generationJobs = Object.fromEntries(
    Object.entries(persistedGenerationJobs).map(([id, job]) => [
      id,
      { ...job, profileId: job.profileId ?? activeProfileId, tabId: tabIdRemap.get(job.tabId) ?? job.tabId },
    ]),
  );
  const artifacts = recordOf<PageArtifact>(source.artifacts);
  const siteWorlds = recordOf<SiteWorld>(source.siteWorlds);
  const providerConnections = Array.isArray(source.providerConnections)
    ? source.providerConnections
        .filter(isRecord)
        .map((connection) => ({ ...connection, profileId: optionalString(connection.profileId) ?? activeProfileId })) as ProviderConnection[]
    : [];
  const requestedActiveModelId = stringValue(source.activeModelId) || MODELS[0].id;
  const activeModelId = isSelectableModel(requestedActiveModelId, providerConnections, activeProfileId)
    ? requestedActiveModelId
    : MODELS[0].id;
  generationSettings = {
    ...generationSettings,
    defaultModelByMode: Object.fromEntries(
      Object.entries(generationSettings.defaultModelByMode).filter(([, modelId]) =>
        Boolean(modelId && isSelectableModel(modelId, providerConnections, activeProfileId))),
    ),
  };
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

  return {
    tabs,
    activeTabId,
    activeModelId,
    activeProfileId,
    preferences,
    artifacts,
    generationJobs,
    siteWorlds,
    providerConnections,
    generationSettings,
  };
}

function migrateTab(value: unknown, index: number, generationJobs: Record<string, GenerationJob>): BrowserTab {
  const source = isRecord(value) ? value : {};
  const id = recoverTabId(source, index, generationJobs);
  const location = stringValue(source.location) || "vibe://new-tab";
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
    favicon: optionalString(source.favicon),
    kind,
    prompt: optionalString(source.prompt),
    virtualLocation,
    artifactId: optionalString(source.artifactId) ?? current.artifactId,
    generationJobId: optionalString(source.generationJobId) ?? current.generationJobId,
    opener: openerValue(source.opener),
    loadState: loadStateValue(source.loadState),
    reloadKey: numberValue(source.reloadKey) ?? 0,
    history,
    historyIndex,
    generatedWith: optionalString(source.generatedWith),
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
  const location = stringValue(source.location) || fallback.location;
  const kind = tabKind(source.kind, location) || fallback.kind;
  return {
    id: stringValue(source.id) || `${tabId}:history:${index}`,
    location,
    title: stringValue(source.title) || fallback.title,
    kind,
    prompt: optionalString(source.prompt),
    favicon: optionalString(source.favicon),
    virtualLocation: virtualLocationValue(source.virtualLocation) ?? normalizeVirtualUrl(location),
    artifactId: optionalString(source.artifactId),
    generationJobId: optionalString(source.generationJobId),
  };
}

function migrateGenerationSettings(value: unknown): GenerationSettings {
  const source = isRecord(value) ? value : {};
  const style = isRecord(source.style) ? source.style : {};
  const images = isRecord(source.images) ? source.images : {};
  const privacy = isRecord(source.privacy) ? source.privacy : {};
  const defaultMode: GenerationMode = source.defaultMode === "deep" ? "deep" : "quick";
  const maxRequests = clampInteger(
    numberValue(source.maxRequests) ?? DEFAULT_GENERATION_SETTINGS.maxRequests,
    defaultMode === "deep" ? 3 : 1,
    4,
  );
  const imageProvider = images.provider === "off" || images.provider === "tag-placeholder" || images.provider === "local-library"
    ? images.provider
    : "tag-placeholder";
  const imagesEnabled = (booleanValue(images.enabled) ?? DEFAULT_GENERATION_SETTINGS.images.enabled)
    && imageProvider !== "off";
  return {
    defaultMode,
    defaultModelByMode: isRecord(source.defaultModelByMode)
      ? source.defaultModelByMode as Partial<Record<GenerationMode, string>>
      : {},
    customInstruction: stringValue(source.customInstruction).slice(0, 20_000),
    promptVersion: DEFAULT_GENERATION_SETTINGS.promptVersion,
    maxRequests,
    maxOutputTokens: clampInteger(
      numberValue(source.maxOutputTokens) ?? DEFAULT_GENERATION_SETTINGS.maxOutputTokens,
      512,
      100_000,
    ),
    autoRepair: booleanValue(source.autoRepair) ?? DEFAULT_GENERATION_SETTINGS.autoRepair,
    reuseCachedPages: booleanValue(source.reuseCachedPages) ?? DEFAULT_GENERATION_SETTINGS.reuseCachedPages,
    style: {
      tailwindEnabled: booleanValue(style.tailwindEnabled) ?? DEFAULT_GENERATION_SETTINGS.style.tailwindEnabled,
      tailwindVersion: DEFAULT_GENERATION_SETTINGS.style.tailwindVersion,
      allowArbitraryUtilities: false,
      customCssInstruction: stringValue(style.customCssInstruction).slice(0, 2_000),
      allowGeneratedScripts: false,
      progressiveRendering: false,
    },
    images: {
      enabled: imagesEnabled,
      provider: imagesEnabled ? imageProvider : "off",
      safeContent: booleanValue(images.safeContent) ?? true,
      allowExternalRequests: imagesEnabled
        && imageProvider === "tag-placeholder"
        && (booleanValue(images.allowExternalRequests) ?? false),
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
  if (value === "new-tab" || value === "remote" || value === "generated" || value === "settings") return value;
  if (location === "vibe://new-tab") return "new-tab";
  if (location.startsWith("vibe://settings")) return "settings";
  if (location.startsWith("vibe://generated")) return "generated";
  return normalizeVirtualUrl(location) ? "remote" : "generated";
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
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
