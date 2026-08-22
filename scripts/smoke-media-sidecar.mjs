import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const targets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error("Unsupported media sidecar smoke platform.");
const extension = process.platform === "win32" ? ".exe" : "";
const executable = resolve(`src-tauri/sidecars/vibesurfer-media-worker-${target}${extension}`);
const runtimeDirectory = resolve("src-tauri/sidecars/media-runtime");
const result = spawnSync(executable, [resolve("public/models")], {
  input: JSON.stringify({ text: "Offline media worker smoke test.", voice: "af_heart", speed: 1 }),
  encoding: null,
  maxBuffer: 16 * 1024 * 1024,
  timeout: 30_000,
  env: {
    ...process.env,
    ...(process.platform === "darwin" ? { DYLD_LIBRARY_PATH: runtimeDirectory } : {}),
    ...(process.platform === "linux" ? { LD_LIBRARY_PATH: runtimeDirectory } : {}),
    ...(process.platform === "win32" ? { PATH: `${runtimeDirectory};${process.env.PATH ?? ""}` } : {}),
  },
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`media sidecar failed: ${result.stderr.toString("utf8").trim()}`);
if (result.stdout.byteLength < 44 || result.stdout.toString("ascii", 0, 4) !== "RIFF" || result.stdout.toString("ascii", 8, 12) !== "WAVE") {
  throw new Error("media sidecar did not return a valid WAV file");
}
process.stdout.write(`media sidecar smoke passed (${result.stdout.byteLength} WAV bytes)\n`);
