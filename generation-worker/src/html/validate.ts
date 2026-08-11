import { Buffer } from "node:buffer";

import { parse } from "parse5";

import type { GenerationSettings, HtmlIssue } from "../domain.js";
import { elements, firstElement, getAttribute } from "./tree.js";

export interface ValidationResult {
  valid: boolean;
  issues: HtmlIssue[];
}

export function validateHtml(html: string, url: string, settings: GenerationSettings): ValidationResult {
  const issues: HtmlIssue[] = [];
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > settings.maxArtifactBytes) {
    issues.push({
      severity: "error",
      code: "artifact-too-large",
      message: `The compiled document is ${bytes} bytes; the configured limit is ${settings.maxArtifactBytes}.`,
    });
  }
  if (!/^\s*<!doctype html>/i.test(html)) {
    issues.push({ severity: "error", code: "missing-doctype", message: "The document must start with an HTML doctype." });
  }

  const document = parse(html);
  const title = firstElement(document, "title");
  if (!title || title.childNodes.every((node) => !("value" in node) || !node.value.trim())) {
    issues.push({ severity: "error", code: "missing-title", message: "The document has no non-empty title." });
  }
  if (!firstElement(document, "body")) {
    issues.push({ severity: "error", code: "missing-body", message: "The document has no body." });
  }
  if (!elements(document, "meta").some((meta) => getAttribute(meta, "name")?.toLowerCase() === "viewport")) {
    issues.push({ severity: "error", code: "missing-viewport", message: "The document has no responsive viewport declaration." });
  }

  const forbidden = ["base", "embed", "frame", "frameset", "iframe", "object", "portal", "script"];
  for (const tagName of forbidden) {
    if (elements(document, tagName).length > 0) {
      issues.push({ severity: "error", code: `forbidden-${tagName}`, message: `The document contains forbidden <${tagName}> content.` });
    }
  }

  const pageUrl = new URL(url);
  const internalRoutes = new Set<string>();
  for (const anchor of elements(document, "a")) {
    const href = getAttribute(anchor, "href") ?? "";
    if (!href || href === "#" || href === "#blocked") {
      continue;
    }
    try {
      const target = new URL(href, pageUrl);
      if (target.origin === pageUrl.origin) {
        internalRoutes.add(`${target.pathname}${target.search}`);
      }
    } catch {
      issues.push({ severity: "error", code: "invalid-link", message: "The document contains an invalid navigation URL." });
    }
  }
  if (internalRoutes.size < settings.minInternalLinks) {
    issues.push({
      severity: "error",
      code: "insufficient-internal-links",
      message: `The page has ${internalRoutes.size} distinct internal routes; at least ${settings.minInternalLinks} are required.`,
    });
  }

  for (const element of elements(document)) {
    for (const attribute of element.attrs) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        issues.push({ severity: "error", code: "inline-handler", message: "Inline JavaScript event handlers are forbidden." });
      }
      if (/^\s*(javascript|file|blob):/i.test(attribute.value)) {
        issues.push({ severity: "error", code: "forbidden-url-scheme", message: "The document contains a forbidden URL scheme." });
      }
    }
  }
  for (const image of elements(document, "img")) {
    if (!getAttribute(image, "alt")) {
      issues.push({ severity: "error", code: "missing-image-alt", message: "Every image must have alt text." });
    }
    const src = getAttribute(image, "src") ?? "";
    if (src && !src.startsWith("data:image/")) {
      issues.push({ severity: "error", code: "external-image", message: "Images must be resolved to host-owned data URLs." });
    }
  }

  if (settings.tailwindEnabled && !elements(document, "style").some((style) => getAttribute(style, "data-vibesurfer-styles")?.startsWith("tailwind-"))) {
    issues.push({ severity: "error", code: "missing-compiled-styles", message: "Tailwind mode requires a host-compiled stylesheet." });
  }

  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}
