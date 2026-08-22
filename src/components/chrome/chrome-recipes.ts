import { BROWSER_EXPERIENCE_REGISTRY, type ThemeId } from "../../browser/browser-experience-registry";

export type BrowserChromeRecipeId = "standard" | "classic";

export interface BrowserChromeRecipe {
  id: BrowserChromeRecipeId;
  titleBarAppearance: BrowserChromeRecipeId;
  windowControlsAppearance: BrowserChromeRecipeId;
  horizontalTabs: "titlebar" | "tab-row";
  menuBar: boolean;
  verticalBrand: boolean;
}

export const STANDARD_CHROME_RECIPE = {
  id: "standard",
  titleBarAppearance: "standard",
  windowControlsAppearance: "standard",
  horizontalTabs: "titlebar",
  menuBar: false,
  verticalBrand: true,
} as const satisfies BrowserChromeRecipe;

export const CLASSIC_CHROME_RECIPE = {
  id: "classic",
  titleBarAppearance: "classic",
  windowControlsAppearance: "classic",
  horizontalTabs: "tab-row",
  menuBar: true,
  verticalBrand: false,
} as const satisfies BrowserChromeRecipe;

export const BROWSER_CHROME_RECIPES = {
  standard: STANDARD_CHROME_RECIPE,
  classic: CLASSIC_CHROME_RECIPE,
} as const satisfies Record<BrowserChromeRecipeId, BrowserChromeRecipe>;

export function browserChromeRecipeForTheme(theme: ThemeId): BrowserChromeRecipe {
  return BROWSER_EXPERIENCE_REGISTRY[theme].chrome.variant === "ie-classic"
    ? CLASSIC_CHROME_RECIPE
    : STANDARD_CHROME_RECIPE;
}
