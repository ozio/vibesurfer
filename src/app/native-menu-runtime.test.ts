import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorybookBrowserServices } from "../browser/browser-service-adapters";
import { useBrowserStore } from "../store/browser-store";
import {
  handleNativeMenuCommand,
  isNativeMenuCommand,
} from "./native-menu-runtime";

describe("native menu runtime", () => {
  beforeEach(() => {
    useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  });

  afterEach(() => {
    useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  });

  it("routes native payloads through the canonical browser command registry", () => {
    const externalOpen = vi.fn();
    const services = createStorybookBrowserServices("macos", { externalOpen });
    const initialTabCount = useBrowserStore.getState().tabs.length;

    expect(handleNativeMenuCommand("new-tab", services)).toBe(true);
    expect(useBrowserStore.getState().tabs).toHaveLength(initialTabCount + 1);

    expect(handleNativeMenuCommand("open-generation-settings", services)).toBe(true);
    expect(useBrowserStore.getState().tabs.find((tab) => tab.id === useBrowserStore.getState().activeTabId)?.location)
      .toBe("vibe://settings/generation");

    expect(handleNativeMenuCommand("vertical-tabs", services)).toBe(true);
    expect(useBrowserStore.getState().preferences.tabLayout).toBe("vertical");

    expect(handleNativeMenuCommand("open-github", services)).toBe(true);
    expect(externalOpen).toHaveBeenCalledWith("https://github.com/ozio/vibesurfer");
  });

  it("rejects unknown and UI-only payloads", () => {
    const services = createStorybookBrowserServices("macos");

    expect(isNativeMenuCommand("javascript:alert(1)")).toBe(false);
    expect(isNativeMenuCommand("new-tab-right")).toBe(false);
    expect(handleNativeMenuCommand({ command: "new-tab" }, services)).toBe(false);
  });
});
