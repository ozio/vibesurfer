import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  projectPath,
  readRuleCustomProperties,
  readThemeTokenNames,
  stripCssComments,
} from "./theme-contract-utils.mjs";

describe("theme authoring tools", () => {
  it("ignores commented selectors and custom properties", () => {
    const css = `:root { --live: red; /* --example: blue; */ }\n/* :root { --duplicate: true; } */`;

    expect(stripCssComments(css)).not.toContain("duplicate");
    expect(readRuleCustomProperties(css, ":root")).toEqual(new Map([["--live", "red"]]));
  });

  it("scaffolds one complete unqualified root rule", () => {
    const css = execFileSync(process.execPath, [
      projectPath("scripts/scaffold-theme.mjs"),
      "contract-probe",
      "--label",
      "Contract Probe",
      "--dry-run",
    ], { encoding: "utf8" });
    const selector = ':root[data-theme="contract-probe"]';
    const selectorCount = [...stripCssComments(css).matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g"))].length;
    const properties = readRuleCustomProperties(css, selector);

    expect(selectorCount).toBe(1);
    for (const token of readThemeTokenNames("UI_THEME_TOKENS")) expect(properties.has(token), token).toBe(true);
  });
});
