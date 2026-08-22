import { useMemo, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Tooltip } from "radix-ui";
import { isThemeId } from "../browser/browser-experience-registry";
import { createStorybookBrowserServices } from "../browser/browser-service-adapters";
import { BrowserServicesProvider } from "../browser/browser-services";
import { BrowserThemeRoot } from "../browser/BrowserThemeRoot";
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
  const services = useMemo(
    () => createStorybookBrowserServices(globals.platform),
    [globals.platform],
  );

  return (
    <BrowserServicesProvider services={services}>
      <BrowserThemeRoot
        theme={globals.theme}
        colorScheme={globals.scheme}
        density={globals.density}
        tabLayout={globals.tabs}
        motion={globals.motion}
      >
        <MemoryRouter key={storyId}>
          <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
            {children}
          </Tooltip.Provider>
        </MemoryRouter>
      </BrowserThemeRoot>
    </BrowserServicesProvider>
  );
}

function themeValue(value: unknown): ThemeId {
  return isThemeId(value) ? value : "native";
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
