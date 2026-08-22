import { beforeEach, describe, expect, it } from "vitest";
import { migrateGenerationSettings, useBrowserStore } from "./browser-store";

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

describe("generation media settings migration", () => {
  it("maps the legacy music toggle without coupling narration or pseudo-video", () => {
    const disabled = migrateGenerationSettings({
      capabilities: { audioSpeechEnabled: false, enabled: { "pseudo-video": true } },
      voice: { musicEnabled: false },
    }, 12);
    expect(disabled.voice.musicMode).toBe("off");
    expect(disabled.capabilities.audioSpeechEnabled).toBe(false);
    expect(disabled.capabilities.enabled["pseudo-video"]).toBe(true);

    const enabled = migrateGenerationSettings({ voice: { musicEnabled: true } }, 12);
    expect(enabled.voice.musicMode).toBe("built-in");
  });

  it("keeps narration, music and external media independently configurable", () => {
    const migrated = migrateGenerationSettings({
      capabilities: { audioSpeechEnabled: false, externalMediaEnabled: true },
      voice: { musicMode: "generate-if-requested", mediaConnectionId: "media-one", availableVoiceIds: ["voice-one"] },
    }, 13);
    expect(migrated.capabilities.audioSpeechEnabled).toBe(false);
    expect(migrated.capabilities.externalMediaEnabled).toBe(true);
    expect(migrated.voice).toMatchObject({ musicMode: "generate-if-requested", mediaConnectionId: "media-one", availableVoiceIds: ["voice-one"] });
  });
});
