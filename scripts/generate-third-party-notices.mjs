import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "src/generated/third-party-notices.json");
const check = process.argv.includes("--check");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function sourceRecord(path) {
  const content = readFileSync(resolve(root, path));
  return { path, sha256: createHash("sha256").update(content).digest("hex") };
}

const entries = new Map();

function add(entry) {
  if (!entry.name || !entry.version || !entry.license || entry.license === "UNKNOWN") {
    throw new Error(`Third-party notice is missing required metadata: ${JSON.stringify(entry)}`);
  }
  const previous = entries.get(entry.id);
  if (previous) {
    previous.surfaces = [...new Set([...previous.surfaces, ...entry.surfaces])].sort();
    return;
  }
  entries.set(entry.id, { ...entry, surfaces: [...entry.surfaces].sort() });
}

function npmPackageName(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) return undefined;
  return path.slice(index + marker.length);
}

function collectNpm(lockPath, surface) {
  const lock = readJson(lockPath);
  for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
    const name = npmPackageName(path);
    if (!name || !metadata || metadata.dev === true || !metadata.version) continue;
    add({
      id: `npm:${name}@${metadata.version}`,
      name,
      version: metadata.version,
      license: metadata.license,
      source: `https://www.npmjs.com/package/${name}/v/${metadata.version}`,
      surfaces: [surface],
    });
  }
}

const appPackage = readJson("package.json");
collectNpm("package-lock.json", "app");
collectNpm("generation-worker/package-lock.json", "generation-worker");

const cargo = JSON.parse(execFileSync("cargo", [
  "metadata",
  "--locked",
  "--format-version",
  "1",
  "--manifest-path",
  resolve(root, "src-tauri/Cargo.toml"),
], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
for (const pkg of cargo.packages) {
  if (!pkg.source) continue;
  add({
    id: `cargo:${pkg.name}@${pkg.version}`,
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    source: pkg.repository || `https://crates.io/crates/${pkg.name}/${pkg.version}`,
    surfaces: ["rust-host"],
  });
}

const iconify = readJson("generation-worker/src/iconify/iconify-packs.generated.json");
for (const pack of Object.values(iconify.packs ?? {})) {
  add({
    id: `iconify:${pack.prefix}`,
    name: `${pack.label} icons`,
    version: iconify.generatedAt.slice(0, 10),
    license: pack.license.spdx,
    source: pack.license.url || iconify.source,
    surfaces: ["generated-artifacts"],
  });
}

const manifest = {
  schemaVersion: 1,
  appVersion: appPackage.version,
  generatedFrom: {
    npmApp: sourceRecord("package-lock.json"),
    npmWorker: sourceRecord("generation-worker/package-lock.json"),
    cargo: sourceRecord("src-tauri/Cargo.lock"),
    iconify: sourceRecord("generation-worker/src/iconify/iconify-packs.generated.json"),
    fonts: sourceRecord("docs/third-party-fonts.md"),
  },
  notices: [...entries.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version)),
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== serialized) {
    throw new Error("Third-party notices are stale. Run npm run notices:generate.");
  }
} else {
  writeFileSync(outputPath, serialized);
}
