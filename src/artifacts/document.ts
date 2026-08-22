import type { ArtifactRenderPayload } from "./bridge-protocol";
import { repairEscapedNavigationUrl } from "../lib/navigation";
import type { ThemeId, VoiceAudioSettings } from "../types/browser";
import type { DynamicManifest } from "../types/browser";

const BLOCKED_ELEMENTS = [
  "base",
  "object",
  "embed",
  "iframe",
  "frame",
  "frameset",
  "applet",
  "portal",
  "template",
  "foreignObject",
].join(",");

const URL_ATTRIBUTES = new Set(["href", "src", "action", "poster", "cite", "background"]);
const REMOVED_ATTRIBUTES = new Set([
  "srcdoc",
  "ping",
  "download",
  "formaction",
  "formtarget",
  "nonce",
  "integrity",
  "autofocus",
  "autoplay",
]);
const MAX_DATA_URL_LENGTH = 2 * 1024 * 1024;
export interface GeneratedArtifactDocumentInput {
  artifactId: string;
  url: string;
  title: string;
  html: string;
  nonce?: string;
  allowGeneratedScripts?: boolean;
  browserTheme?: ThemeId;
  dynamicManifest?: DynamicManifest;
  voiceSettings?: VoiceAudioSettings;
  mediaPermissions?: ArtifactRenderPayload["mediaPermissions"];
}

export type ArtifactSanitizationWarningCode =
  | "removed-element"
  | "removed-meta-directive"
  | "removed-link-resource"
  | "removed-event-handler"
  | "removed-attribute"
  | "removed-unsafe-url"
  | "rewrote-url"
  | "sanitized-css";

export interface ArtifactSanitizationWarning {
  code: ArtifactSanitizationWarningCode;
  count: number;
}

export interface GeneratedArtifactDocument {
  artifactId: string;
  nonce: string;
  payload: ArtifactRenderPayload;
  srcDoc: string;
  warnings: ArtifactSanitizationWarning[];
}

export function compileGeneratedArtifactDocument(
  input: GeneratedArtifactDocumentInput,
): GeneratedArtifactDocument {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(repairEscapedFormattingInsideTags(input.html), "text/html");
  const repairedEscapedAttributes = repairLegacyEscapedAttributes(parsed);
  normalizeEscapedFormatting(parsed, repairedEscapedAttributes);
  const warnings = new WarningCollector();
  const artifactId = normalizeArtifactId(input.artifactId);
  const pageUrl = normalizePageUrl(input.url);
  const nonce = normalizeBridgeNonce(input.nonce) ?? createBridgeNonce();
  const title = normalizeTitle(input.title);

  const allowGeneratedScripts = input.allowGeneratedScripts === true;
  sanitizeDocument(parsed, pageUrl, warnings, allowGeneratedScripts);
  installDocumentMetadata(parsed, title, input.browserTheme);
  const srcDoc = `<!doctype html>\n${parsed.documentElement.outerHTML}`;

  return {
    artifactId,
    nonce,
    payload: {
      revision: 1,
      renderMode: "final",
      pageUrl,
      title,
      html: srcDoc,
      executeScripts: allowGeneratedScripts,
      ...(input.dynamicManifest ? { dynamicManifest: input.dynamicManifest } : {}),
      ...(input.voiceSettings ? { voiceSettings: {
        musicMode: input.voiceSettings.musicMode,
      } } : {}),
      ...(input.mediaPermissions ? { mediaPermissions: input.mediaPermissions } : {}),
    },
    srcDoc,
    warnings: warnings.toArray(),
  };
}

function repairEscapedFormattingInsideTags(html: string): string {
  let result = "";
  let inTag = false;
  let quote = "";
  for (let index = 0; index < html.length; index += 1) {
    const character = html[index] ?? "";
    if (!inTag && character === "<") inTag = true;
    if (inTag && (character === '"' || character === "'") && html[index - 1] !== "\\") {
      quote = quote === character ? "" : quote || character;
    }
    if (inTag && character === "\\") {
      const escape = html[index + 1];
      if (escape === "n" || escape === "r" || escape === "t") {
        result += escape === "t" ? "\t" : "\n";
        index += 1;
        continue;
      }
    }
    result += character;
    if (inTag && character === ">" && !quote) inTag = false;
  }
  return result;
}

