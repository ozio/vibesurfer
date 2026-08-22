import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
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
const extension = rustTarget.includes("windows") ? ".exe" : "";
const outputDirectory = resolve(root, option("--out-dir") ?? "src-tauri/sidecars");
const output = resolve(outputDirectory, `vibesurfer-media-worker-${rustTarget}${extension}`);
if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${output}\n`);
  process.exit(0);
}
mkdirSync(outputDirectory, { recursive: true });

if (typeof Bun === "undefined") {
  process.stderr.write("Run this script with Bun to compile the media sidecar.\n");
  process.exit(1);
}
const sharpStub = resolve(root, "src/media/sharp-stub.ts");
const result = await Bun.build({
  entrypoints: [resolve(root, "src/media/kokoro-sidecar.ts")],
  compile: { target: bunTarget, outfile: output },
  plugins: [{
    name: "speech-only-native-stubs",
    setup(build) {
      build.onResolve({ filter: /^sharp$/ }, () => ({ path: sharpStub }));
    },
  }],
});
if (!result.success) {
  for (const log of result.logs) process.stderr.write(`${log}\n`);
  process.exit(1);
}
if (!extension) chmodSync(output, 0o755);

if (process.platform === "darwin") {
  for (const runpath of [
    "@executable_path/media-runtime",
    "@executable_path/../Resources/sidecars/media-runtime",
  ]) {
    const patched = spawnSync("install_name_tool", ["-add_rpath", runpath, output], { encoding: "utf8" });
    if (patched.status !== 0 && !patched.stderr.includes("would duplicate path")) {
      throw new Error(`Could not add the ONNX runtime runpath: ${patched.stderr.trim()}`);
    }
  }
  const signed = spawnSync("codesign", ["--force", "--sign", "-", output], { encoding: "utf8" });
  if (signed.status !== 0) throw new Error(`Could not sign the media sidecar: ${signed.stderr.trim()}`);
}

const nativeRuntime = {
  "darwin-arm64": ["bin/napi-v3/darwin/arm64/libonnxruntime.1.21.0.dylib"],
  "darwin-x64": ["bin/napi-v3/darwin/x64/libonnxruntime.1.21.0.dylib"],
  "linux-arm64": ["bin/napi-v3/linux/arm64/libonnxruntime.so.1.21.0"],
  "linux-x64": ["bin/napi-v3/linux/x64/libonnxruntime.so.1.21.0"],
  "win32-x64": ["bin/napi-v3/win32/x64/onnxruntime.dll"],
}[`${process.platform}-${process.arch}`] ?? [];
const runtimeDirectory = resolve(outputDirectory, "media-runtime");
mkdirSync(runtimeDirectory, { recursive: true });
for (const relativePath of nativeRuntime) {
  const source = resolve(root, "node_modules/onnxruntime-node", relativePath);
  copyFileSync(source, resolve(runtimeDirectory, relativePath.split("/").at(-1)));
}
process.stdout.write(`${output}\n`);
