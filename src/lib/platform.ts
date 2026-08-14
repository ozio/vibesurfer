import type { Platform, ThemeId } from "../types/browser";

export interface BrowserShortcutLabels {
  focusAddress: string;
  newTab: string;
  openInNewTab: string;
  settings: string;
  usesMacSymbols: boolean;
}

export function detectPlatform(): Platform {
  const value = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  return "linux";
}

export function browserShortcutLabels(platform: Platform, _theme: ThemeId): BrowserShortcutLabels {
  const usesMacSymbols = platform === "macos";

  return usesMacSymbols
    ? {
        focusAddress: "⌘L",
        newTab: "⌘T",
        openInNewTab: "⌥↵",
        settings: "⌘,",
        usesMacSymbols,
      }
    : {
        focusAddress: "Ctrl+L",
        newTab: "Ctrl+T",
        openInNewTab: "Alt+Enter",
        settings: "Ctrl+,",
        usesMacSymbols,
      };
}

export function nativeWindowCornerRadius(theme: ThemeId): number {
  if (theme === "ie-classic") return 0;
  if (theme === "sedative") return 28;
  if (theme === "cyberpunk") return 4;
  return 12;
}

export async function syncNativeWindowTheme(theme: ThemeId): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_window_corner_radius", { radius: nativeWindowCornerRadius(theme) });
}

export const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

export function externalHttpUrl(value: string): string | undefined {
  if (value.length > 4_096 || value !== value.trim()) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function windowAction(action: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}

export async function openExternal(url: string): Promise<boolean> {
  const safeUrl = externalHttpUrl(url);
  if (!safeUrl) return false;
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(safeUrl);
    return true;
  }

  window.open(safeUrl, "_blank", "noopener,noreferrer");
  return true;
}
