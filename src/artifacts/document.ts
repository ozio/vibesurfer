import type { ArtifactRenderPayload } from "./bridge-protocol";

const BLOCKED_ELEMENTS = [
  "script",
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
  const parsed = parser.parseFromString(input.html, "text/html");
  const warnings = new WarningCollector();
  const artifactId = normalizeArtifactId(input.artifactId);
  const pageUrl = normalizePageUrl(input.url);
  const nonce = normalizeBridgeNonce(input.nonce) ?? createBridgeNonce();
  const title = normalizeTitle(input.title);

  sanitizeDocument(parsed, pageUrl, warnings);
  installDocumentMetadata(parsed, title);
  const srcDoc = `<!doctype html>\n${parsed.documentElement.outerHTML}`;

  return {
    artifactId,
    nonce,
    payload: { pageUrl, title, html: srcDoc },
    srcDoc,
    warnings: warnings.toArray(),
  };
}

function sanitizeDocument(document: Document, pageUrl: string, warnings: WarningCollector) {
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
      element.rel = "noopener noreferrer";
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
  const value = rawValue.trim();
  if (!value) {
    element.removeAttribute(attributeName);
    warnings.add("removed-unsafe-url");
    return;
  }

  if (name === "href" || name === "xlink:href") {
    const isNavigable = element.matches("a, area");
    if (value.startsWith("#")) return;
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
    if (resolved !== value) warnings.add("rewrote-url");
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
    if (resolved !== value) warnings.add("rewrote-url");
    element.setAttribute(attributeName, resolved);
    return;
  }

  if (isSafeEmbeddedAsset(value)) return;
  element.removeAttribute(attributeName);
  warnings.add("removed-unsafe-url");
}

function installDocumentMetadata(document: Document, title: string) {
  document.documentElement.setAttribute("data-vibesurfer-artifact", "");

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
  const resolved = resolveHttpUrl(value, "https://artifact.invalid/");
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
