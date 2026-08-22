import { systemFavicon } from "./favicon";
import type { HistoryEntry, TabKind, VirtualLocation } from "../types/browser";

export type NavigationTarget = Omit<HistoryEntry, "id" | "artifactId" | "generationJobId"> & {
  requiresGeneration: boolean;
};

export interface ResolveNavigationOptions {
  baseUrl?: string;
}

const HTTP_SCHEME = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const RELATIVE_REFERENCE = /^(?:\/|\.\/|\.\.\/|\?|#)/;
const DOMAIN = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[a-f\d:]+\]|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)(?::\d+)?(?:[/?#]|$)/iu;

export function looksLikeUrl(value: string) {
  const input = value.trim();
  return input.startsWith("vibe://") || Boolean(normalizeVirtualUrl(input));
}

export function isExplicitRelativeReference(value: string) {
  return RELATIVE_REFERENCE.test(value.trim());
}

export function normalizeVirtualUrl(rawValue: string, baseUrl?: string): VirtualLocation | undefined {
  const value = repairEscapedNavigationUrl(rawValue);
  if (!value) return undefined;

  const base = baseUrl ? parseHttpUrl(baseUrl) : undefined;
  let candidate: URL | undefined;

  try {
    if (HTTP_SCHEME.test(value)) {
      candidate = new URL(value);
    } else if (value.startsWith("//")) {
      candidate = new URL(`${base?.protocol ?? "https:"}${value}`);
    } else if (base && !ANY_SCHEME.test(value)) {
      candidate = new URL(value, base);
    } else if (!ANY_SCHEME.test(value) && DOMAIN.test(value)) {
      candidate = new URL(`https://${value}`);
    }
  } catch {
    return undefined;
  }

  if (!candidate || (candidate.protocol !== "http:" && candidate.protocol !== "https:")) return undefined;
  if (candidate.username || candidate.password) return undefined;

  candidate.hostname = candidate.hostname.toLowerCase();
  const url = candidate.href;
  return {
    url,
    origin: candidate.origin,
    pathname: candidate.pathname || "/",
    search: candidate.search,
    hash: candidate.hash,
  };
}

export function repairEscapedNavigationUrl(rawValue: string) {
  let value = rawValue.trim();
  if ((value.startsWith('\\"') && value.endsWith('\\"')) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    const wrapperLength = value.startsWith('\\"') ? 2 : 1;
    value = value.slice(wrapperLength, -wrapperLength);
  }

  const absoluteWrapper = /^(https?:\/\/[^/?#]+)\/(?:(?:%5c)|\\)*%22\/?(?=#|$|[^/])/i;
  const relativeWrapper = /^\/(?:(?:%5c)|\\)*%22\/?(?=#|$|[^/])/i;
  const encodedWrapperEnd = /(?:(?:%5c)|\\)*%22$/i;
  const hadEncodedWrapper = (absoluteWrapper.test(value) || relativeWrapper.test(value))
    && encodedWrapperEnd.test(value);
  if (hadEncodedWrapper) {
    value = value
      .replace(absoluteWrapper, "$1/")
      .replace(relativeWrapper, "/")
      .replace(encodedWrapperEnd, "");
  }
  return value;
}

export function resolveVirtualLink(href: string, baseUrl: string) {
  return normalizeVirtualUrl(href, baseUrl);
}

export function isSameVirtualDocument(left: string, right: string) {
  const leftUrl = normalizeVirtualUrl(left);
  const rightUrl = normalizeVirtualUrl(right);
  if (!leftUrl || !rightUrl) return false;
  return stripHash(leftUrl.url) === stripHash(rightUrl.url);
}

export function resolveNavigation(
  rawValue: string,
  modelId: string,
  options: ResolveNavigationOptions = {},
): NavigationTarget {
  const value = rawValue.trim();

  if (!value || value === "vibe://new-tab") {
    return {
      location: "vibe://new-tab",
      title: "New tab",
      kind: "new-tab",
      favicon: systemFavicon("new-tab"),
      requiresGeneration: false,
    };
  }

  if (value.startsWith("vibe://settings")) {
    return {
      location: value,
      title: "Settings",
      kind: "settings",
      favicon: systemFavicon("settings"),
      requiresGeneration: false,
    };
  }

  if (value === "vibe://history") {
    return {
      location: value,
      title: "History",
      kind: "history",
      favicon: systemFavicon("history"),
      requiresGeneration: false,
    };
  }

  if (value.startsWith("vibe://activity")) {
    return {
      location: value,
      title: "Generation activity",
      kind: "activity",
      favicon: systemFavicon("activity"),
      requiresGeneration: false,
    };
  }

  if (value === "vibe://capabilities") {
    return {
      location: value,
      title: "Capability lab",
      kind: "capabilities",
      favicon: systemFavicon("capabilities"),
      requiresGeneration: false,
    };
  }

  if (value === "vibe://generation-debug") {
    return {
      location: value,
      title: "Generation debug",
      kind: "generation-debug",
      favicon: systemFavicon("generation-debug"),
      requiresGeneration: false,
    };
  }

  if (value.startsWith("vibe://generated/")) {
    return {
      location: value,
      title: truncate(value.slice("vibe://generated/".length).replaceAll("-", " "), 34),
      kind: "generated",
      favicon: generatedFavicon(modelId),
      requiresGeneration: false,
    };
  }

  const virtualLocation = normalizeVirtualUrl(value, options.baseUrl);
  if (virtualLocation) {
    const baseLocation = options.baseUrl ? normalizeVirtualUrl(options.baseUrl) : undefined;
    return {
      location: virtualLocation.url,
      title: readableHost(virtualLocation.url),
      kind: "generated",
      favicon: generatedFavicon(modelId),
      virtualLocation,
      requiresGeneration: !baseLocation || !isSameVirtualDocument(baseLocation.url, virtualLocation.url),
    };
  }

  return {
    location: `vibe://generated/${slugify(value)}`,
    title: truncate(value, 34),
    kind: "generated",
    prompt: value,
    favicon: generatedFavicon(modelId),
    requiresGeneration: true,
  };
}

export function resolveRealNavigation(rawValue: string): NavigationTarget {
  const virtualLocation = normalizeVirtualUrl(rawValue);
  if (!virtualLocation) throw new TypeError("Real-web navigation requires an HTTP(S) URL or domain");
  return {
    location: virtualLocation.url,
    title: readableHost(virtualLocation.url),
    kind: "remote",
    virtualLocation,
    requiresGeneration: false,
  };
}

export function readableHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

export function tabKindForSettings(section: string): { location: string; kind: TabKind; title: string } {
  return {
    location: `vibe://settings/${section}`,
    kind: "settings",
    title: "Settings",
  };
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function stripHash(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function generatedFavicon(modelId: string) {
  return modelId.startsWith("codex") ? "✦" : "◆";
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z\d]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "untitled";
}

export function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
