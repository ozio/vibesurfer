import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowserServices, type BrowserServices } from "./browser-services";
import commandManifest from "./browser-command-manifest.json";
import { openBlankTabAndFocus } from "../app/browser-actions";
import { externalHttpUrl } from "../lib/platform";
import { useBrowserStore, type BrowserState } from "../store/browser-store";
import type { BrowserTab, Platform } from "../types/browser";

export type BrowserCommandId = keyof typeof commandManifest;
export type NativeBrowserCommandId = {
  [Id in BrowserCommandId]: (typeof commandManifest)[Id]["nativeMenu"] extends true ? Id : never;
}[BrowserCommandId];

export interface BrowserCommandTarget {
  tabId?: string;
}

export interface BrowserCommandContext extends BrowserCommandTarget {
  state: BrowserState;
  services: BrowserServices;
}

export interface BrowserShortcut {
  key: string;
  primary?: true;
  control?: true;
  shift?: true;
  alt?: true;
  mac: string;
  other: string;
}

export interface BrowserCommandDefinition {
  label: string | ((context: BrowserCommandContext) => string);
  enabled?: (context: BrowserCommandContext) => boolean;
  checked?: (context: BrowserCommandContext) => boolean;
  shortcut?: BrowserShortcut;
  run: (context: BrowserCommandContext) => unknown | Promise<unknown>;
}

export interface BrowserCommandPresentation {
  id: BrowserCommandId;
  label: string;
  enabled: boolean;
  checked?: boolean;
  shortcut?: string;
}

const GITHUB_URL = "https://github.com/ozio/vibesurfer";
const ISSUES_URL = `${GITHUB_URL}/issues`;

const primary = (key: string, mac: string, other: string, extras: Pick<BrowserShortcut, "shift" | "alt"> = {}): BrowserShortcut => ({
  key,
  primary: true,
  mac,
  other,
  ...extras,
});

