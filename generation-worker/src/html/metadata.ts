import { parse } from "parse5";

import { elements, getAttribute, walk, type ElementNode } from "./tree.js";

export interface HtmlDocumentMetadata {
  title?: string;
  description?: string;
}

function elementText(element: ElementNode): string {
  let value = "";
  walk(element, (node) => {
    if (node.nodeName === "#text" && "value" in node) {
      value += ` ${node.value}`;
    }
  });
  return value.replaceAll(/\s+/g, " ").trim();
}

/** Reads browser metadata from model-authored HTML after parse5 normalization. */
export function extractHtmlDocumentMetadata(html: string): HtmlDocumentMetadata {
  const document = parse(html);
  const title = elements(document, "title")
    .map(elementText)
    .find(Boolean)
    ?.slice(0, 240);
  const descriptionMeta = elements(document, "meta")
    .find((meta) => getAttribute(meta, "name")?.trim().toLowerCase() === "description");
  const description = descriptionMeta
    ? getAttribute(descriptionMeta, "content")?.trim().slice(0, 500)
    : undefined;

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}
