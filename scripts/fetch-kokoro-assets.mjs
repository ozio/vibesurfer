import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(import.meta.dirname, "..");
const revision = "468588286ebb2dd77c25b9771e5d165896538cce";
const model = "onnx-community/Kokoro-82M-v1.0-ONNX";
const base = `https://huggingface.co/${model}/resolve/${revision}`;
const destination = resolve(root, "public/models", model);
const assets = [
  ["config.json", "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f"],
  ["tokenizer.json", "ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb"],
  ["tokenizer_config.json", "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20"],
  ["onnx/model_quantized.onnx", "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478"],
  ["voices/af_heart.bin", "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"],
];

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

for (const [relativePath, expectedHash] of assets) {
  const output = resolve(destination, relativePath);
  await mkdir(dirname(output), { recursive: true });
  try {
    if ((await stat(output)).isFile() && await sha256(output) === expectedHash) continue;
  } catch { /* Download missing assets. */ }
  const temporary = `${output}.part`;
  await rm(temporary, { force: true });
  const response = await fetch(`${base}/${relativePath}`);
  if (!response.ok || !response.body) throw new Error(`Kokoro asset download failed (${response.status}): ${relativePath}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  const actualHash = await sha256(temporary);
  if (actualHash !== expectedHash) {
    await rm(temporary, { force: true });
    throw new Error(`Kokoro asset checksum mismatch: ${relativePath}`);
  }
  await rename(temporary, output);
}

const ortDestination = resolve(root, "public/ort");
await mkdir(ortDestination, { recursive: true });
// onnxruntime loads a small ESM bootstrap next to each WASM binary. Copy both
// halves of the selected backends so the trusted worker stays completely
// offline in development and in the packaged application.
for (const filename of [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
]) {
  await copyFile(resolve(root, "node_modules/onnxruntime-web/dist", filename), resolve(ortDestination, filename));
}

process.stdout.write(`Kokoro assets ready (${assets.length} verified files).\n`);
