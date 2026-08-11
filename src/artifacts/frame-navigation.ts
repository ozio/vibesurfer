import type { ArtifactNavigationDisposition } from "./bridge-protocol";

export interface ArtifactPointerNavigation {
  button: number;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export interface SameDocumentHashNavigation {
  href: string;
  hash: string;
}

export function navigationDisposition(
  event: ArtifactPointerNavigation,
  target: string,
): ArtifactNavigationDisposition {
  if (event.shiftKey) return "foreground-tab";
  if (event.button === 1 || event.metaKey || event.ctrlKey || target === "_blank") {
    return "background-tab";
  }
  return "current";
}

export function sameDocumentHashNavigation(
  pageUrl: string,
  rawHref: string,
): SameDocumentHashNavigation | undefined {
  const current = safeHttpUrl(pageUrl, pageUrl);
  const resolved = safeHttpUrl(rawHref, pageUrl);
  if (!current || !resolved) return undefined;
  const hash = rawHref.startsWith("#") ? rawHref : resolved.hash;
  if (!hash || resolved.origin !== current.origin
      || resolved.pathname !== current.pathname || resolved.search !== current.search) return undefined;
  return { href: resolved.href, hash };
}

function safeHttpUrl(raw: string, base: string) {
  try {
    const resolved = new URL(raw, base);
    return (resolved.protocol === "http:" || resolved.protocol === "https:")
      && !resolved.username && !resolved.password
      ? resolved
      : undefined;
  } catch {
    return undefined;
  }
}
