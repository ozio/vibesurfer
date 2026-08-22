import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorybookBrowserServices } from "./browser-service-adapters";
import {
  BROWSER_COMMAND_IDS,
  NATIVE_BROWSER_COMMAND_IDS,
  browserCommandForKeyboardEvent,
  browserCommandPresentation,
  executeBrowserCommand,
  handleBrowserCommandKeydown,
} from "./browser-command-registry";
import commandManifest from "./browser-command-manifest.json";
import { useBrowserStore, type BrowserState } from "../store/browser-store";

describe("browser command registry", () => {
  beforeEach(() => useBrowserStore.setState(freshInitialState(), true));
  afterEach(() => useBrowserStore.setState(freshInitialState(), true));

  it("covers the language-neutral manifest and native subset", () => {
    expect(BROWSER_COMMAND_IDS).toEqual(Object.keys(commandManifest));
    expect(NATIVE_BROWSER_COMMAND_IDS).toEqual(
      Object.entries(commandManifest).filter(([, value]) => value.nativeMenu).map(([id]) => id),
    );
  });

  it("derives dynamic labels, enabled state, checks and platform shortcuts", () => {
    const services = createStorybookBrowserServices("macos");
    const state = useBrowserStore.getState();
    const generated = state.tabs.find((tab) => tab.kind === "generated")!;
    const archived = { ...generated, archivedSiteWorldId: "archived-site" };
    const nextState = { ...state, tabs: state.tabs.map((tab) => tab.id === generated.id ? archived : tab) };

    expect(browserCommandPresentation("regenerate", nextState, services, { tabId: generated.id }))
      .toMatchObject({ label: "Reload archived snapshot", enabled: true, shortcut: "⇧⌘R" });
    expect(browserCommandPresentation("reimagine", nextState, services, { tabId: generated.id }).enabled).toBe(false);
    expect(browserCommandPresentation("horizontal-tabs", state, services).checked).toBe(true);
    expect(browserCommandPresentation("open-settings", state, services).shortcut).toBe("⌘,");
  });

  it("makes Stop cancel the active generation before clearing visual loading", () => {
    const services = createStorybookBrowserServices("macos");
    const state = useBrowserStore.getState();
    const tabId = state.activeTabId;
    const cancelTabGeneration = vi.fn(() => true);
    const setLoadState = vi.fn();
    useBrowserStore.setState({
      tabs: state.tabs.map((tab) => tab.id === tabId ? { ...tab, loadState: "loading" } : tab),
      cancelTabGeneration,
      setLoadState,
    });

    expect(executeBrowserCommand("stop", services)).toBe(true);
    expect(cancelTabGeneration).toHaveBeenCalledWith(tabId);
    expect(setLoadState).not.toHaveBeenCalled();

    cancelTabGeneration.mockReturnValue(false);
    expect(executeBrowserCommand("stop", services)).toBe(true);
    expect(setLoadState).toHaveBeenCalledWith(tabId, "idle");
  });

  it("matches web shortcuts without stealing the macOS app switcher", () => {
    const event = (key: string, modifiers: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">> = {}) => ({
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });

    expect(browserCommandForKeyboardEvent(event("Tab", { metaKey: true }), "macos")).toBeUndefined();
    expect(browserCommandForKeyboardEvent(event("Tab", { ctrlKey: true }), "macos")).toBe("next-tab");
    expect(browserCommandForKeyboardEvent(event("Tab", { ctrlKey: true, shiftKey: true }), "macos")).toBe("previous-tab");
    expect(browserCommandForKeyboardEvent(event("r", { metaKey: true }), "macos")).toBe("reload");
    expect(browserCommandForKeyboardEvent(event("R", { metaKey: true, shiftKey: true }), "macos")).toBe("regenerate");
    expect(browserCommandForKeyboardEvent(event("t", { ctrlKey: true }), "windows")).toBe("new-tab");
  });

  it("executes and prevents default only for an enabled JS hotkey", () => {
    const services = createStorybookBrowserServices("macos");
    const initialCount = useBrowserStore.getState().tabs.length;
    const event = new KeyboardEvent("keydown", { key: "t", metaKey: true, cancelable: true });

    expect(handleBrowserCommandKeydown(event, services)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(useBrowserStore.getState().tabs).toHaveLength(initialCount + 1);
  });
});

function freshInitialState(): BrowserState {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(useBrowserStore.getInitialState())) {
    clone[key] = typeof value === "function" ? value : structuredClone(value);
  }
  return clone as unknown as BrowserState;
}
