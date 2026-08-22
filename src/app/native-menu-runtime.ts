import {
  NATIVE_BROWSER_COMMAND_IDS,
  browserCommandPresentation,
  executeBrowserCommand,
  type BrowserCommandId,
  type NativeBrowserCommandId,
} from "../browser/browser-command-registry";
import type {
  BrowserNativeMenuState,
  BrowserServices,
} from "../browser/browser-services";
import { useBrowserStore, type BrowserState } from "../store/browser-store";

export const nativeMenuCommands = NATIVE_BROWSER_COMMAND_IDS;
export type NativeMenuCommand = NativeBrowserCommandId;
export type NativeMenuState = BrowserNativeMenuState;

export function isNativeMenuCommand(value: unknown): value is NativeMenuCommand {
  return typeof value === "string" && (nativeMenuCommands as readonly string[]).includes(value);
}

export function handleNativeMenuCommand(command: unknown, services: BrowserServices): boolean {
  return isNativeMenuCommand(command) && executeBrowserCommand(command, services);
}

export function nativeMenuState(state: BrowserState, services: BrowserServices): NativeMenuState {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0];
  const presentation = (id: BrowserCommandId) => browserCommandPresentation(id, state, services);
  return {
    canGoBack: presentation("back").enabled,
    canGoForward: presentation("forward").enabled,
    isLoading: presentation("stop").enabled,
    isGenerated: presentation("regenerate").enabled,
    isArchived: Boolean(tab?.archivedSiteWorldId),
    hasLiveSite: presentation("open-live-site").enabled,
    horizontalTabs: presentation("horizontal-tabs").checked === true,
  };
}

let startPromise: Promise<void> | undefined;
let unlisten: (() => void) | undefined;
let unsubscribeStore: (() => void) | undefined;

export function startNativeMenuRuntime(services: BrowserServices): Promise<void> {
  if (startPromise) return startPromise;
  if (services.runtime !== "tauri") {
    startPromise = Promise.resolve();
    return startPromise;
  }

  startPromise = (async () => {
    unlisten = await services.nativeMenu.listen((command) => {
      handleNativeMenuCommand(command, services);
    });

    let previous = "";
    const sync = (state: BrowserState) => {
      const menuState = nativeMenuState(state, services);
      const signature = JSON.stringify(menuState);
      if (signature === previous) return;
      previous = signature;
      void services.nativeMenu.update(menuState).catch((error: unknown) => {
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
