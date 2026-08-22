import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  PROJECT_ROOT,
  displayPath,
  projectPath,
  readRegisteredThemeIds,
  readRuleCustomProperties,
  readThemeTokenNames,
  themeStylesheetPath,
} from "./theme-contract-utils.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.log("Usage: npm run theme:scaffold -- <theme-id> [--label \"Theme name\"] [--output-dir <directory>] [--dry-run]");
  process.exit(args.length === 0 ? 1 : 0);
}

const themeId = args.find((argument) => !argument.startsWith("--") && argument !== optionValue("--label") && argument !== optionValue("--output-dir"));
if (!themeId || !/^[a-z][a-z0-9-]*$/.test(themeId)) fail("Theme ID must be lowercase kebab-case, for example moonlight or quiet-terminal");
if (readRegisteredThemeIds().includes(themeId)) fail(`Theme ${themeId} is already registered`);

const label = (optionValue("--label") ?? titleCase(themeId)).replace(/\*\//g, "");
const outputRoot = optionValue("--output-dir") ? resolve(PROJECT_ROOT, optionValue("--output-dir")) : undefined;
const filename = outputRoot ? resolve(outputRoot, themeId, "theme.css") : themeStylesheetPath(themeId);
if (existsSync(filename)) fail(`Refusing to overwrite ${displayPath(filename)}`);

const foundationTokens = readThemeTokenNames("UI_THEME_TOKENS");
const neutralProperties = readRuleCustomProperties(readFileSync(projectPath("src/styles/tokens.css"), "utf8"), ":root");
const missing = foundationTokens.filter((token) => !neutralProperties.has(token));
if (missing.length > 0) fail(`Neutral token template is incomplete: ${missing.join(", ")}`);

const declarations = foundationTokens.map((token) => `  ${token}: ${neutralProperties.get(token)};`).join("\n");
const stylesheet = `/**\n * ${label}\n *\n * Keep the complete foundation and optional component-token overrides in this one\n * unqualified root rule. Add narrow component selectors only when tokens cannot\n * express the visual recipe.\n */\n:root[data-theme="${themeId}"] {\n  color-scheme: light;\n${declarations}\n\n  /* Optional component contract overrides belong in this same root rule.\n  --ui-control-radius: var(--radius-sm);\n  --browser-omnibox-background: var(--chrome-raised);\n  */\n}\n`;

if (args.includes("--dry-run")) {
  process.stdout.write(stylesheet);
} else {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, stylesheet);
  console.log(`Created ${displayPath(filename)}`);
  console.log("Next: register the theme in both experience registries, add its app.css import and BrowserShell story, then run npm run theme:validate.");
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function titleCase(value) {
  return value.split("-").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
