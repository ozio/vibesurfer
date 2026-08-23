import { isTauri } from "../lib/platform";

export function nativeImageAssetUrl(source: string): string {
  if (!isTauri() || !isAllowlistedExternalImage(source)) return source;
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  return windows
    ? `http://vibeasset.localhost/image/${encoded}`
    : `vibeasset://localhost/image/${encoded}`;
}

export function isNativeImageAsset(source: string): boolean {
  try {
    const url = new URL(source);
    const nativeOrigin = url.protocol === "vibeasset:" && url.hostname === "localhost"
      || url.protocol === "http:" && url.hostname === "vibeasset.localhost";
    return nativeOrigin && /^\/image\/[A-Za-z0-9_-]{1,4096}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isAllowlistedExternalImage(source: string): boolean {
  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && (!url.port || url.port === "443")
      && (hostname === "loremflickr.com" || hostname === "www.loremflickr.com"
        || hostname === "staticflickr.com" || hostname.endsWith(".staticflickr.com"));
  } catch {
    return false;
  }
}