export const BROWSER_COMMAND_REGISTRY = {
  "new-tab": {
    label: "New tab",
    shortcut: primary("t", "⌘T", "Ctrl+T"),
    run: () => openBlankTabAndFocus(),
  },
  "close-tab": {
    label: "Close",
    shortcut: primary("w", "⌘W", "Ctrl+W"),
    run: ({ state, tabId }) => state.closeTab(resolveTabId(state, tabId)),
  },
  "focus-address": {
    label: "Focus address bar",
    shortcut: primary("l", "⌘L", "Ctrl+L"),
    run: () => window.dispatchEvent(new Event("vibesurfer:focus-address")),
  },
  reload: {
    label: ({ state, tabId }) => reloadLabel(resolveTab(state, tabId)),
    shortcut: primary("r", "⌘R", "Ctrl+R"),
    run: ({ state, tabId }) => state.reload(resolveTabId(state, tabId)),
  },
  stop: {
    label: "Stop",
    enabled: ({ state, tabId }) => resolveTab(state, tabId)?.loadState === "loading",
    shortcut: { key: "Escape", mac: "Esc", other: "Esc" },
    run: ({ state, tabId }) => {
      const resolvedTabId = resolveTabId(state, tabId);
      if (!state.cancelTabGeneration(resolvedTabId)) state.setLoadState(resolvedTabId, "idle");
    },
  },
  back: {
    label: "Back",
    enabled: ({ state, tabId }) => (resolveTab(state, tabId)?.historyIndex ?? 0) > 0,
    shortcut: primary("[", "⌘[", "Ctrl+["),
    run: ({ state, tabId }) => state.go(resolveTabId(state, tabId), -1),
  },
  forward: {
    label: "Forward",
    enabled: ({ state, tabId }) => {
      const tab = resolveTab(state, tabId);
      return Boolean(tab && tab.historyIndex < tab.history.length - 1);
    },
    shortcut: primary("]", "⌘]", "Ctrl+]"),
    run: ({ state, tabId }) => state.go(resolveTabId(state, tabId), 1),
  },
  home: {
    label: "Home",
    shortcut: primary("h", "⇧⌘H", "Ctrl+Shift+H", { shift: true }),
    run: ({ state, tabId }) => state.navigate(resolveTabId(state, tabId), "vibe://new-tab"),
  },
  history: {
    label: "History",
    shortcut: primary("y", "⌘Y", "Ctrl+Y"),
    run: ({ state }) => state.openHistory(),
  },
  "next-tab": {
    label: "Next tab",
    enabled: ({ state }) => state.tabs.length > 1,
    shortcut: { key: "Tab", control: true, mac: "⌃Tab", other: "Ctrl+Tab" },
    run: ({ state }) => switchTab(state, 1),
  },
  "previous-tab": {
    label: "Previous tab",
    enabled: ({ state }) => state.tabs.length > 1,
    shortcut: { key: "Tab", control: true, shift: true, mac: "⌃⇧Tab", other: "Ctrl+Shift+Tab" },
    run: ({ state }) => switchTab(state, -1),
  },
  regenerate: {
    label: ({ state, tabId }) => resolveTab(state, tabId)?.archivedSiteWorldId ? "Reload archived snapshot" : "Regenerate page",
    enabled: ({ state, tabId }) => resolveTab(state, tabId)?.kind === "generated",
    shortcut: primary("r", "⇧⌘R", "Ctrl+Shift+R", { shift: true }),
    run: ({ state, tabId }) => state.reload(resolveTabId(state, tabId)),
  },
  reimagine: {
    label: "Reimagine site",
    enabled: ({ state, tabId }) => {
      const tab = resolveTab(state, tabId);
      return tab?.kind === "generated" && !tab.archivedSiteWorldId;
    },
    run: ({ state, tabId }) => state.reimagine(resolveTabId(state, tabId)),
  },
  "open-live-site": {
    label: "Open live site externally",
    enabled: ({ state, tabId }) => Boolean(externalHttpUrl(resolveTab(state, tabId)?.location ?? "")),
    run: ({ state, services, tabId }) => {
      const tab = resolveTab(state, tabId);
      if (tab) return services.external.open(tab.location);
    },
  },
  "horizontal-tabs": {
    label: "Horizontal tabs",
    checked: ({ state }) => state.preferences.tabLayout === "horizontal",
    run: ({ state }) => state.setTabLayout("horizontal"),
  },
  "vertical-tabs": {
    label: "Vertical tabs",
    checked: ({ state }) => state.preferences.tabLayout === "vertical",
    run: ({ state }) => state.setTabLayout("vertical"),
  },
  "open-settings": {
    label: "Settings",
    shortcut: primary(",", "⌘,", "Ctrl+,"),
    run: ({ state }) => state.openSettings("general"),
  },
  "open-licenses": {
    label: "Open Source Licenses",
    run: ({ state }) => state.openSettings("about"),
  },
  "open-generation-settings": {
    label: "Generation Settings",
    run: ({ state }) => state.openSettings("generation"),
  },
  "open-models": {
    label: "Models & Codex",
    run: ({ state }) => state.openSettings("models"),
  },
  "open-model-picker": {
    label: "Choose model",
    run: () => window.dispatchEvent(new Event("vibesurfer:open-model-picker")),
  },
  "open-profiles": {
    label: "Profiles",
    run: ({ state }) => state.openSettings("profiles"),
  },
  "open-github": {
    label: "VibeSurfer on GitHub",
    run: ({ services }) => services.external.open(GITHUB_URL),
  },
  "report-issue": {
    label: "Report an Issue",
    run: ({ services }) => services.external.open(ISSUES_URL),
  },
  "new-tab-right": {
    label: "New tab to the right",
    run: ({ state, tabId }) => {
      const tab = resolveTab(state, tabId);
      openBlankTabAndFocus({
        placement: "after-opener",
        opener: { tabId: resolveTabId(state, tabId), artifactId: tab?.artifactId },
      });
    },
  },
  "close-other-tabs": {
    label: "Close other tabs",
    enabled: ({ state }) => state.tabs.length > 1,
    run: ({ state, tabId }) => {
      const keepTabId = resolveTabId(state, tabId);
      for (const tab of state.tabs) if (tab.id !== keepTabId) state.closeTab(tab.id);
    },
  },
} satisfies Record<BrowserCommandId, BrowserCommandDefinition>;

