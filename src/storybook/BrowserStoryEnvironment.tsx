import { useLayoutEffect, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Tooltip } from "radix-ui";
import type {
  ColorScheme,
  Density,
  Platform,
  TabLayout,
  ThemeId,
} from "../types/browser";

export type StoryMotion = "full" | "reduced";

export interface BrowserStoryGlobals {
  theme: ThemeId;
  scheme: ColorScheme;
  platform: Platform;
  density: Density;
  tabs: TabLayout;
  motion: StoryMotion;
}

export const DEFAULT_BROWSER_STORY_GLOBALS: BrowserStoryGlobals = {
  theme: "native",
  scheme: "light",
  platform: "macos",
  density: "comfortable",
  tabs: "horizontal",
  motion: "reduced",
};

export function readBrowserStoryGlobals(globals: Record<string, unknown>): BrowserStoryGlobals {
  return {
    theme: themeValue(globals.theme),
    scheme: colorSchemeValue(globals.scheme),
    platform: platformValue(globals.platform),
    density: densityValue(globals.density),
    tabs: tabLayoutValue(globals.tabs),
    motion: globals.motion === "full" ? "full" : "reduced",
  };
}

export const withBrowserStoryEnvironment: Decorator = (Story, context) => {
  const globals = readBrowserStoryGlobals(context.globals);
  const signature = JSON.stringify(globals);

  return (
    <BrowserStoryEnvironment key={`${context.id}:${signature}`} globals={globals} storyId={context.id}>
      <Story />
    </BrowserStoryEnvironment>
  );
};

function BrowserStoryEnvironment({
  children,
  globals,
  storyId,
}: {
  children: ReactNode;
  globals: BrowserStoryGlobals;
  storyId: string;
}) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = {
      theme: root.dataset.theme,
      platform: root.dataset.platform,
      tabs: root.dataset.tabs,
      density: root.dataset.density,
      colorScheme: root.dataset.colorScheme,
      runtime: root.dataset.runtime,
      reduceMotion: root.classList.contains("reduce-motion"),
    };

    root.dataset.theme = globals.theme;
    root.dataset.platform = globals.platform;
    root.dataset.tabs = globals.tabs;
    root.dataset.density = globals.density;
    root.dataset.colorScheme = globals.scheme;
    root.dataset.runtime = "web";
    root.classList.toggle("reduce-motion", globals.motion === "reduced");

    return () => {
      restoreDataset(root, "theme", previous.theme);
      restoreDataset(root, "platform", previous.platform);
      restoreDataset(root, "tabs", previous.tabs);
      restoreDataset(root, "density", previous.density);
      restoreDataset(root, "colorScheme", previous.colorScheme);
      restoreDataset(root, "runtime", previous.runtime);
      root.classList.toggle("reduce-motion", previous.reduceMotion);
    };
  }, [globals]);

  return (
    <MemoryRouter key={storyId}>
      <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
        {children}
      </Tooltip.Provider>
    </MemoryRouter>
  );
}

function restoreDataset(
  root: HTMLElement,
  key: "theme" | "platform" | "tabs" | "density" | "colorScheme" | "runtime",
  value: string | undefined,
) {
  if (value === undefined) {
    delete root.dataset[key];
  } else {
    root.dataset[key] = value;
  }
}

function themeValue(value: unknown): ThemeId {
  return value === "sedative" || value === "ie-classic" || value === "cyberpunk"
    ? value
    : "native";
}

function colorSchemeValue(value: unknown): ColorScheme {
  return value === "dark" || value === "system" ? value : "light";
}

function platformValue(value: unknown): Platform {
  return value === "windows" || value === "linux" ? value : "macos";
}

function densityValue(value: unknown): Density {
  return value === "compact" ? "compact" : "comfortable";
}

function tabLayoutValue(value: unknown): TabLayout {
  return value === "vertical" ? "vertical" : "horizontal";
}
