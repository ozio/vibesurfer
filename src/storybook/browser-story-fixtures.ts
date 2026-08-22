import { deterministicGlyphFavicon, systemFavicon } from "../lib/favicon";
import type { BrowserTab } from "../types/browser";
import type { BrowserStoryFixture } from "./BrowserStoryHarness";

export const WELCOME_BROWSER_FIXTURE: BrowserStoryFixture = {
  tabs: [
    storyTab({
      id: "storybook-welcome",
      title: "New tab",
      location: "vibe://new-tab",
      kind: "new-tab",
      favicon: systemFavicon("new-tab"),
    }),
    storyTab({
      id: "storybook-quiet",
      title: "A quiet interface for ideas",
      location: "https://quiet.vibe/ideas",
      kind: "generated",
      favicon: deterministicGlyphFavicon("quiet.vibe", "Q"),
      generatedWith: "mock:preview",
    }),
    storyTab({
      id: "storybook-activity",
      title: "Generation activity",
      location: "vibe://activity",
      kind: "activity",
      favicon: systemFavicon("activity"),
      hasUnseenUpdate: true,
    }),
  ],
  activeTabId: "storybook-welcome",
};

export const TAB_STRIP_FIXTURE: BrowserStoryFixture = {
  tabs: [
    storyTab({
      id: "tab-active",
      title: "New tab",
      location: "vibe://new-tab",
      kind: "new-tab",
      favicon: systemFavicon("new-tab"),
    }),
    storyTab({
      id: "tab-generated",
      title: "Quiet interface",
      location: "https://quiet.vibe/ideas",
      kind: "generated",
      favicon: deterministicGlyphFavicon("quiet.vibe", "Q"),
      generatedWith: "mock:preview",
    }),
    storyTab({
      id: "tab-loading",
      title: "Building a living atlas of impossible gardens",
      location: "https://atlas.vibe/gardens",
      kind: "generated",
      loadState: "loading",
      generatedWith: "mock:preview",
    }),
    storyTab({
      id: "tab-updated",
      title: "Activity",
      location: "vibe://activity",
      kind: "activity",
      favicon: systemFavicon("activity"),
      hasUnseenUpdate: true,
    }),
  ],
  activeTabId: "tab-active",
};

export const OVERFLOW_TAB_STRIP_FIXTURE: BrowserStoryFixture = {
  tabs: Array.from({ length: 12 }, (_, index) => storyTab({
    id: `overflow-${index + 1}`,
    title: `Workspace ${index + 1}: a deliberately long generated page title`,
    location: `https://workspace-${index + 1}.vibe/page`,
    kind: "generated",
    favicon: deterministicGlyphFavicon(`workspace-${index + 1}`, String(index + 1)),
    generatedWith: "mock:preview",
  })),
  activeTabId: "overflow-1",
};

interface StoryTabInput extends Pick<BrowserTab, "id" | "title" | "location" | "kind"> {
  favicon?: BrowserTab["favicon"];
  loadState?: BrowserTab["loadState"];
  generatedWith?: string;
  hasUnseenUpdate?: boolean;
}

export function storyTab(input: StoryTabInput): BrowserTab {
  return {
    ...input,
    loadState: input.loadState ?? "idle",
    reloadKey: 0,
    history: [
      {
        id: `history-${input.id}`,
        title: input.title,
        location: input.location,
        kind: input.kind,
        favicon: input.favicon,
      },
    ],
    historyIndex: 0,
  };
}
