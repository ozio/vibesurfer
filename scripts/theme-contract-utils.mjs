import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STYLES_ROOT = join(PROJECT_ROOT, "src/styles");
export const THEMES_ROOT = join(STYLES_ROOT, "themes");

export function projectPath(...segments) {
  return join(PROJECT_ROOT, ...segments);
}

export function displayPath(filename) {
  return relative(PROJECT_ROOT, filename);
}

export function themeStylesheetPath(themeId) {
  return join(THEMES_ROOT, themeId, "theme.css");
}

export function readRegisteredThemeIds() {
  const source = readFileSync(projectPath("src/browser/browser-experience-registry.ts"), "utf8");
  const tuple = source.match(/export const BROWSER_THEME_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!tuple) throw new Error("Could not read BROWSER_THEME_IDS from browser-experience-registry.ts");
  return [...tuple[1].matchAll(/["']([a-z][a-z0-9-]*)["']/g)].map((match) => match[1]);
}

export function readThemeTokenNames(exportName) {
  const source = readFileSync(projectPath("src/components/ui/theme-tokens.ts"), "utf8");
  const declaration = source.match(new RegExp(`export const ${exportName}\\s*=\\s*\\[([\\s\\S]*?)\\] as const`));
  if (!declaration) throw new Error(`Could not read ${exportName} from theme-tokens.ts`);
  return [...declaration[1].matchAll(/name:\s*["'](--[a-z0-9-]+)["']/g)].map((match) => match[1]);
}

export function readRuleCustomProperties(css, selector) {
  const source = stripCssComments(css);
  const selectorIndex = source.indexOf(`${selector} {`);
  if (selectorIndex < 0) return new Map();
  const openingBrace = source.indexOf("{", selectorIndex);
  let depth = 0;
  let closingBrace = -1;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) {
      closingBrace = index;
      break;
    }
  }
  if (closingBrace < 0) throw new Error(`Unclosed CSS rule for ${selector}`);
  const body = source.slice(openingBrace + 1, closingBrace);
  return new Map(
    [...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/gm)].map((match) => [match[1], match[2].trim()]),
  );
}

export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function listCssFiles(directory = STYLES_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) return listCssFiles(filename);
    return entry.isFile() && entry.name.endsWith(".css") ? [filename] : [];
  });
}

export function cssCustomPropertyNames(css) {
  return [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]);
}

export function cssVariableUsages(css) {
  return [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]);
}
