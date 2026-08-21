import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserStore } from "../store/browser-store";
import { openBlankTabAndFocus } from "./browser-actions";

const initialState = useBrowserStore.getInitialState();

beforeEach(() => {
  useBrowserStore.setState(initialState, true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
});

describe("new tab focus", () => {
  it("waits for the commit boundary and requests address selection", () => {
    const listener = vi.fn();
    window.addEventListener("vibesurfer:focus-address", listener, { once: true });
    const id = openBlankTabAndFocus();
    expect(useBrowserStore.getState().tabs.at(-1)?.id).toBe(id);
    expect(useBrowserStore.getState().activeTabId).toBe(id);
    expect(listener).toHaveBeenCalledOnce();
  });
});