function repairLegacyEscapedAttributes(document: Document) {
  const elements = Array.from(document.querySelectorAll("*"));
  const escapedValueCount = elements.reduce(
    (count, element) => count + Array.from(element.attributes)
      .filter((attribute) => attribute.value.startsWith('\\"')).length,
    0,
  );
  if (escapedValueCount < 2) return false;

  for (const element of elements) {
    const attributes = Array.from(element.attributes);
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes[index];
      if (!attribute.value.startsWith('\\"')) continue;

      let value = attribute.value.slice(2);
      let closed = value.endsWith('\\"');
      if (closed) value = value.slice(0, -2);
      const consumed: Attr[] = [];

      for (let tail = index + 1; !closed && tail < attributes.length; tail += 1) {
        const continuation = attributes[tail];
        let continuationName = continuation.name;
        let continuationValue = continuation.value;
        if (continuationName.endsWith('\\"')) {
          continuationName = continuationName.slice(0, -2);
          closed = true;
        } else if (continuationValue.endsWith('\\"')) {
          continuationValue = continuationValue.slice(0, -2);
          closed = true;
        }
        value += ` ${continuationName}${continuationValue ? `=${continuationValue}` : ""}`;
        consumed.push(continuation);
      }

      if (!closed) continue;
      element.setAttribute(attribute.name, value);
      for (const continuation of consumed) element.removeAttribute(continuation.name);
      index += consumed.length;
    }
  }
  return true;
}

function normalizeEscapedFormatting(document: Document, repairEscapedQuotes = false) {
  const textNodes = document.createTreeWalker(document, 4);
  let node = textNodes.nextNode();
  while (node) {
    const value = node.nodeValue;
    if (value) {
      let normalized = value
        .replace(/\\r\\n|\\n|\\r/g, "\n")
        .replace(/\\t/g, "\t");
      if (repairEscapedQuotes && node.parentElement?.tagName === "STYLE") {
        normalized = normalized.replace(/\\"/g, '"');
      }
      node.nodeValue = normalized;
    }
    node = textNodes.nextNode();
  }
}

function sanitizeDocument(
  document: Document,
  pageUrl: string,
  warnings: WarningCollector,
  allowGeneratedScripts: boolean,
) {
  for (const element of document.querySelectorAll(BLOCKED_ELEMENTS)) {
    element.remove();
    warnings.add("removed-element");
  }

  for (const meta of document.querySelectorAll("meta[http-equiv]")) {
    meta.remove();
    warnings.add("removed-meta-directive");
  }

  for (const link of document.querySelectorAll("link")) {
    link.remove();
    warnings.add("removed-link-resource");
  }

  for (const script of document.querySelectorAll("script")) {
    const type = script.getAttribute("type")?.trim().toLowerCase() ?? "";
    const classicScript = !type || type === "text/javascript" || type === "application/javascript";
    if (!allowGeneratedScripts || script.hasAttribute("src") || !classicScript) {
      script.remove();
      warnings.add("removed-element");
      continue;
    }
    for (const attribute of Array.from(script.attributes)) script.removeAttribute(attribute.name);
  }

  for (const style of document.querySelectorAll("style")) {
    const original = style.textContent ?? "";
    const sanitized = sanitizeCss(original);
    if (sanitized !== original) warnings.add("sanitized-css");
    style.textContent = sanitized;
  }

  for (const element of document.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        warnings.add("removed-event-handler");
        continue;
      }
      if (REMOVED_ATTRIBUTES.has(name) || name === "srcset") {
        element.removeAttribute(attribute.name);
        warnings.add("removed-attribute");
        continue;
      }
      if (name === "style") {
        const sanitized = sanitizeCss(attribute.value);
        if (sanitized !== attribute.value) warnings.add("sanitized-css");
        if (sanitized) element.setAttribute("style", sanitized);
        else element.removeAttribute("style");
        continue;
      }
      if (URL_ATTRIBUTES.has(name) || name === "xlink:href") {
        sanitizeUrlAttribute(element, attribute.name, attribute.value, pageUrl, warnings);
      }
    }

    if (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement) {
      const rel = new Set(element.rel.toLowerCase().split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      element.rel = [...rel].filter((token) => ["license", "noopener", "noreferrer"].includes(token)).join(" ");
      const target = element.getAttribute("target");
      if (target && target !== "_blank" && target !== "_self") element.removeAttribute("target");
    }
    if (element instanceof HTMLFormElement) element.removeAttribute("target");
  }
}

function sanitizeUrlAttribute(
  element: Element,
  attributeName: string,
  rawValue: string,
  pageUrl: string,
  warnings: WarningCollector,
) {
  const name = attributeName.toLowerCase();
  const originalValue = rawValue.trim();
  const value = repairTrailingSelfLinkQuote(
    repairEscapedNavigationUrl(rawValue),
    pageUrl,
  );
  if (!value) {
    element.removeAttribute(attributeName);
    warnings.add("removed-unsafe-url");
    return;
  }
  if (hasMalformedNavigationEscaping(value)) {
    element.removeAttribute(attributeName);
    warnings.add("removed-unsafe-url");
    return;
  }

  if (name === "href" || name === "xlink:href") {
    const isNavigable = element.matches("a, area");
    if (value.startsWith("#")) {
      if (value !== originalValue) {
        element.setAttribute(attributeName, value);
        warnings.add("rewrote-url");
      }
      return;
    }
    if (!isNavigable) {
      element.removeAttribute(attributeName);
      warnings.add("removed-unsafe-url");
      return;
    }
    const resolved = resolveHttpUrl(value, pageUrl);
    if (!resolved) {
      element.removeAttribute(attributeName);
      warnings.add("removed-unsafe-url");
      return;
    }
    if (resolved !== originalValue) warnings.add("rewrote-url");
    element.setAttribute(attributeName, resolved);
    return;
  }

  if (name === "action") {
    if (!(element instanceof HTMLFormElement)) {
      element.removeAttribute(attributeName);
      warnings.add("removed-unsafe-url");
      return;
    }
    const resolved = resolveHttpUrl(value, pageUrl);
    if (!resolved) {
      element.removeAttribute(attributeName);
      warnings.add("removed-unsafe-url");
      return;
    }
    if (resolved !== originalValue) warnings.add("rewrote-url");
    element.setAttribute(attributeName, resolved);
    return;
  }

  if (element instanceof HTMLImageElement && isSafeImageAsset(value)) return;
  if (isSafeEmbeddedAsset(value)) return;
  element.removeAttribute(attributeName);
  warnings.add("removed-unsafe-url");
}

