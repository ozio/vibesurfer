import { parseFragment } from "parse5";

import type { ArtifactWarning } from "../domain.js";
import {
  elements,
  firstElement,
  getAttribute,
  removeNode,
  setAttribute,
  type DocumentNode,
  type ElementNode,
} from "../html/tree.js";
import { iconifyPack, type IconSet, type IconifyIconData } from "./catalog.js";

export const MAX_ICONIFY_ICONS = 96;

function appendMarkup(parent: ElementNode, markup: string): void {
  const fragment = parseFragment(parent, markup, {});
  for (const node of fragment.childNodes) {
    node.parentNode = parent;
    parent.childNodes.push(node);
  }
}

function replaceChildren(parent: ElementNode, markup: string): void {
  const fragment = parseFragment(parent, markup, {});
  for (const node of fragment.childNodes) node.parentNode = parent;
  parent.childNodes = fragment.childNodes;
}

function scopedSvgBody(body: string, scope: string): string {
  const ids = new Map<string, string>();
  const scoped = body.replace(/\bid=(['"])([^'"<>\s]+)\1/g, (_whole, quote: string, id: string) => {
    const replacement = `${scope}-${ids.size}-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    ids.set(id, replacement);
    return `id=${quote}${replacement}${quote}`;
  });
  let result = scoped;
  for (const [id, replacement] of ids) {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result
      .replaceAll(`url(#${id})`, `url(#${replacement})`)
      .replace(new RegExp(`((?:xlink:)?href=["'])#${escapedId}(["'])`, "g"), `$1#${replacement}$2`);
  }
  return result;
}

function transformedBody(icon: IconifyIconData, scope: string): string {
  let body = scopedSvgBody(icon.body, scope);
  const centerX = icon.left + icon.width / 2;
  const centerY = icon.top + icon.height / 2;
  if (icon.hFlip) body = `<g transform="translate(${2 * centerX} 0) scale(-1 1)">${body}</g>`;
  if (icon.vFlip) body = `<g transform="translate(0 ${2 * centerY}) scale(1 -1)">${body}</g>`;
  if (icon.rotate) body = `<g transform="rotate(${(icon.rotate % 4) * 90} ${centerX} ${centerY})">${body}</g>`;
  return body;
}

function iconSvg(icon: IconifyIconData, scope: string): string {
  const viewBox = `${icon.left} ${icon.top} ${icon.width} ${icon.height}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1em" height="1em" aria-hidden="true" focusable="false" style="display:block;width:100%;height:100%">${transformedBody(icon, scope)}</svg>`;
}

function attributionElements(document: DocumentNode): ElementNode[] {
  return elements(document).filter((element) => getAttribute(element, "data-iconify-attribution") !== undefined);
}

export interface CompileIconifyResult {
  rendered: number;
  warnings: ArtifactWarning[];
}

export function compileIconify(
  document: DocumentNode,
  selectedIconSet: IconSet | null,
): CompileIconifyResult {
  const warnings: ArtifactWarning[] = [];
  const allIcons = elements(document, "iconify-icon");
  if (selectedIconSet === null) {
    for (const icon of allIcons) removeNode(icon);
    for (const attribution of attributionElements(document)) removeNode(attribution);
    if (allIcons.length > 0) {
      warnings.push({
        code: "iconify-not-selected",
        message: "Iconify elements were removed because Director selected no icon set.",
      });
    }
    return { rendered: 0, warnings };
  }

  const pack = iconifyPack(selectedIconSet);
  let rendered = 0;
  let rejected = 0;
  for (const [index, element] of allIcons.entries()) {
    if (index >= MAX_ICONIFY_ICONS) {
      removeNode(element);
      continue;
    }
    const rawName = getAttribute(element, "icon") ?? "";
    const separator = rawName.indexOf(":");
    const prefix = separator > 0 ? rawName.slice(0, separator) : "";
    const name = separator > 0 ? rawName.slice(separator + 1) : "";
    const canonicalName = pack.names.includes(name) ? name : pack.semanticMap[name];
    const icon = prefix === selectedIconSet && canonicalName
      ? pack.iconData[canonicalName]
      : undefined;
    if (!icon || !canonicalName || !pack.names.includes(canonicalName)) {
      removeNode(element);
      rejected += 1;
      continue;
    }

    setAttribute(element, "icon", `${selectedIconSet}:${canonicalName}`);
    replaceChildren(element, iconSvg(icon, `vibe-icon-${index}`));
    setAttribute(element, "data-iconify-rendered", "");
    setAttribute(element, "data-iconify-set", selectedIconSet);
    setAttribute(element, "data-iconify-palette", pack.palette);
    rendered += 1;
  }

  if (allIcons.length > MAX_ICONIFY_ICONS) {
    warnings.push({
      code: "iconify-icons-capped",
      message: `Only the first ${MAX_ICONIFY_ICONS} Iconify elements were kept.`,
    });
  }
  if (rejected > 0) {
    warnings.push({
      code: "iconify-icon-rejected",
      message: `${rejected} Iconify element${rejected === 1 ? " was" : "s were"} removed because its name was not in the selected set whitelist.`,
    });
  }

  const head = firstElement(document, "head");
  if (rendered > 0 && head) {
    appendMarkup(head, '<style data-vibesurfer-iconify>iconify-icon{display:inline-block;width:1em;height:1em;line-height:1;vertical-align:-.125em}iconify-icon>svg{display:block;width:100%;height:100%}</style>');
  }

  const attributions = attributionElements(document);
  if (rendered > 0 && pack.attributionHTML) {
    const trusted = pack.attributionHTML;
    const target = attributions.shift();
    if (target) {
      replaceChildren(target, trusted);
      setAttribute(target, "data-iconify-set", selectedIconSet);
    } else {
      const parent = firstElement(document, "footer") ?? firstElement(document, "body");
      if (parent) appendMarkup(parent, `<small data-iconify-attribution data-iconify-set="${selectedIconSet}">${trusted}</small>`);
    }
  }
  for (const attribution of attributions) removeNode(attribution);
  if (!pack.attributionHTML) {
    for (const attribution of attributionElements(document)) removeNode(attribution);
  }

  return { rendered, warnings };
}
