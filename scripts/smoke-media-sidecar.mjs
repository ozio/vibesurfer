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
const requests = [
  { requestId: "media-smoke-1", text: "Offline media worker smoke test.", voice: "af_heart", speed: 1 },
  { requestId: "media-smoke-2", text: "The same worker renders a second sentence.", voice: "af_heart", speed: 1 },
];
const result = spawnSync(executable, [resolve("public/models")], {
  input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
  encoding: null,
  maxBuffer: 16 * 1024 * 1024,
  timeout: 90_000,
  env: {
    ...process.env,
    ...(process.platform === "darwin" ? { DYLD_LIBRARY_PATH: runtimeDirectory } : {}),
    ...(process.platform === "linux" ? { LD_LIBRARY_PATH: runtimeDirectory } : {}),
    ...(process.platform === "win32" ? { PATH: `${runtimeDirectory};${process.env.PATH ?? ""}` } : {}),
  },
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`media sidecar failed: ${result.stderr.toString("utf8").trim()}`);
let offset = 0;
function readHeader() {
  const end = result.stdout.indexOf(0x0a, offset);
  if (end < 0 || end - offset > 4_096) throw new Error("media sidecar returned an invalid protocol header");
  const header = JSON.parse(result.stdout.toString("utf8", offset, end));
  offset = end + 1;
  return header;
}
const ready = readHeader();
if (ready.type !== "ready" || ready.protocolVersion !== 1) throw new Error("media sidecar did not become ready");
let totalBytes = 0;
for (const request of requests) {
  const header = readHeader();
  if (header.type !== "audio" || header.requestId !== request.requestId || !Number.isInteger(header.byteLength)) {
    throw new Error("media sidecar returned an invalid audio header");
  }
  const wav = result.stdout.subarray(offset, offset + header.byteLength);
  offset += header.byteLength;
  if (wav.byteLength < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("media sidecar did not return a valid WAV file");
  }
  totalBytes += wav.byteLength;
}
if (offset !== result.stdout.byteLength) throw new Error("media sidecar returned trailing output");
process.stdout.write(`media sidecar smoke passed (2 requests, ${totalBytes} WAV bytes, one process)\n`);