function hasMalformedNavigationEscaping(value: string) {
  return /\\(?:"|%22)|%5c%22|^(?:https?:\/\/[^/?#]+)?\/%22(?=\/|#|$)/i.test(value);
}

function repairTrailingSelfLinkQuote(value: string, pageUrl: string) {
  if (!/%22$/i.test(value)) return value;
  const withoutQuote = value.slice(0, -3);
  const repaired = resolveHttpUrl(withoutQuote, pageUrl);
  return repaired === pageUrl ? withoutQuote : value;
}

function installDocumentMetadata(document: Document, title: string, browserTheme?: ThemeId) {
  document.documentElement.setAttribute("data-vibesurfer-artifact", "");
  document.documentElement.removeAttribute("data-vibesurfer-browser-theme");
  if (browserTheme) document.documentElement.setAttribute("data-vibesurfer-browser-theme", browserTheme);

  for (const charset of document.head.querySelectorAll("meta[charset]")) charset.remove();
  for (const titleElement of document.head.querySelectorAll("title")) titleElement.remove();

  const charset = document.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const viewport = document.head.querySelector('meta[name="viewport"]');
  if (!viewport) {
    const viewportElement = document.createElement("meta");
    viewportElement.setAttribute("name", "viewport");
    viewportElement.setAttribute("content", "width=device-width, initial-scale=1");
    document.head.prepend(viewportElement);
  }
  const titleElement = document.createElement("title");
  titleElement.textContent = title;

  document.head.prepend(charset);
  document.head.append(titleElement);
}

function normalizePageUrl(value: string) {
  const resolved = resolveHttpUrl(repairEscapedNavigationUrl(value), "https://artifact.invalid/");
  return resolved && resolved.length <= 4_096 ? resolved : "https://artifact.invalid/";
}

function normalizeArtifactId(value: string) {
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError("Artifact identity is invalid");
  }
  return value;
}

function normalizeBridgeNonce(value: string | undefined) {
  return value && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

function resolveHttpUrl(value: string, baseUrl: string) {
  try {
    const resolved = new URL(value, baseUrl);
    return (resolved.protocol === "http:" || resolved.protocol === "https:") &&
      !resolved.username && !resolved.password ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

function isSafeEmbeddedAsset(value: string) {
  if (value.startsWith("blob:")) return true;
  if (!value.startsWith("data:")) return false;
  if (value.length > MAX_DATA_URL_LENGTH) return false;
  return /^data:(?:image\/(?:avif|gif|jpeg|jpg|png|svg\+xml|webp)|audio\/(?:mpeg|ogg|wav)|video\/(?:mp4|webm));/i.test(value);
}

function isSafeImageAsset(value: string) {
  if (isSafeEmbeddedAsset(value)) return true;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && (hostname === "loremflickr.com"
        || hostname === "www.loremflickr.com"
        || hostname === "staticflickr.com"
        || hostname.endsWith(".staticflickr.com"));
  } catch {
    return false;
  }
}

function sanitizeCss(value: string) {
  return value
    .replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*[^;]*;?/gi, "")
    .replace(/url\(\s*(["']?)(?!data:|blob:|#)[^)]*\1\s*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(?:^|;)\s*(?:behavior|-moz-binding)\s*:[^;]*/gi, "");
}

function normalizeTitle(value: string) {
  const title = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 512);
  return title || "Generated page";
}

export function createBridgeNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return encodeBridgeNonce(bytes);
}

export function encodeBridgeNonce(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

class WarningCollector {
  readonly #counts = new Map<ArtifactSanitizationWarningCode, number>();

  add(code: ArtifactSanitizationWarningCode) {
    this.#counts.set(code, (this.#counts.get(code) ?? 0) + 1);
  }

  toArray(): ArtifactSanitizationWarning[] {
    return Array.from(this.#counts, ([code, count]) => ({ code, count }));
  }
}
