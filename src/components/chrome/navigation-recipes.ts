export type BrowserNavigationRecipeId = "standard" | "classic";

export interface BrowserOmniboxRecipe {
  appearance: BrowserNavigationRecipeId;
  addressLabel?: string;
  goLabel?: string;
  showSearchIcon: boolean;
}

export interface BrowserNavigationRecipe {
  id: BrowserNavigationRecipeId;
  omnibox: BrowserOmniboxRecipe;
}

export const STANDARD_NAVIGATION_RECIPE = {
  id: "standard",
  omnibox: {
    appearance: "standard",
    showSearchIcon: true,
  },
} as const satisfies BrowserNavigationRecipe;

export const CLASSIC_NAVIGATION_RECIPE = {
  id: "classic",
  omnibox: {
    appearance: "classic",
    addressLabel: "Address",
    goLabel: "Go",
    showSearchIcon: false,
  },
} as const satisfies BrowserNavigationRecipe;

export const BROWSER_NAVIGATION_RECIPES = {
  standard: STANDARD_NAVIGATION_RECIPE,
  classic: CLASSIC_NAVIGATION_RECIPE,
} as const satisfies Record<BrowserNavigationRecipeId, BrowserNavigationRecipe>;
