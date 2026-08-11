import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const shell = readFileSync(resolve(root, "dist/artifact-frame.html"), "utf8");
const runtimeSource = readFileSync(resolve(root, "src/artifacts/frame-runtime.js"), "utf8");
const tauriConfig = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const scripts = Array.from(shell.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
const scriptOpenings = shell.match(/<script\b/gi) ?? [];
const scriptClosings = shell.match(/<\/script>/gi) ?? [];
assert(scriptOpenings.length === 1 && scriptClosings.length === 1, "Artifact shell must contain one well-formed script element.");
assert(scripts.length === 1, `Artifact shell must contain exactly one script; found ${scripts.length}.`);
assert(!/\bsrc\s*=/i.test(scripts[0][1]), "Artifact shell runtime must not use an external src.");
assert(!/\btype\s*=/i.test(scripts[0][1]), "Artifact shell runtime must be a classic inline script.");
assert(scripts[0][2] === runtimeSource, "Built artifact shell runtime bytes drifted from frame-runtime.js.");
assert(!runtimeSource.toLowerCase().includes("</script"), "Artifact runtime contains a closing script sequence.");
assert(!/__FRAME_RUNTIME_CSP_HASH__/.test(shell), "Artifact shell CSP hash placeholder was not replaced.");
assert(!/<(?:link\b|iframe\b|object\b|embed\b)/i.test(shell), "Artifact shell contains a subresource or nested browsing context.");

const hash = `sha256-${createHash("sha256").update(runtimeSource).digest("base64")}`;
const contentAttributes = Array.from(shell.matchAll(/\bcontent="([^"]*)"/gi), (match) => match[1]);
const shellCsp = contentAttributes.find((content) => content.includes("default-src 'none'")) ?? "";
const outerCsp = tauriConfig.app?.security?.csp ?? "";
const shellScripts = directive(shellCsp, "script-src");
const outerScripts = directive(outerCsp, "script-src");

assert(shellScripts === `script-src '${hash}'`, "Artifact shell CSP does not pin the exact runtime hash.");
assert(outerScripts.includes(`'${hash}'`), "Tauri CSP does not authorize the exact artifact runtime hash.");
assert(!/'unsafe-inline'|\bdata:|\bblob:/.test(outerScripts), "Tauri script-src contains a broad script source.");
assert(directive(outerCsp, "frame-src") === "frame-src 'self'", "Tauri must frame only local application assets.");
assert(directive(shellCsp, "connect-src") === "connect-src 'none'", "Artifact shell must disable network connections.");

process.stdout.write(`artifact frame shell verified (${runtimeSource.length} bytes, ${hash})\n`);

function directive(csp, name) {
  return csp.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name} `)) ?? "";
}
