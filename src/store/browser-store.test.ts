import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserStore } from "./browser-store";

const initialState = useBrowserStore.getInitialState();

beforeEach(() => useBrowserStore.setState(initialState, true));

describe("tab placement", () => {
  it("puts ordinary new tabs at the end regardless of the active tab", () => {
    const store = useBrowserStore.getState();
    const first = store.tabs[0]!.id;
    store.activateTab(first);
    const id = useBrowserStore.getState().addTab(undefined, { placement: "end" });
    expect(useBrowserStore.getState().tabs.at(-1)?.id).toBe(id);
    expect(useBrowserStore.getState().activeTabId).toBe(id);
  });

  it("keeps explicit opener links immediately after their source tab", () => {
    const store = useBrowserStore.getState();
    const opener = store.tabs[0]!;
    const id = store.addTab("https://example.com/child", { disposition: "background-tab", placement: "after-opener", opener: { tabId: opener.id, artifactId: opener.artifactId } });
    const tabs = useBrowserStore.getState().tabs;
    expect(tabs[tabs.findIndex((tab) => tab.id === opener.id) + 1]?.id).toBe(id);
    expect(useBrowserStore.getState().activeTabId).toBe(store.activeTabId);
  });
});
