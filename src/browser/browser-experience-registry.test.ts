import { describe, expect, it } from "vitest";
import {
  BROWSER_EXPERIENCE_REGISTRY,
  BROWSER_THEME_IDS,
  BROWSER_THEME_TOOLBAR_ITEMS,
  browserSearchProvider,
  isThemeId,
} from "./browser-experience-registry";
import {
  BROWSER_THEME_IDS as WORKER_BROWSER_THEME_IDS,
  GENERATION_EXPERIENCE_REGISTRY,
} from "../../generation-worker/src/browser-experience-registry";
import { BrowserThemeSchema } from "../../generation-worker/src/domain";
import { PROFILE_PRESETS, PROFILE_PRESET_THEMES, THEME_LABELS } from "../data/catalog";
import { migrateBrowserState } from "../store/browser-store";
import { BROWSER_SHELL_CANONICAL_THEMES } from "../storybook/browser-story-fixtures";

describe("browser experience registry", () => {
  it("is the complete ordered frontend theme contract", () => {
    expect(Object.keys(BROWSER_EXPERIENCE_REGISTRY)).toEqual(BROWSER_THEME_IDS);
    expect(BROWSER_THEME_TOOLBAR_ITEMS.map((item) => item.value)).toEqual(BROWSER_THEME_IDS);
    expect(Object.values(PROFILE_PRESET_THEMES)).toEqual(BROWSER_THEME_IDS);
    expect(Object.values(PROFILE_PRESETS).map((preset) => preset.chromeSkin)).toEqual(BROWSER_THEME_IDS);
    expect(Object.keys(THEME_LABELS)).toEqual(BROWSER_THEME_IDS);
    expect(BROWSER_SHELL_CANONICAL_THEMES).toEqual(BROWSER_THEME_IDS);
    expect(new Set(BROWSER_THEME_IDS).size).toBe(BROWSER_THEME_IDS.length);
  });

  it("keeps frontend, worker registry and worker schema IDs in parity", () => {
    expect(WORKER_BROWSER_THEME_IDS).toEqual(BROWSER_THEME_IDS);
    expect(Object.keys(GENERATION_EXPERIENCE_REGISTRY)).toEqual(BROWSER_THEME_IDS);
    expect(BrowserThemeSchema.options).toEqual(BROWSER_THEME_IDS);
  });

  it("defines every reusable theme facet without component-specific switches", () => {
    for (const theme of BROWSER_THEME_IDS) {
      const experience = BROWSER_EXPERIENCE_REGISTRY[theme];
      expect(experience.chrome.toolbarLabel).not.toBe("");
      expect(experience.chrome.address.placeholder).not.toBe("");
      expect(experience.portal.routes).toHaveLength(3);
      expect(experience.generation.mockLuckyRoutes).toHaveLength(10);
      expect(experience.generation.legacyArtifact.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(experience.nativeWindow.cornerRadius).toBeGreaterThanOrEqual(0);
      expect(GENERATION_EXPERIENCE_REGISTRY[theme].fontInstruction).not.toBe("");
      expect(GENERATION_EXPERIENCE_REGISTRY[theme].fonts.length).toBeGreaterThan(5);
      expect(GENERATION_EXPERIENCE_REGISTRY[theme].compactDescription).not.toBe("");
    }
    expect(BROWSER_THEME_IDS.map((theme) => BROWSER_EXPERIENCE_REGISTRY[theme].nativeWindow.cornerRadius))
      .toEqual([12, 28, 0, 4, 6]);
  });

  it("validates IDs and resolves locale-aware search providers", () => {
    expect(isThemeId("cyberpunk")).toBe(true);
    expect(isThemeId("editorial")).toBe(true);
    expect(isThemeId("quiet")).toBe(false);
    expect(browserSearchProvider("native", false).name).toBe("Google");
    expect(browserSearchProvider("native", true).name).toBe("Яндекс");
    expect(browserSearchProvider("ie-classic", true).name).toBe("MSN Search");
  });

  it("uses registry validation when persisted theme values are migrated", () => {
    const migrated = migrateBrowserState({ preferences: { theme: "quiet" } });
    expect(migrated.preferences?.theme).toBe("native");
    expect(migrated.profiles?.[0]?.chromeSkin).toBe("native");
  });
});
