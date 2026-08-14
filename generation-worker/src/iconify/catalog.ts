import { z } from "zod";

import generatedCatalog from "./iconify-packs.generated.json" with { type: "json" };

export const ICON_SET_IDS = [
  "lucide",
  "carbon",
  "ph",
  "pepicons-pop",
  "streamline-cyber",
  "pixelarticons",
  "fa",
  "streamline-freehand",
  "flat-color-icons",
  "game-icons",
] as const;

export const IconSetSchema = z.enum(ICON_SET_IDS);
export type IconSet = z.infer<typeof IconSetSchema>;

export const ICONIFY_WEB_COMPONENT_SCRIPT =
  "https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js";

export const ICON_SET_DESCRIPTIONS: Readonly<Record<IconSet, string>> = {
  lucide: "clean neutral outline; modern products, SaaS, services, editorial and serious general-purpose sites",
  carbon: "strict technical enterprise; data, infrastructure, industry, government and dense dashboards",
  ph: "rounded expressive duotone; consumer apps, lifestyle, communities and friendly modern products",
  "pepicons-pop": "bouncy playful pop; humorous, youthful, creative and deliberately unserious sites",
  "streamline-cyber": "angular sci-fi/cyberpunk; neon, terminals, security, Web3 and fictional technology",
  pixelarticons: "crisp pixel UI; retro computers, games, Y2K and 8/16-bit aesthetics",
  fa: "Font Awesome 4; Bootstrap-era, Web 2.0, old dashboards and intentionally dated utilitarian sites",
  "streamline-freehand": "loose hand-drawn sketch; DIY, zines, indie brands, workshops and children's sites",
  "flat-color-icons": "multicolor illustrative pictograms; stickers, education, friendly explainers and nostalgic flat UI",
  "game-icons": "bold silhouettes; fantasy, RPG, occult, medieval, tabletop and heavy-metal aesthetics",
};

export interface IconifyIconData {
  body: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
  hFlip: boolean;
  vFlip: boolean;
}

export interface IconifyPack {
  prefix: IconSet;
  label: string;
  description: string;
  palette: "monochrome" | "multicolor";
  license: { spdx: string; title: string; url: string | null };
  attributionRequired: boolean;
  attributionHTML: string | null;
  semanticMap: Record<string, string>;
  flavor: string[];
  names: string[];
  iconData: Record<string, IconifyIconData>;
  promptMap: string;
  promptFlavor: string;
}

interface IconifyCatalog {
  generatedAt: string;
  source: string;
  webComponentScript: string;
  allowedPrefixes: IconSet[];
  packs: Record<IconSet, IconifyPack>;
}

export const iconifyCatalog = generatedCatalog as unknown as IconifyCatalog;

const generatedPrefixes = iconifyCatalog.allowedPrefixes.join(",");
if (generatedPrefixes !== ICON_SET_IDS.join(",")) {
  throw new Error("The generated Iconify catalog does not match the prompt whitelist.");
}
if (iconifyCatalog.webComponentScript !== ICONIFY_WEB_COMPONENT_SCRIPT) {
  throw new Error("The generated Iconify catalog uses an unexpected web-component marker.");
}

export function iconSetSelectionCatalog(): Readonly<Record<IconSet, string>> {
  return ICON_SET_DESCRIPTIONS;
}

export function iconifyPack(iconSet: IconSet): IconifyPack {
  return iconifyCatalog.packs[iconSet];
}

export function buildIconGenerationSection(iconSet: IconSet | null): string {
  if (iconSet === null) {
    return [
      "<selected_icon_contract>",
      "Selected Iconify set: `null`",
      "Do not load Iconify and do not use <iconify-icon>.",
      "</selected_icon_contract>",
    ].join("\n");
  }

  const pack = iconifyPack(iconSet);
  const attribution = pack.attributionHTML
    ? `<small data-iconify-attribution>${pack.attributionHTML}</small>`
    : "none";
  return [
    "<selected_icon_contract>",
    `Selected Iconify set: \`${pack.prefix}\``,
    `Palette type: \`${pack.palette}\``,
    `Allowed semantic map: ${pack.promptMap || "none"}`,
    `Additional allowed thematic icons: ${pack.promptFlavor || "none"}`,
    `Required attribution HTML: ${attribution}`,
    "Use this one set consistently; never mix sets.",
    `Add this marker once: <script src=\"${ICONIFY_WEB_COMPONENT_SCRIPT}\"></script>`,
    `Render an icon as <iconify-icon icon=\"${pack.prefix}:ICON_NAME\" aria-hidden=\"true\"></iconify-icon>.`,
    "Use only exact ICON_NAME values supplied above. Never invent names, search for another icon, or mix sets. If no supplied icon fits, use text or CSS instead.",
    "Add iconify-icon { display: inline-block; width: 1em; height: 1em; } to page CSS to reserve layout space.",
    "Monochrome icons inherit currentColor. Do not recolor multicolor icons.",
    "Icons are decorative unless they are the only content of a control. Every icon-only button or link must have an aria-label.",
    "Use icons sparingly and consistently; do not replace essential text labels with icons.",
    "If attribution is not none, include the supplied attribution HTML once in the footer or credits.",
    "The artifact compiler replaces approved icon elements with trusted inline SVG and removes the remote script marker before execution.",
    "</selected_icon_contract>",
  ].join("\n");
}
