import { Buffer } from "node:buffer";

import { parse, parseFragment, serialize } from "parse5";

import { compileCapabilities } from "../capabilities/transform.js";
import type { ArtifactCapabilityUse, CapabilityId } from "../capabilities/types.js";
import type { ArtifactWarning, BrowserTheme, DynamicManifest, GenerationSettings } from "../domain.js";
import type { IconSet } from "../iconify/catalog.js";
import { compileIconify } from "../iconify/transform.js";
import { createImageResolver, type ImageIntentResolver } from "../images/resolver.js";
import { compileDynamicManifest } from "./dynamic-manifest.js";
import { compileTailwind, sanitizeCompiledCss } from "./tailwind.js";
import {
  elements,
  firstElement,
  getAttribute,
  removeAttribute,
  removeNode,
  setAttribute,
  type DocumentNode,
  type ElementNode,
  walk,
} from "./tree.js";

const REMOVED_ELEMENTS = new Set([
  "base",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "object",
  "portal",
  "template",
]);

export const MAX_IMAGE_INTENTS = 24;
export const MAX_IMAGE_RESOLUTION_CONCURRENCY = 4;
const FINAL_DOCUMENT_SIZE_TARGET = 0.92;
const ESCAPED_ATTRIBUTE_ASSIGNMENT = /(?:^|\s)[A-Za-z_:][\w:.-]*\s*=\s*\\"/g;

function sanitizeCss(css: string): string {
  return sanitizeCompiledCss(css);
}

function repairEscapedModelMarkup(html: string): { html: string; warnings: ArtifactWarning[] } {
  const warnings: ArtifactWarning[] = [];
  const formatting = repairEscapedFormattingInsideTags(html);
  let repaired = formatting.html;
  if (formatting.repaired) {
    warnings.push({
      code: "escaped-html-formatting-repaired",
      message: "JSON-style newline or tab escapes inside model-authored tags were repaired before parsing.",
    });
  }

  const escapedAssignments = repaired.match(ESCAPED_ATTRIBUTE_ASSIGNMENT)?.length ?? 0;
  const escapedDocumentAttribute = /<html\b[^>]*\s[A-Za-z_:][\w:.-]*\s*=\s*\\"/i.test(repaired);
  if (escapedAssignments >= 2 || escapedDocumentAttribute) {
    repaired = repaired.replace(/\\"/g, '"');
    warnings.push({
      code: "escaped-html-quotes-repaired",
      message: "Repeated JSON-style quote escaping in model-authored HTML was repaired before parsing.",
    });
  }
  return { html: repaired, warnings };
}

function repairEscapedFormattingInsideTags(html: string): { html: string; repaired: boolean } {
  let result = "";
  let inTag = false;
  let quote = "";
  let repaired = false;
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
        repaired = true;
        continue;
      }
    }
    result += character;
    if (inTag && character === ">" && !quote) inTag = false;
  }
  return { html: result, repaired };
}

