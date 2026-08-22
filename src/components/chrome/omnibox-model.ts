import type { BrowserExperienceDefinition } from "../../browser/browser-experience-registry";
import { looksLikeUrl } from "../../lib/navigation";
import type { BrowserTab } from "../../types/browser";

export type OmniboxSuggestionKind = "query" | "address" | "tab" | "settings";

export type OmniboxSuggestionAction =
  | { type: "navigate"; value: string }
  | { type: "switch-tab"; tabId: string }
  | { type: "settings"; section: string };

export interface OmniboxSuggestion {
  id: string;
  kind: OmniboxSuggestionKind;
  label: string;
  detail: string;
  action: OmniboxSuggestionAction;
}

export interface SiteInformation {
  title: string;
  status: string;
  location: string;
  note: string;
}

export interface BuildOmniboxSuggestionsOptions {
  value: string;
  currentTabId: string;
  tabs: readonly BrowserTab[];
  language: BrowserExperienceDefinition["chrome"]["address"];
  limit?: number;
}

const SETTINGS_KEYWORDS = [
  "appearance",
  "browser",
  "preferences",
  "profiles",
  "settings",
  "theme",
  "themes",
  "vibe",
];

export function buildOmniboxSuggestions({
  value,
  currentTabId,
  tabs,
  language,
  limit = 6,
}: BuildOmniboxSuggestionsOptions): OmniboxSuggestion[] {
  const query = value.trim();
  const normalizedQuery = query.toLocaleLowerCase();
  const suggestions: OmniboxSuggestion[] = [];

  if (query) {
    const address = looksLikeUrl(query);
    suggestions.push({
      id: address ? "address" : "query",
      kind: address ? "address" : "query",
      label: address ? `Open ${query}` : `Search ${language.network} for “${query}”`,
      detail: address ? language.addressDetail : language.queryDetail,
      action: { type: "navigate", value: query },
    });
  } else {
    const starterIsAddress = looksLikeUrl(language.starterAddress);
    suggestions.push({
      id: "starter",
      kind: starterIsAddress ? "address" : "query",
      label: language.starterLabel,
      detail: language.starterDetail,
      action: { type: "navigate", value: language.starterAddress },
    });
  }

  let matchingTabCount = 0;
  for (const tab of tabs) {
    if (tab.id === currentTabId) continue;
    const searchable = `${tab.title} ${tab.location}`.toLocaleLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;
    suggestions.push({
      id: `tab:${tab.id}`,
      kind: "tab",
      label: tab.title,
      detail: "Switch to tab",
      action: { type: "switch-tab", tabId: tab.id },
    });
    matchingTabCount += 1;
    if (matchingTabCount >= 3) break;
  }

  if (!normalizedQuery || matchesSettings(normalizedQuery)) {
    suggestions.push({
      id: "settings:profiles",
      kind: "settings",
      label: "Profiles & appearance",
      detail: "Chrome skin, density, animations and vibe",
      action: { type: "settings", section: "profiles" },
    });
  }

  return suggestions.slice(0, Math.max(0, limit));
}

function matchesSettings(query: string): boolean {
  const terms = query.split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => (
    SETTINGS_KEYWORDS.some((keyword) => keyword.startsWith(term))
  ));
}

export function committedOmniboxValue(tab: BrowserTab): string {
  if (tab.kind === "new-tab") return "";
  return tab.kind === "generated" && tab.prompt ? tab.prompt : tab.location;
}

export function siteInformationForTab(tab: BrowserTab): SiteInformation {
  const location = tab.virtualLocation?.url ?? tab.location;

  if (tab.kind === "generated") {
    return {
      title: "Hallunet address",
      status: "Discovered route · isolated locally",
      location,
      note: "This route continues inside the Hallunet and cannot contact the live web.",
    };
  }

  if (tab.kind === "remote") {
    return {
      title: "Unresolved address",
      status: "Outside network · not connected",
      location,
      note: "This coordinate remains isolated. External sites open only in your system browser.",
    };
  }

  return {
    title: tab.kind === "settings" ? "Local settings" : "Hallunet gateway",
    status: tab.kind === "settings" ? "vibesurfer · local interface" : "Unmapped network",
    location,
    note: "This gateway is local and does not contact the live web.",
  };
}
