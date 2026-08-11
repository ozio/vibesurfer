import type { Platform } from "../types/browser";

export function detectPlatform(): Platform {
  const value = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  return "linux";
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
