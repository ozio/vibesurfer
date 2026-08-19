import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface Notice {
  id: string;
  name: string;
  version: string;
  license: string;
  source: string;
  surfaces: string[];
}

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "src/generated/third-party-notices.json"), "utf8")) as {
  schemaVersion: number;
  appVersion: string;
  generatedFrom: Record<string, { path: string; sha256: string }>;
  notices: Notice[];
};

describe("third-party notices", () => {
  it("contains unique, complete entries for every capability renderer", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    for (const source of Object.values(manifest.generatedFrom)) {
      expect(source.path).not.toBe("");
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(new Set(manifest.notices.map(({ id }) => id)).size).toBe(manifest.notices.length);
    for (const notice of manifest.notices) {
      expect(notice.name).not.toBe("");
      expect(notice.version).not.toBe("");
      expect(notice.license).not.toMatch(/^(?:UNKNOWN|UNLICENSED)$/i);
      expect(notice.source).toMatch(/^https:\/\//);
      expect(notice.surfaces.length).toBeGreaterThan(0);
    }
    expect(manifest.notices.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "npm:vega-lite@6.4.3",
      "npm:vega@6.4.0",
      "npm:beautiful-mermaid@1.1.3",
      "npm:katex@0.18.4",
      "npm:shiki@4.4.3",
      "npm:qrcode@1.5.4",
      "npm:@dicebear/core@9.4.3",
      "npm:@dicebear/collection@9.4.2",
    ]));
  });
});
