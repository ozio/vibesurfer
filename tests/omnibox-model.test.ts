import { describe, expect, it } from "vitest";
import { BROWSER_EXPERIENCE_REGISTRY } from "../src/browser/browser-experience-registry";
import {
  buildOmniboxSuggestions,
  committedOmniboxValue,
  siteInformationForTab,
} from "../src/components/chrome/omnibox-model";
import { storyTab } from "../src/storybook/browser-story-fixtures";

const currentTab = storyTab({
  id: "current",
  title: "New tab",
  location: "vibe://new-tab",
  kind: "new-tab",
});
const quietTab = storyTab({
  id: "quiet",
  title: "Quiet interface",
  location: "https://quiet.vibe/ideas",
  kind: "generated",
});
const language = BROWSER_EXPERIENCE_REGISTRY.native.chrome.address;

describe("omnibox model", () => {
  it("classifies query and address input without mixing behavior into the component", () => {
    expect(suggestions("three byte metacode")[0]).toMatchObject({
      id: "query",
      kind: "query",
      action: { type: "navigate", value: "three byte metacode" },
    });
    expect(suggestions("quiet.vibe/ideas")[0]).toMatchObject({
      id: "address",
      kind: "address",
      action: { type: "navigate", value: "quiet.vibe/ideas" },
    });
    expect(suggestions("quiet.vibe/ideas").some((suggestion) => suggestion.kind === "settings")).toBe(false);
  });

  it("adds matching tab and settings actions with stable non-DOM IDs", () => {
    expect(suggestions("quiet")).toContainEqual(expect.objectContaining({
      id: "tab:quiet",
      kind: "tab",
      action: { type: "switch-tab", tabId: "quiet" },
    }));
    expect(suggestions("settings")).toContainEqual(expect.objectContaining({
      id: "settings:profiles",
      kind: "settings",
      action: { type: "settings", section: "profiles" },
    }));
  });

  it("provides the theme starter on empty input and honors a bounded limit", () => {
    expect(suggestions("", 2)).toHaveLength(2);
    expect(suggestions("", 2)[0]).toMatchObject({
      id: "starter",
      action: { type: "navigate", value: language.starterAddress },
    });
  });

  it("derives committed text and site information for browser tab kinds", () => {
    expect(committedOmniboxValue(currentTab)).toBe("");
    expect(committedOmniboxValue({ ...quietTab, prompt: "a quiet interface" })).toBe("a quiet interface");
    expect(siteInformationForTab(quietTab)).toMatchObject({
      title: "Hallunet address",
      location: "https://quiet.vibe/ideas",
    });
    expect(siteInformationForTab({ ...quietTab, kind: "remote" })).toMatchObject({
      title: "Unresolved address",
      status: "Outside network · not connected",
    });
  });
});

function suggestions(value: string, limit?: number) {
  return buildOmniboxSuggestions({
    value,
    currentTabId: currentTab.id,
    tabs: [currentTab, quietTab],
    language,
    limit,
  });
}
