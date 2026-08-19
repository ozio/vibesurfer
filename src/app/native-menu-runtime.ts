import type { UnlistenFn } from "@tauri-apps/api/event";
import { externalHttpUrl, isTauri, openExternal } from "../lib/platform";
import { useBrowserStore, type BrowserState } from "../store/browser-store";
import type { TabLayout } from "../types/browser";

const NATIVE_MENU_EVENT = "vibesurfer://native-menu";
const GITHUB_URL = "https://github.com/ozio/vibesurfer";
const ISSUES_URL = `${GITHUB_URL}/issues`;

export const nativeMenuCommands = [
  "new-tab",
  "close-tab",
  "focus-address",
  "reload",
  "stop",
  "back",
  "forward",
  "home",
  "history",
  "next-tab",
  "previous-tab",
  "regenerate",
  "reimagine",
  "open-live-site",
  "horizontal-tabs",
  "vertical-tabs",
  "open-settings",
  "open-licenses",
  "open-generation-settings",
  "open-models",
  "open-profiles",
  "open-github",
  "report-issue",
] as const;

export type NativeMenuCommand = (typeof nativeMenuCommands)[number];

export interface NativeMenuState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isGenerated: boolean;
  isArchived: boolean;
  hasLiveSite: boolean;
  horizontalTabs: boolean;
}

export interface NativeMenuActions {
  newTab: () => void;
  closeTab: () => void;
  focusAddress: () => void;
  reload: () => void;
  stop: () => void;
  go: (delta: -1 | 1) => void;
  home: () => void;
  history: () => void;
  switchTab: (delta: -1 | 1) => void;
  reimagine: () => void;
  openLiveSite: () => void;
  setTabLayout: (layout: TabLayout) => void;
  openSettings: (section: string) => void;
  openExternal: (url: string) => void;
}

export function isNativeMenuCommand(value: unknown): value is NativeMenuCommand {
  return typeof value === "string" && (nativeMenuCommands as readonly string[]).includes(value);
}

export function handleNativeMenuCommand(command: unknown, actions: NativeMenuActions): boolean {
  if (!isNativeMenuCommand(command)) return false;

  switch (command) {
    case "new-tab": actions.newTab(); break;
    case "close-tab": actions.closeTab(); break;
    case "focus-address": actions.focusAddress(); break;
    case "reload":
    case "regenerate": actions.reload(); break;
    case "stop": actions.stop(); break;
    case "back": actions.go(-1); break;
    case "forward": actions.go(1); break;
    case "home": actions.home(); break;
    case "history": actions.history(); break;
    case "next-tab": actions.switchTab(1); break;
    case "previous-tab": actions.switchTab(-1); break;
    case "reimagine": actions.reimagine(); break;
    case "open-live-site": actions.openLiveSite(); break;
    case "horizontal-tabs": actions.setTabLayout("horizontal"); break;
    case "vertical-tabs": actions.setTabLayout("vertical"); break;
    case "open-settings": actions.openSettings("general"); break;
    case "open-licenses": actions.openSettings("about"); break;
    case "open-generation-settings": actions.openSettings("generation"); break;
    case "open-models": actions.openSettings("models"); break;
    case "open-profiles": actions.openSettings("profiles"); break;
    case "open-github": actions.openExternal(GITHUB_URL); break;
    case "report-issue": actions.openExternal(ISSUES_URL); break;
  }
  return true;
}

export function nativeMenuState(state: BrowserState): NativeMenuState {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0];
  return {
    canGoBack: Boolean(tab && tab.historyIndex > 0),
    canGoForward: Boolean(tab && tab.historyIndex < tab.history.length - 1),
    isLoading: tab?.loadState === "loading",
    isGenerated: tab?.kind === "generated",
    isArchived: Boolean(tab?.archivedSiteWorldId),
    hasLiveSite: Boolean(tab && externalHttpUrl(tab.location)),
    horizontalTabs: state.preferences.tabLayout === "horizontal",
  };
}

function storeActions(): NativeMenuActions {
  const withActiveTab = (action: (state: BrowserState, tabId: string) => void) => {
    const state = useBrowserStore.getState();
    action(state, state.activeTabId);
  };
  const switchTab = (delta: -1 | 1) => {
    const state = useBrowserStore.getState();
    const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
    if (index < 0 || state.tabs.length < 2) return;
    state.activateTab(state.tabs[(index + delta + state.tabs.length) % state.tabs.length].id);
  };

  return {
    newTab: () => useBrowserStore.getState().addTab(),
    closeTab: () => withActiveTab((state, tabId) => state.closeTab(tabId)),
    focusAddress: () => window.dispatchEvent(new Event("vibesurfer:focus-address")),
    reload: () => withActiveTab((state, tabId) => state.reload(tabId)),
    stop: () => withActiveTab((state, tabId) => {
      if (!state.cancelTabGeneration(tabId)) state.setLoadState(tabId, "idle");
    }),
    go: (delta) => withActiveTab((state, tabId) => state.go(tabId, delta)),
    home: () => withActiveTab((state, tabId) => state.navigate(tabId, "vibe://new-tab")),
    history: () => useBrowserStore.getState().openHistory(),
    switchTab,
    reimagine: () => withActiveTab((state, tabId) => state.reimagine(tabId)),
    openLiveSite: () => {
      const state = useBrowserStore.getState();
      const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
      if (tab) void openExternal(tab.location);
    },
    setTabLayout: (layout) => useBrowserStore.getState().setTabLayout(layout),
    openSettings: (section) => useBrowserStore.getState().openSettings(section),
    openExternal: (url) => { void openExternal(url); },
  };
}

let startPromise: Promise<void> | undefined;
let unlisten: UnlistenFn | undefined;
let unsubscribeStore: (() => void) | undefined;

export function startNativeMenuRuntime(): Promise<void> {
  if (startPromise) return startPromise;
  if (!isTauri()) {
    startPromise = Promise.resolve();
    return startPromise;
  }

  startPromise = (async () => {
    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    const actions = storeActions();
    unlisten = await listen<unknown>(NATIVE_MENU_EVENT, (event) => {
      handleNativeMenuCommand(event.payload, actions);
    });

    let previous = "";
    const sync = (state: BrowserState) => {
      const menuState = nativeMenuState(state);
      const signature = JSON.stringify(menuState);
      if (signature === previous) return;
      previous = signature;
      void invoke("update_native_menu_state", { menuState }).catch((error: unknown) => {
        console.warn("Could not update the native browser menu", error);
      });
    };
    sync(useBrowserStore.getState());
    unsubscribeStore = useBrowserStore.subscribe(sync);
  })();

  return startPromise;
}

export function stopNativeMenuRuntime() {
  unlisten?.();
  unsubscribeStore?.();
  unlisten = undefined;
  unsubscribeStore = undefined;
  startPromise = undefined;
}
