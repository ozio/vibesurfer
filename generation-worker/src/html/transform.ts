import { parse, parseFragment, serialize } from "parse5";

import type { ArtifactWarning, GenerationSettings } from "../domain.js";
import { createImageResolver, type ImageIntentResolver } from "../images/resolver.js";
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
} from "./tree.js";

const REMOVED_ELEMENTS = new Set([
  "base",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "object",
  "portal",
  "script",
]);

export const MAX_IMAGE_INTENTS = 24;
export const MAX_IMAGE_RESOLUTION_CONCURRENCY = 4;

function sanitizeCss(css: string): string {
  return sanitizeCompiledCss(css);
}

function normalizeNavigationUrl(raw: string, pageUrl: URL): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return trimmed || "#";
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

function appendMarkup(parent: ElementNode, markup: string): void {
  const fragment = parseFragment(parent, markup, {});
  for (const node of fragment.childNodes) {
    node.parentNode = parent;
    parent.childNodes.push(node);
  }
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

function sanitizeDocument(document: DocumentNode, pageUrl: URL, tailwindEnabled: boolean): void {
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
    if (element.tagName === "style") {
      if (tailwindEnabled) {
        removeNode(element);
      } else {
        for (const child of element.childNodes) {
          if ("value" in child) {
            child.value = sanitizeCss(child.value);
          }
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
      setAttribute(element, "rel", "noopener noreferrer");
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
  return [...warnings, ...warningsByIndex.filter((warning): warning is ArtifactWarning => Boolean(warning))];
}

export interface TransformHtmlInput {
  html: string;
  url: string;
  title: string;
  settings: GenerationSettings;
  artifactSeed: string;
  signal: AbortSignal;
  imageResolver?: ImageIntentResolver;
  onPhase?: (phase: "compiling-styles" | "resolving-images") => void | Promise<void>;
}

export interface TransformHtmlResult {
  html: string;
  warnings: ArtifactWarning[];
}

export async function transformHtml(input: TransformHtmlInput): Promise<TransformHtmlResult> {
  const pageUrl = new URL(input.url);
  const document = parse(input.html);
  sanitizeDocument(document, pageUrl, input.settings.tailwindEnabled);
  ensureHeadMetadata(document, input.title);

  await input.onPhase?.("compiling-styles");
  const styleWarnings = await injectStyles(document, input.settings);
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
    warnings: [...styleWarnings, ...imageWarnings],
  };
}
