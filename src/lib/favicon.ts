import type { FaviconSource, GlyphFavicon, SystemFaviconName } from "../types/browser";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function faviconSourceValue(value: unknown): FaviconSource | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!isRecord(value)) return undefined;
  if (value.kind === "system" && isSystemFaviconName(value.icon)) {
    return { kind: "system", icon: value.icon };
  }
  if (value.kind === "image" && typeof value.src === "string" && value.src) {
    return {
      kind: "image",
      src: value.src,
      ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
    };
  }
  if (value.kind !== "glyph" || typeof value.glyph !== "string" || !value.glyph) return undefined;
  return {
    kind: "glyph",
    glyph: [...value.glyph].slice(0, 2).join(""),
    foreground: colorValue(value.foreground) ?? "#ffffff",
    background: colorValue(value.background) ?? "#2563eb",
    shape: value.shape === "circle" || value.shape === "square" ? value.shape : "rounded-square",
  };
}

export function systemFavicon(icon: SystemFaviconName): FaviconSource {
  return { kind: "system", icon };
}

function isSystemFaviconName(value: unknown): value is SystemFaviconName {
  return value === "new-tab" || value === "settings" || value === "history"
    || value === "activity" || value === "capabilities" || value === "generation-debug";
}

export function deterministicGlyphFavicon(seed: string, glyph: string): GlyphFavicon {
  const hash = stableHash(seed || glyph || "vibesurfer");
  const hue = hash % 360;
  const saturation = 58 + ((hash >>> 9) % 25);
  const lightness = 34 + ((hash >>> 17) % 17);
  const background = hslToHex(hue, saturation, lightness);
  return {
    kind: "glyph",
    glyph: [...(glyph || "•")].slice(0, 2).join(""),
    foreground: contrastColor(background),
    background,
    shape: ["circle", "rounded-square", "square"][hash % 3] as GlyphFavicon["shape"],
  };
}

export function isHostOwnedFaviconImage(source: string): boolean {
  return /^data:image\/(?:avif|gif|jpeg|jpg|png|svg\+xml|webp);/i.test(source)
    && source.length <= 2 * 1024 * 1024;
}

function colorValue(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : undefined;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = l - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function contrastColor(background: string): "#000000" | "#ffffff" {
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(background.slice(offset, offset + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const luminance = red * .2126 + green * .7152 + blue * .0722;
  const blackContrast = (luminance + .05) / .05;
  const whiteContrast = 1.05 / (luminance + .05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
