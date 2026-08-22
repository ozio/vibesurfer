import { createContext, useContext, type ReactNode } from "react";
import type { BrowserExperienceDefinition } from "./browser-experience-registry";
import { detectPlatform, externalHttpUrl } from "../lib/platform";
import type { Platform } from "../types/browser";

export type BrowserRuntime = "tauri" | "web" | "storybook";
export type BrowserWindowAction = "minimize" | "toggleMaximize" | "close";
export type BrowserNativeWindowTheme = BrowserExperienceDefinition["nativeWindow"];

export interface BrowserNativeMenuState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isGenerated: boolean;
  isArchived: boolean;
  hasLiveSite: boolean;
  horizontalTabs: boolean;
}

export interface BrowserServices {
  runtime: BrowserRuntime;
  platform: Platform;
  external: {
    open: (url: string) => Promise<boolean>;
  };
  window: {
    perform: (action: BrowserWindowAction) => Promise<void>;
    applyTheme: (theme: BrowserNativeWindowTheme) => Promise<void>;
  };
  nativeMenu: {
    listen: (handler: (command: unknown) => void) => Promise<() => void>;
    update: (state: BrowserNativeMenuState) => Promise<void>;
  };
}

const standaloneWebServices: BrowserServices = {
  runtime: "web",
  platform: typeof navigator === "undefined" ? "linux" : detectPlatform(),
  external: {
    open: async (value) => {
      const url = externalHttpUrl(value);
      if (!url || typeof window === "undefined") return false;
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
  },
  window: {
    perform: async () => undefined,
    applyTheme: async () => undefined,
  },
  nativeMenu: {
    listen: async () => () => undefined,
    update: async () => undefined,
  },
};

const BrowserServicesContext = createContext<BrowserServices>(standaloneWebServices);

export function BrowserServicesProvider({
  services,
  children,
}: {
  services: BrowserServices;
  children: ReactNode;
}) {
  return (
    <BrowserServicesContext.Provider value={services}>
      {children}
    </BrowserServicesContext.Provider>
  );
}

export function useBrowserServices(): BrowserServices {
  return useContext(BrowserServicesContext);
}

export function withBrowserServicePlatform(
  services: BrowserServices,
  platform: Platform,
): BrowserServices {
  return services.platform === platform ? services : { ...services, platform };
}
