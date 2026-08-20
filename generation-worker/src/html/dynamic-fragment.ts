import { parseFragment, serialize } from "parse5";

import type { ElementNode, ParentNode } from "./tree.js";
import { isElement, removeAttribute, removeNode, walk } from "./tree.js";

const MAX_REGION_HTML_BYTES = 64 * 1024;
const FORBIDDEN_ELEMENTS = new Set([
  "base",
  "body",
  "embed",
  "head",
  "html",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
  "style",
  "template",
]);
const URL_ATTRIBUTES = new Set(["action", "formaction", "href", "poster", "src", "srcset"]);
const HOST_AUTHORITY_ATTRIBUTES = new Set([
  "data-vibe-action",
  "data-vibe-bind",
  "data-vibe-refresh",
  "data-vibe-region",
  "data-vibe-target",
  "data-vibe-tabs",
]);

export class UnsafeDynamicFragmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDynamicFragmentError";
  }
}

/**
 * Compiles model-produced region markup as an inert fragment. Dynamic patches
 * can update presentation, but cannot mint host capabilities, styles, scripts,
 * network requests, or document-level nodes.
 */
export function compileDynamicFragment(html: string, pageUrl: string): string {
  if (Buffer.byteLength(html, "utf8") > MAX_REGION_HTML_BYTES) {
    throw new UnsafeDynamicFragmentError("A dynamic region exceeded the 64 KiB HTML limit.");
  }

  const fragment = parseFragment(html);
  const page = new URL(pageUrl);
  const fragmentElements: ElementNode[] = [];
  walk(fragment as unknown as Parameters<typeof walk>[0], (node) => {
    if (isElement(node)) fragmentElements.push(node);
  });
  for (const element of fragmentElements) {
    if (FORBIDDEN_ELEMENTS.has(element.tagName)) {
      removeNode(element);
      continue;
    }

    for (const attribute of [...element.attrs]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on")
        || name === "style"
        || name === "srcdoc"
        || HOST_AUTHORITY_ATTRIBUTES.has(name)
      ) {
        removeAttribute(element, attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && !isAllowedUrl(attribute.value, page, name)) {
        removeAttribute(element, attribute.name);
      }
    }
  }

  const output = serialize(fragment as unknown as ParentNode);
  if (Buffer.byteLength(output, "utf8") > MAX_REGION_HTML_BYTES) {
    throw new UnsafeDynamicFragmentError("A sanitized dynamic region exceeded the 64 KiB HTML limit.");
  }
  return output;
}

function isAllowedUrl(value: string, page: URL, attribute: string): boolean {
  if (attribute === "src" || attribute === "srcset" || attribute === "poster") return false;
  try {
    const resolved = new URL(value, page);
    return (resolved.protocol === "http:" || resolved.protocol === "https:") && resolved.origin === page.origin;
  } catch {
    return false;
  }
}
