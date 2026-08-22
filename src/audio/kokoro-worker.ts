/// <reference lib="webworker" />

import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

type SpeechRequest = { id: string; text: string; voice: string; speed: number };
type WorkerAsset = { path: string; mimeType: string; buffer: ArrayBuffer };
type WorkerMessage =
  | { type: "initialize"; assets: WorkerAsset[] }
  | { type: "render"; request: SpeechRequest };

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL("/models/", self.location.href).href;
env.useBrowserCache = false;
const wasm = env.backends.onnx.wasm;
if (!wasm) throw new Error("ONNX WebAssembly runtime is unavailable.");
wasm.numThreads = 1;

const packagedAssets = new Map<string, { mimeType: string; buffer: ArrayBuffer }>();
let initialized = false;

self.fetch = ((input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
  const pinnedVoice = "/models/onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_heart.bin";
  if (url.hostname === "huggingface.co" && url.pathname.endsWith("/voices/af_heart.bin")) {
    url.pathname = pinnedVoice;
  }
  const asset = packagedAssets.get(url.pathname);
  if (asset) return Promise.resolve(new Response(asset.buffer.slice(0), { headers: { "Content-Type": asset.mimeType } }));
  if (url.origin !== self.location.origin) return Promise.reject(new Error("Remote speech assets are disabled."));
  // A packaged Tauri custom-protocol fetch started inside a Worker may remain
  // pending forever on WebKit. Every allowed runtime asset is transferred by
  // the trusted main page, so reject anything missing instead of touching it.
  return Promise.reject(new Error(`Unpackaged local speech asset: ${url.pathname}`));
}) as typeof fetch;

let model: Promise<KokoroTTS> | undefined;

async function tts() {
  model ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm" });
  return model;
}

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  if (event.data?.type === "initialize") {
    try {
      for (const asset of event.data.assets) {
        if (!asset.path.startsWith("/") || !(asset.buffer instanceof ArrayBuffer)) throw new Error("Invalid local speech asset payload.");
        packagedAssets.set(asset.path, { mimeType: asset.mimeType, buffer: asset.buffer });
      }
      const wasmAsset = packagedAssets.get("/ort/ort-wasm-simd-threaded.jsep.wasm");
      if (!wasmAsset) throw new Error("Packaged ONNX WebAssembly is unavailable.");
      wasm.wasmBinary = wasmAsset.buffer;
      initialized = true;
      self.postMessage({ type: "initialized", ok: true });
    } catch (error: unknown) {
      self.postMessage({ type: "initialized", ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (event.data?.type !== "render" || !initialized) return;
  const request = event.data.request;
  if (!request || typeof request.id !== "string" || typeof request.text !== "string" || request.text.length > 4_000) return;
  self.postMessage({ type: "progress", id: request.id, ok: true, phase: "loading-model" });
  void tts().then(async (engine) => {
    self.postMessage({ type: "progress", id: request.id, ok: true, phase: "rendering" });
    const audio = await engine.generate(request.text, { voice: "af_heart", speed: Math.max(0.6, Math.min(1.5, request.speed)) });
    self.postMessage({ type: "progress", id: request.id, ok: true, phase: "encoding" });
    const buffer = await audio.toBlob().arrayBuffer();
    self.postMessage({ type: "rendered", id: request.id, ok: true, buffer }, { transfer: [buffer] });
  }).catch((error: unknown) => {
    self.postMessage({ type: "rendered", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});
