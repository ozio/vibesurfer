import type { DefaultTreeAdapterMap } from "parse5";

export type DocumentNode = DefaultTreeAdapterMap["document"];
export type ParentNode = DefaultTreeAdapterMap["parentNode"];
export type ElementNode = DefaultTreeAdapterMap["element"];
export type Node = DefaultTreeAdapterMap["node"];

export function isElement(node: Node): node is ElementNode {
  return "tagName" in node;
}

export function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  if ("childNodes" in node) {
    for (const child of [...node.childNodes]) {
      walk(child, visit);
    }
  }
}

export function elements(document: DocumentNode, tagName?: string): ElementNode[] {
  const found: ElementNode[] = [];
  walk(document, (node) => {
    if (isElement(node) && (!tagName || node.tagName === tagName)) {
      found.push(node);
    }
  });
  return found;
}

export function firstElement(document: DocumentNode, tagName: string): ElementNode | undefined {
  return elements(document, tagName)[0];
}

export function getAttribute(element: ElementNode, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

export function setAttribute(element: ElementNode, name: string, value: string): void {
  const attribute = element.attrs.find((candidate) => candidate.name === name);
  if (attribute) {
    attribute.value = value;
  } else {
    element.attrs.push({ name, value });
  }
}

export function removeAttribute(element: ElementNode, name: string): void {
  element.attrs = element.attrs.filter((attribute) => attribute.name !== name);
}

export function removeNode(node: Node): void {
  if (!("parentNode" in node)) {
    return;
  }
  const parent = node.parentNode;
  if (!parent || !("childNodes" in parent)) {
    return;
  }
  parent.childNodes = parent.childNodes.filter((child: Node) => child !== node);
}
