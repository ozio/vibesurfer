import { describe, expect, it } from "vitest";

import {
  ICON_SET_IDS,
  ICONIFY_WEB_COMPONENT_SCRIPT,
  iconifyCatalog,
  iconifyPack,
} from "../src/iconify/catalog.js";

describe("generated Iconify catalog", () => {
  it("contains SVG data for every selected real name and no active SVG content", () => {
    expect(iconifyCatalog.allowedPrefixes).toEqual(ICON_SET_IDS);
    expect(iconifyCatalog.source).toBe("https://api.iconify.design/collection");
    expect(iconifyCatalog.webComponentScript).toBe(ICONIFY_WEB_COMPONENT_SCRIPT);

    for (const prefix of ICON_SET_IDS) {
      const pack = iconifyPack(prefix);
      expect(pack.prefix).toBe(prefix);
      expect(pack.names.length).toBeGreaterThanOrEqual(20);
      expect(new Set(pack.names).size).toBe(pack.names.length);
      expect(Object.keys(pack.iconData).sort()).toEqual([...pack.names].sort());
      for (const icon of Object.values(pack.iconData)) {
        expect(icon.body).toMatch(/^</);
        expect(icon.body).not.toMatch(/<\/?(?:script|foreignObject|iframe|object|embed|image|style)\b/i);
        expect(icon.width).toBeGreaterThan(0);
        expect(icon.height).toBeGreaterThan(0);
      }
    }
  });

  it("keeps Phosphor on duotone variants and attribution on CC BY packs", () => {
    expect(iconifyPack("ph").names.every((name) => name.endsWith("-duotone"))).toBe(true);
    for (const prefix of ["pepicons-pop", "streamline-cyber", "streamline-freehand", "game-icons"] as const) {
      expect(iconifyPack(prefix)).toMatchObject({
        attributionRequired: true,
        attributionHTML: expect.stringContaining('rel="license"'),
      });
    }
    expect(iconifyPack("flat-color-icons")).toMatchObject({
      palette: "multicolor",
      attributionRequired: false,
      attributionHTML: null,
    });
  });
});