function repairLegacyQuotedNavigationUrl(raw: string): string {
  let value = raw.trim();
  if ((value.startsWith('\\"') && value.endsWith('\\"')) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    const wrapperLength = value.startsWith('\\"') ? 2 : 1;
    value = value.slice(wrapperLength, -wrapperLength);
  }
  if (value === "//") return "/";

  const absoluteWrapper = /^(https?:\/\/[^/?#]+)\/(?:(?:%5c)|\\)*%22\/?(?=#|$|[^/])/i;
  const relativeWrapper = /^\/(?:(?:%5c)|\\)*%22\/?(?=#|$|[^/])/i;
  const encodedWrapperEnd = /(?:(?:%5c)|\\)*%22$/i;
  const hadEncodedWrapper = (absoluteWrapper.test(value) || relativeWrapper.test(value))
    && encodedWrapperEnd.test(value);
  if (hadEncodedWrapper) {
    value = value
      .replace(absoluteWrapper, "$1/")
      .replace(relativeWrapper, "/")
      .replace(/(?:(?:%5c)|\\)*%22$/i, "");
  }
  return value;
}

function hasMalformedNavigationEscaping(value: string): boolean {
  return /\\(?:"|%22)|%5c%22|^(?:https?:\/\/[^/?#]+)?\/%22(?=\/|#|$)/i.test(value);
}

function normalizeNavigationUrl(raw: string, pageUrl: URL): string {
  const trimmed = repairLegacyQuotedNavigationUrl(raw);
  if (!trimmed || trimmed.startsWith("#")) {
    return trimmed || "#";
  }
  if (hasMalformedNavigationEscaping(trimmed)) {
    return "#blocked";
  }
  try {
    const resolved = new URL(trimmed, pageUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return "#blocked";
    }
    return resolved.href;
  } catch {
    return "#blocked";
  }
}

function textNode(value: string, parentNode: ElementNode) {
  return { nodeName: "#text" as const, value, parentNode };
}

function compactText(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function elementText(element: ElementNode): string {
  let result = "";
  walk(element, (node) => {
    if (node.nodeName === "#text" && "value" in node) result += ` ${node.value}`;
  });
  return compactText(result, 1_500);
}

function linkContainerText(element: ElementNode): string {
  let current = element.parentNode;
  while (current && "tagName" in current) {
    if (["article", "li", "nav", "header", "footer", "section", "p", "tr"].includes(current.tagName)) {
      return elementText(current);
    }
    current = current.parentNode;
  }
  return elementText(element);
}

function appendMarkup(parent: ElementNode, markup: string): void {
  const fragment = parseFragment(parent, markup, {});
  for (const node of fragment.childNodes) {
    node.parentNode = parent;
    parent.childNodes.push(node);
  }
}

function normalizeEscapedFormatting(document: DocumentNode): void {
  walk(document, (node) => {
    if (node.nodeName !== "#text" || !("value" in node)) return;
    node.value = node.value
      .replace(/\\r\\n|\\n|\\r/g, "\n")
      .replace(/\\t/g, "\t");
  });
}

function ensureHeadMetadata(document: DocumentNode, title: string): void {
  const html = firstElement(document, "html");
  const head = firstElement(document, "head");
  if (html && !getAttribute(html, "lang")) {
    setAttribute(html, "lang", "en");
  }
  if (!head) {
    return;
  }

  let titleElement = firstElement(document, "title");
  if (!titleElement) {
    appendMarkup(head, "<title></title>");
    titleElement = firstElement(document, "title");
  }
  if (titleElement) {
    titleElement.childNodes = [textNode(title, titleElement)];
  }

  const metas = elements(document, "meta");
  if (!metas.some((meta) => getAttribute(meta, "charset"))) {
    appendMarkup(head, '<meta charset="utf-8">');
  }
  if (!metas.some((meta) => getAttribute(meta, "name")?.toLowerCase() === "viewport")) {
    appendMarkup(head, '<meta name="viewport" content="width=device-width, initial-scale=1">');
  }
}

function sanitizeDocument(
  document: DocumentNode,
  pageUrl: URL,
  allowGeneratedScripts: boolean,
): void {
  for (const element of elements(document)) {
    if (REMOVED_ELEMENTS.has(element.tagName)) {
      removeNode(element);
      continue;
    }
    if (
      element.tagName === "meta" &&
      getAttribute(element, "http-equiv")?.toLowerCase() === "refresh"
    ) {
      removeNode(element);
      continue;
    }
    if (element.tagName === "link") {
      removeNode(element);
      continue;
    }
    if (element.tagName === "script") {
      const source = getAttribute(element, "src");
      const type = getAttribute(element, "type")?.trim().toLowerCase() ?? "";
      const classicScript = !type || type === "text/javascript" || type === "application/javascript";
      if (!allowGeneratedScripts || source || !classicScript) {
        removeNode(element);
        continue;
      }
      // Generated behavior is inline classic JavaScript only. Strip every
      // model-supplied script attribute before the isolated frame receives it.
      element.attrs = [];
    }
    if (element.tagName === "style") {
      for (const child of element.childNodes) {
        if ("value" in child) {
          child.value = sanitizeCss(child.value);
        }
      }
    }

    for (const attribute of [...element.attrs]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || ["srcdoc", "ping", "download", "integrity", "crossorigin"].includes(name)) {
        removeAttribute(element, attribute.name);
      } else if (name === "style") {
        attribute.value = sanitizeCss(attribute.value);
      }
    }

    if (element.tagName === "a") {
      setAttribute(element, "href", normalizeNavigationUrl(getAttribute(element, "href") ?? "#", pageUrl));
      const explicitContext = compactText(getAttribute(element, "data-vibe-context") ?? "", 1_500);
      const fallbackContext = compactText([
        getAttribute(element, "aria-label") ?? "",
        elementText(element),
        linkContainerText(element),
      ].filter(Boolean).join(" — "), 1_500);
      setAttribute(element, "data-vibe-context", explicitContext || fallbackContext || "Open linked page");
      const rel = new Set((getAttribute(element, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      setAttribute(element, "rel", [...rel].filter((token) => ["license", "noopener", "noreferrer"].includes(token)).join(" "));
    }
    if (element.tagName === "form") {
      setAttribute(element, "method", "get");
      setAttribute(element, "action", normalizeNavigationUrl(getAttribute(element, "action") ?? pageUrl.href, pageUrl));
    }
    if (element.tagName === "img") {
      const existingSource = getAttribute(element, "src");
      if (!getAttribute(element, "data-vibe-image")) {
        setAttribute(element, "data-vibe-image", getAttribute(element, "alt") || "contextual editorial image");
      }
      if (existingSource) {
        removeAttribute(element, "src");
      }
      if (!getAttribute(element, "alt")) {
        setAttribute(element, "alt", "Contextual illustration");
      }
    }
  }
}

function classCandidates(document: DocumentNode): string[] {
  const result: string[] = [];
  for (const element of elements(document)) {
    const classes = getAttribute(element, "class")?.split(/\s+/).filter(Boolean) ?? [];
    result.push(...classes);
  }
  return result;
}

async function injectStyles(document: DocumentNode, settings: GenerationSettings): Promise<ArtifactWarning[]> {
  const head = firstElement(document, "head");
  if (!head || !settings.tailwindEnabled) {
    return [];
  }
  const compiled = await compileTailwind(classCandidates(document));
  appendMarkup(head, `<style data-vibesurfer-styles="tailwind-${settings.tailwindVersion}">${compiled.css}</style>`);
  return compiled.warning ? [compiled.warning] : [];
}

function injectMotionPolicy(document: DocumentNode, settings: GenerationSettings): void {
  if (settings.motionEnabled !== false) return;
  const head = firstElement(document, "head");
  if (!head) return;
  appendMarkup(head, `<style data-vibesurfer-motion="disabled">html{scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}</style>`);
}

async function resolveImages(
  document: DocumentNode,
  settings: GenerationSettings,
  artifactSeed: string,
  signal: AbortSignal,
  pageOrigin: string,
  resolverOverride?: ImageIntentResolver,
): Promise<ArtifactWarning[]> {
  const resolver = resolverOverride ?? createImageResolver(settings.images, { excludedOrigins: [pageOrigin] });
  const allImages = elements(document, "img");
  const images = allImages.slice(0, MAX_IMAGE_INTENTS);
  const warnings: ArtifactWarning[] = [];
  if (allImages.length > MAX_IMAGE_INTENTS) {
    for (const element of allImages.slice(MAX_IMAGE_INTENTS)) {
      removeNode(element);
    }
    warnings.push({
      code: "image-intents-capped",
      message: `Only the first ${MAX_IMAGE_INTENTS} image intents were kept; excess model-supplied images were removed.`,
    });
  }

  const warningsByIndex: Array<ArtifactWarning | undefined> = new Array(images.length);
  let nextIndex = 0;
  const resolveNext = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const element = images[index];
      if (!element) return;
      const intent = {
        query: getAttribute(element, "data-vibe-image") ?? getAttribute(element, "alt") ?? "abstract editorial",
        alt: getAttribute(element, "alt") ?? "Contextual illustration",
        aspect: getAttribute(element, "data-vibe-aspect") ?? "16/9",
        index,
        artifactSeed,
      };
      const resolved = await resolver.resolve(intent, signal);
      if (resolved.omitted) {
        removeNode(element);
        if (resolved.warning) warningsByIndex[index] = resolved.warning;
        continue;
      }
      setAttribute(element, "src", resolved.src);
      setAttribute(element, "width", String(resolved.width));
      setAttribute(element, "height", String(resolved.height));
      setAttribute(element, "loading", index === 0 ? "eager" : "lazy");
      setAttribute(element, "decoding", "async");
      setAttribute(element, "referrerpolicy", "no-referrer");
      if (resolved.warning) {
        warningsByIndex[index] = resolved.warning;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_IMAGE_RESOLUTION_CONCURRENCY, images.length) },
      () => resolveNext(),
    ),
  );

  let removedForSize = 0;
  const targetBytes = Math.floor(settings.maxArtifactBytes * FINAL_DOCUMENT_SIZE_TARGET);
  let serializedBytes = Buffer.byteLength(serialize(document), "utf8");
  for (const image of [...images].reverse()) {
    if (serializedBytes <= targetBytes) break;
    const parent = image.parentNode;
    if (!parent || !("childNodes" in parent) || !parent.childNodes.includes(image)) continue;
    removeNode(image);
    removedForSize += 1;
    serializedBytes = Buffer.byteLength(serialize(document), "utf8");
  }
  if (removedForSize > 0) {
    warnings.push({
      code: "image-artifact-budget",
      message: `${removedForSize} trailing image intent${removedForSize === 1 ? " was" : "s were"} omitted to keep the page within its artifact size budget.`,
    });
  }

  return [...warnings, ...warningsByIndex.filter((warning): warning is ArtifactWarning => Boolean(warning))];
}

export interface TransformHtmlInput {
  html: string;
  url: string;
  title: string;
  settings: GenerationSettings;
  selectedIconSet?: IconSet | null;
  selectedCapabilities?: readonly CapabilityId[];
  browserTheme?: BrowserTheme;
  artifactSeed: string;
  signal: AbortSignal;
  imageResolver?: ImageIntentResolver;
  onPhase?: (phase: "compiling-styles" | "resolving-images") => void | Promise<void>;
}

export interface TransformHtmlResult {
  html: string;
  warnings: ArtifactWarning[];
  capabilityManifest: ArtifactCapabilityUse[];
  dynamicManifest?: DynamicManifest;
}

export interface TransformPreviewHtmlInput {
  html: string;
  url: string;
  title: string;
  settings: GenerationSettings;
  selectedIconSet?: IconSet | null;
  selectedCapabilities?: readonly CapabilityId[];
  browserTheme?: BrowserTheme;
}

/**
 * Repairs and styles an incomplete model document for a passive streaming
 * preview. Image resolution and every network-bearing operation stay deferred
 * until the final artifact compile.
 */
export async function transformPreviewHtml(input: TransformPreviewHtmlInput): Promise<string> {
  const pageUrl = new URL(input.url);
  const source = repairEscapedModelMarkup(input.html);
  const document = parse(source.html);
  normalizeEscapedFormatting(document);
  compileIconify(document, input.selectedIconSet ?? null);
  await compileCapabilities({
    document,
    settings: input.settings,
    browserTheme: input.browserTheme ?? "native",
    selectedCapabilities: input.selectedCapabilities
      ?? (input.settings.allowGeneratedScripts ? ["local-dom-scripts"] : []),
    preview: true,
  });
  sanitizeDocument(document, pageUrl, false);
  ensureHeadMetadata(document, input.title);
  await injectStyles(document, input.settings);
  injectMotionPolicy(document, input.settings);
  const head = firstElement(document, "head");
  if (head) {
    appendMarkup(head, "<style data-vibesurfer-preview>img[data-vibe-image]:not([src]){visibility:hidden}</style>");
  }
  return `<!doctype html>\n${serialize(document).replace(/^<!DOCTYPE html>/i, "").trimStart()}`;
}

export async function transformHtml(input: TransformHtmlInput): Promise<TransformHtmlResult> {
  const pageUrl = new URL(input.url);
  const source = repairEscapedModelMarkup(input.html);
  const document = parse(source.html);
  normalizeEscapedFormatting(document);
  const iconify = compileIconify(document, input.selectedIconSet ?? null);
  const capabilities = await compileCapabilities({
    document,
    settings: input.settings,
    browserTheme: input.browserTheme ?? "native",
    selectedCapabilities: input.selectedCapabilities
      ?? (input.settings.allowGeneratedScripts ? ["local-dom-scripts"] : []),
    preview: false,
    signal: input.signal,
  });
  const dynamic = compileDynamicManifest({
    document,
    enabled: input.settings.dynamicMode !== "off"
      && (input.selectedCapabilities ?? []).includes("dynamic-regions"),
  });
  sanitizeDocument(document, pageUrl, input.settings.allowGeneratedScripts);
  ensureHeadMetadata(document, input.title);

  await input.onPhase?.("compiling-styles");
  const styleWarnings = await injectStyles(document, input.settings);
  injectMotionPolicy(document, input.settings);
  await input.onPhase?.("resolving-images");
  const imageWarnings = await resolveImages(
    document,
    input.settings,
    input.artifactSeed,
    input.signal,
    pageUrl.origin,
    input.imageResolver,
  );

  return {
    html: `<!doctype html>\n${serialize(document).replace(/^<!DOCTYPE html>/i, "").trimStart()}`,
    warnings: [...source.warnings, ...iconify.warnings, ...capabilities.warnings, ...dynamic.warnings, ...styleWarnings, ...imageWarnings],
    capabilityManifest: capabilities.manifest,
    ...(dynamic.manifest ? { dynamicManifest: dynamic.manifest } : {}),
  };
}
