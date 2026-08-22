import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  STYLES_ROOT,
  THEMES_ROOT,
  cssCustomPropertyNames,
  cssVariableUsages,
  displayPath,
  listCssFiles,
  projectPath,
  readRegisteredThemeIds,
  readRuleCustomProperties,
  readThemeTokenNames,
  themeStylesheetPath,
} from "./theme-contract-utils.mjs";

const errors = [];
const themeIds = readRegisteredThemeIds();
const foundationTokens = readThemeTokenNames("UI_THEME_TOKENS");
const componentTokens = readThemeTokenNames("UI_COMPONENT_THEME_TOKENS");
const cssFiles = listCssFiles();
const appCss = readFileSync(projectPath("src/styles/app.css"), "utf8");

if (new Set(themeIds).size !== themeIds.length) errors.push("BROWSER_THEME_IDS contains duplicate IDs");
if (new Set(foundationTokens).size !== foundationTokens.length) errors.push("UI_THEME_TOKENS contains duplicate tokens");
if (new Set(componentTokens).size !== componentTokens.length) errors.push("UI_COMPONENT_THEME_TOKENS contains duplicate tokens");

const neutralProperties = readRuleCustomProperties(readFileSync(projectPath("src/styles/tokens.css"), "utf8"), ":root");
reportMissing("src/styles/tokens.css neutral :root", foundationTokens, neutralProperties);

const componentProperties = readRuleCustomProperties(readFileSync(projectPath("src/styles/component-tokens.css"), "utf8"), ":root");
reportMissing("src/styles/component-tokens.css :root", componentTokens, componentProperties);

for (const themeId of themeIds) {
  const filename = themeStylesheetPath(themeId);
  const expectedImport = `@import "./themes/${themeId}/theme.css" layer(themes);`;
  if (!existsSync(filename)) {
    errors.push(`Missing canonical stylesheet ${displayPath(filename)}`);
    continue;
  }
  if (!appCss.includes(expectedImport)) errors.push(`src/styles/app.css must import ${expectedImport}`);
  const css = readFileSync(filename, "utf8");
  const selector = `:root[data-theme="${themeId}"]`;
  const selectorCount = [...css.matchAll(new RegExp(`${escapeRegExp(selector)}\\s*\\{`, "g"))].length;
  if (selectorCount !== 1) errors.push(`${displayPath(filename)} must contain exactly one complete ${selector} rule; found ${selectorCount}`);
  reportMissing(`${displayPath(filename)} ${selector}`, foundationTokens, readRuleCustomProperties(css, selector));

  for (const candidate of cssFiles) {
    if (candidate === filename) continue;
    const candidateCss = readFileSync(candidate, "utf8");
    if (candidateCss.includes(`data-theme="${themeId}"`)) {
      errors.push(`Theme ${themeId} leaks into ${displayPath(candidate)}; keep its selectors in ${displayPath(filename)}`);
    }
  }
}

const themeDirectories = readdirSync(THEMES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(themeStylesheetPath(entry.name)))
  .map((entry) => entry.name);
for (const directory of themeDirectories) {
  if (!themeIds.includes(directory)) errors.push(`Unregistered theme stylesheet: src/styles/themes/${directory}/theme.css`);
}

const cssByFile = new Map(cssFiles.map((filename) => [filename, readFileSync(filename, "utf8")]));
const declaredVariables = new Set([...cssByFile.values()].flatMap(cssCustomPropertyNames));
for (const [filename, css] of cssByFile) {
  for (const variable of cssVariableUsages(css)) {
    if (declaredVariables.has(variable) || variable.startsWith("--radix-") || variable === "--ui-range-progress") continue;
    errors.push(`${displayPath(filename)} uses unresolved ${variable}`);
  }
  if (/:nth-(?:child|of-type)\(/.test(css)) errors.push(`${displayPath(filename)} uses a positional nth selector; add an explicit component slot`);
  if (css.includes("--text-muted")) errors.push(`${displayPath(filename)} uses removed --text-muted; use --muted`);
}

const componentUsageCss = [...cssByFile]
  .filter(([filename]) => filename !== projectPath("src/styles/component-tokens.css"))
  .map(([, css]) => css)
  .join("\n");
for (const token of componentTokens) {
  if (!componentUsageCss.includes(`var(${token})`)) errors.push(`${token} is documented but unused by component CSS`);
}

const removedOrphans = [
  ".generation-inspector",
  ".generation-exchange",
  ".remote-surface-tools",
  ".history-entry__copy",
  ".lab-video",
  ".theme-grid",
  ".theme-card",
  ".theme-dot",
  ".icon-danger",
  ".profile-settings-list__add",
  ".prompt-starters",
  ".generation-composer__model",
  ".page-context-menu__backdrop",
];
const allCss = [...cssByFile.values()].join("\n");
for (const selector of removedOrphans) {
  if (allCss.includes(selector)) errors.push(`Confirmed orphan selector returned: ${selector}`);
}

if (errors.length > 0) {
  console.error(`Theme contract failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Theme contract valid: ${themeIds.length} themes, ${foundationTokens.length} foundation tokens, ${componentTokens.length} component tokens.`);
}

function reportMissing(label, expectedTokens, properties) {
  const missing = expectedTokens.filter((token) => !properties.has(token));
  if (missing.length > 0) errors.push(`${label} is missing ${missing.join(", ")}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
