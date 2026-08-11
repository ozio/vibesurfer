import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = {
  "darwin-arm64": { rust: "aarch64-apple-darwin", bun: "bun-darwin-arm64" },
  "darwin-x64": { rust: "x86_64-apple-darwin", bun: "bun-darwin-x64" },
  "linux-arm64": { rust: "aarch64-unknown-linux-gnu", bun: "bun-linux-arm64" },
  "linux-x64": { rust: "x86_64-unknown-linux-gnu", bun: "bun-linux-x64" },
  "win32-x64": { rust: "x86_64-pc-windows-msvc", bun: "bun-windows-x64" },
};

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const current = targets[`${process.platform}-${process.arch}`];
const rustTarget = option("--rust-target") ?? current?.rust;
const bunTarget = option("--bun-target") ?? current?.bun;
if (!rustTarget || !bunTarget) {
  process.stderr.write("Unsupported platform. Pass --rust-target and --bun-target explicitly.\n");
  process.exit(2);
}
const extension = rustTarget.split("-").includes("windows") ? ".exe" : "";

const outputDirectory = resolve(root, option("--out-dir") ?? "sidecars");
const output = resolve(outputDirectory, `vibesurfer-generation-worker-${rustTarget}${extension}`);
if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${output}\n`);
  process.exit(0);
}
mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(
  "bun",
  ["build", resolve(root, "src/index.ts"), "--compile", `--target=${bunTarget}`, `--outfile=${output}`],
  { cwd: root, stdio: "inherit" },
);
if (result.error) {
  process.stderr.write("Bun is required to compile the self-contained sidecar.\n");
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
if (!extension) {
  chmodSync(output, 0o755);
}
process.stdout.write(`${output}\n`);
