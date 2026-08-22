import { BROWSER_EXPERIENCE_REGISTRY, type ThemeId } from "../../browser/browser-experience-registry";
import {
  CLASSIC_NAVIGATION_RECIPE,
  STANDARD_NAVIGATION_RECIPE,
  type BrowserNavigationRecipe,
} from "./navigation-recipes";

export type BrowserChromeRecipeId = "standard" | "classic";

export interface BrowserChromeRecipe {
  id: BrowserChromeRecipeId;
  titleBarAppearance: BrowserChromeRecipeId;
  windowControlsAppearance: BrowserChromeRecipeId;
  horizontalTabs: "titlebar" | "tab-row";
  menuBar: boolean;
  verticalBrand: boolean;
  navigation: BrowserNavigationRecipe;
}

export const STANDARD_CHROME_RECIPE = {
  id: "standard",
  titleBarAppearance: "standard",
  windowControlsAppearance: "standard",
  horizontalTabs: "titlebar",
  menuBar: false,
  verticalBrand: true,
  navigation: STANDARD_NAVIGATION_RECIPE,
} as const satisfies BrowserChromeRecipe;

export const CLASSIC_CHROME_RECIPE = {
  id: "classic",
  titleBarAppearance: "classic",
  windowControlsAppearance: "classic",
  horizontalTabs: "tab-row",
  menuBar: true,
  verticalBrand: false,
  navigation: CLASSIC_NAVIGATION_RECIPE,
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