export const BROWSER_COMMAND_IDS = Object.keys(commandManifest) as BrowserCommandId[];
export const NATIVE_BROWSER_COMMAND_IDS = BROWSER_COMMAND_IDS.filter(
  (id) => commandManifest[id].nativeMenu,
) as NativeBrowserCommandId[];

export function browserCommandPresentation(
  id: BrowserCommandId,
  state: BrowserState,
  services: BrowserServices,
  target: BrowserCommandTarget = {},
): BrowserCommandPresentation {
  const definition: BrowserCommandDefinition = BROWSER_COMMAND_REGISTRY[id];
  const context = { ...target, state, services };
  const checked = definition.checked?.(context);
  return {
    id,
    label: typeof definition.label === "function" ? definition.label(context) : definition.label,
    enabled: definition.enabled?.(context) ?? true,
    ...(checked === undefined ? {} : { checked }),
    ...(definition.shortcut ? { shortcut: shortcutLabel(definition.shortcut, services.platform) } : {}),
  };
}

export function executeBrowserCommand(
  id: BrowserCommandId,
  services: BrowserServices,
  target: BrowserCommandTarget = {},
): boolean {
  const state = useBrowserStore.getState();
  const presentation = browserCommandPresentation(id, state, services, target);
  if (!presentation.enabled) return false;
  const definition: BrowserCommandDefinition = BROWSER_COMMAND_REGISTRY[id];
  void definition.run({ ...target, state, services });
  return true;
}

export function useBrowserCommand(id: BrowserCommandId, target: BrowserCommandTarget = {}) {
  const services = useBrowserServices();
  const tabId = target.tabId;
  const presentation = useBrowserStore(useShallow((state) => (
    browserCommandPresentation(id, state, services, tabId === undefined ? {} : { tabId })
  )));
  const execute = useCallback(
    () => executeBrowserCommand(id, services, tabId === undefined ? {} : { tabId }),
    [id, services, tabId],
  );
  return {
    ...presentation,
    execute,
  };
}

export function browserCommandForKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  platform: Platform,
): BrowserCommandId | undefined {
  return BROWSER_COMMAND_IDS.find((id) => {
    const shortcut = (BROWSER_COMMAND_REGISTRY[id] as BrowserCommandDefinition).shortcut;
    return shortcut ? shortcutMatches(shortcut, event, platform) : false;
  });
}

export function handleBrowserCommandKeydown(event: KeyboardEvent, services: BrowserServices): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const id = browserCommandForKeyboardEvent(event, services.platform);
  if (!id || !executeBrowserCommand(id, services)) return false;
  event.preventDefault();
  return true;
}

function resolveTab(state: BrowserState, tabId?: string): BrowserTab | undefined {
  return state.tabs.find((tab) => tab.id === (tabId ?? state.activeTabId)) ?? state.tabs[0];
}

function resolveTabId(state: BrowserState, tabId?: string): string {
  return resolveTab(state, tabId)?.id ?? state.activeTabId;
}

function reloadLabel(tab: BrowserTab | undefined): string {
  if (tab?.archivedSiteWorldId) return "Reload archived snapshot";
  if (tab?.kind === "generated") return "Regenerate page";
  return "Reload";
}

function switchTab(state: BrowserState, delta: -1 | 1) {
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  if (index < 0 || state.tabs.length < 2) return;
  state.activateTab(state.tabs[(index + delta + state.tabs.length) % state.tabs.length]!.id);
}

function shortcutLabel(shortcut: BrowserShortcut, platform: Platform): string {
  return platform === "macos" ? shortcut.mac : shortcut.other;
}

function shortcutMatches(
  shortcut: BrowserShortcut,
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  platform: Platform,
): boolean {
  const expectedMeta = shortcut.primary && platform === "macos";
  const expectedControl = Boolean(shortcut.control || (shortcut.primary && platform !== "macos"));
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
    && event.metaKey === Boolean(expectedMeta)
    && event.ctrlKey === expectedControl
    && event.shiftKey === Boolean(shortcut.shift)
    && event.altKey === Boolean(shortcut.alt);
}
