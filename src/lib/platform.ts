import type { Platform } from "../types/browser";

export function detectPlatform(): Platform {
  const value = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  return "linux";
}

export function openInNewTabShortcutLabel(platform: Platform): string {
  return platform === "macos" ? "⌥↵" : "Alt+Enter";
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
