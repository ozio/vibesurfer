import { detectPlatform, externalHttpUrl, isTauri } from "../lib/platform";
import type { Platform } from "../types/browser";
import type {
  BrowserNativeMenuState,
  BrowserNativeWindowTheme,
  BrowserServices,
  BrowserWindowAction,
} from "./browser-services";

const NATIVE_MENU_EVENT = "vibesurfer://native-menu";

export interface StorybookBrowserServiceSpies {
  externalOpen?: (url: string) => void;
  windowAction?: (action: BrowserWindowAction) => void;
  applyTheme?: (theme: BrowserNativeWindowTheme) => void;
  nativeMenuUpdate?: (state: BrowserNativeMenuState) => void;
}

export function createBrowserServices(platform = detectPlatform()): BrowserServices {
  return isTauri()
    ? createTauriBrowserServices(platform)
    : createWebBrowserServices(platform);
}

export function createTauriBrowserServices(platform = detectPlatform()): BrowserServices {
  return {
    runtime: "tauri",
    platform,
    external: {
      open: async (value) => {
        const url = externalHttpUrl(value);
        if (!url) return false;
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
        return true;
      },
    },
    window: {
      perform: async (action) => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow()[action]();
      },
      applyTheme: async (theme) => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_window_corner_radius", { radius: theme.cornerRadius });
      },
    },
    nativeMenu: {
      listen: async (handler) => {
        const { listen } = await import("@tauri-apps/api/event");
        return listen<unknown>(NATIVE_MENU_EVENT, (event) => handler(event.payload));
      },
      update: async (menuState) => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("update_native_menu_state", { menuState });
      },
    },
  };
}

export function createWebBrowserServices(
  platform = detectPlatform(),
  openWindow: Pick<Window, "open"> | undefined = typeof window === "undefined" ? undefined : window,
): BrowserServices {
  return {
    runtime: "web",
    platform,
    external: {
      open: async (value) => {
        const url = externalHttpUrl(value);
        if (!url || !openWindow) return false;
        openWindow.open(url, "_blank", "noopener,noreferrer");
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
}

export function createStorybookBrowserServices(
  platform: Platform,
  spies: StorybookBrowserServiceSpies = {},
): BrowserServices {
  return {
    runtime: "storybook",
    platform,
    external: {
      open: async (value) => {
        const url = externalHttpUrl(value);
        if (!url) return false;
        spies.externalOpen?.(url);
        return false;
      },
    },
    window: {
      perform: async (action) => {
        spies.windowAction?.(action);
      },
      applyTheme: async (theme) => {
        spies.applyTheme?.(theme);
      },
    },
    nativeMenu: {
      listen: async () => () => undefined,
      update: async (state) => {
        spies.nativeMenuUpdate?.(state);
      },
    },
  };
}
