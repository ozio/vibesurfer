import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import {
  BROWSER_EXPERIENCE_REGISTRY,
  isThemeId,
  type ThemeId,
} from "./browser-experience-registry";
import { useBrowserServices } from "./browser-services";
import type { ColorScheme, Density, TabLayout } from "../types/browser";

export interface BrowserThemeRootProps {
  theme: ThemeId;
  colorScheme: ColorScheme;
  density: Density;
  tabLayout: TabLayout;
  motion: "full" | "reduced";
  children: ReactNode;
}

const BrowserThemeRootContext = createContext(false);

export function BrowserThemeRoot({
  theme,
  colorScheme,
  density,
  tabLayout,
  motion,
  children,
}: BrowserThemeRootProps) {
  const nested = useContext(BrowserThemeRootContext);
  const services = useBrowserServices();

  useLayoutEffect(() => {
    if (nested) return;
    const previousTheme = document.documentElement.dataset.theme;
    return () => {
      if (isThemeId(previousTheme)) {
        void services.window.applyTheme(BROWSER_EXPERIENCE_REGISTRY[previousTheme].nativeWindow).catch(() => undefined);
      }
    };
  }, [nested, services]);

  useLayoutEffect(() => {
    if (nested) return;
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

    root.dataset.theme = theme;
    root.dataset.platform = services.platform;
    root.dataset.tabs = tabLayout;
    root.dataset.density = density;
    root.dataset.colorScheme = colorScheme;
    root.dataset.runtime = services.runtime;
    root.classList.toggle("reduce-motion", motion === "reduced");

    return () => {
      restoreDataset(root, "theme", previous.theme);
      restoreDataset(root, "platform", previous.platform);
      restoreDataset(root, "tabs", previous.tabs);
      restoreDataset(root, "density", previous.density);
      restoreDataset(root, "colorScheme", previous.colorScheme);
      restoreDataset(root, "runtime", previous.runtime);
      root.classList.toggle("reduce-motion", previous.reduceMotion);
    };
  }, [colorScheme, density, motion, nested, services.platform, services.runtime, tabLayout, theme]);

  useLayoutEffect(() => {
    if (nested) return;
    void services.window.applyTheme(BROWSER_EXPERIENCE_REGISTRY[theme].nativeWindow).catch((error: unknown) => {
      console.warn("Could not apply the native window shape", error);
    });
  }, [nested, services, theme]);

  return (
    <BrowserThemeRootContext.Provider value>
      {children}
    </BrowserThemeRootContext.Provider>
  );
}

function restoreDataset(
  root: HTMLElement,
  key: "theme" | "platform" | "tabs" | "density" | "colorScheme" | "runtime",
  value: string | undefined,
) {
  if (value === undefined) delete root.dataset[key];
  else root.dataset[key] = value;
}
