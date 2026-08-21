/// <reference lib="webworker" />

import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

type SpeechRequest = { id: string; text: string; voice: string; speed: number };

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${self.location.origin}/models/`;
env.useBrowserCache = false;
const wasm = env.backends.onnx.wasm;
if (!wasm) throw new Error("ONNX WebAssembly runtime is unavailable.");
wasm.wasmPaths = `${self.location.origin}/ort/`;
wasm.numThreads = 1;

const trustedFetch = self.fetch.bind(self);
self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), self.location.origin);
  const pinnedVoice = "/models/onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_heart.bin";
  if (url.hostname === "huggingface.co" && url.pathname.endsWith("/voices/af_heart.bin")) {
    return trustedFetch(new URL(pinnedVoice, self.location.origin), init);
  }
  if (url.origin !== self.location.origin) return Promise.reject(new Error("Remote speech assets are disabled."));
  return trustedFetch(input, init);
}) as typeof fetch;

let model: Promise<KokoroTTS> | undefined;

async function tts() {
  model ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm" });
  return model;
}

self.addEventListener("message", (event: MessageEvent<SpeechRequest>) => {
  const request = event.data;
  if (!request || typeof request.id !== "string" || typeof request.text !== "string" || request.text.length > 4_000) return;
  void tts().then(async (engine) => {
    const audio = await engine.generate(request.text, { voice: "af_heart", speed: Math.max(0.6, Math.min(1.5, request.speed)) });
    const buffer = await audio.toBlob().arrayBuffer();
    self.postMessage({ id: request.id, ok: true, buffer }, { transfer: [buffer] });
  }).catch((error: unknown) => {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});
