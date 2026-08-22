export interface LocalSpeechRequest { id: string; text: string; voice: string; speed: number }

export interface RenderedSpeechAsset {
  blob: Blob;
  durationMs: number;
}

interface LocalSpeechWorkerAsset {
  path: string;
  mimeType: string;
  buffer: ArrayBuffer;
}

interface LocalSpeechWorkerMessage {
  type?: "initialized" | "progress" | "rendered";
  id?: string;
  ok: boolean;
  buffer?: ArrayBuffer;
  error?: string;
  phase?: "loading-model" | "rendering" | "encoding";
}

export type SpeechRenderProgress = "Loading local voice runtime" | "Loading Kokoro model" | "Rendering narration" | "Encoding narration";

const LOCAL_SPEECH_ASSETS = [
  ["/models/onnx-community/Kokoro-82M-v1.0-ONNX/config.json", "application/json"],
  ["/models/onnx-community/Kokoro-82M-v1.0-ONNX/tokenizer.json", "application/json"],
  ["/models/onnx-community/Kokoro-82M-v1.0-ONNX/tokenizer_config.json", "application/json"],
  ["/models/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx", "application/octet-stream"],
  ["/models/onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_heart.bin", "application/octet-stream"],
  ["/ort/ort-wasm-simd-threaded.jsep.wasm", "application/wasm"],
] as const;

let localSpeechAssetBlobs: Promise<readonly { path: string; mimeType: string; blob: Blob }[]> | undefined;

async function loadLocalSpeechAssets() {
  localSpeechAssetBlobs ??= Promise.all(LOCAL_SPEECH_ASSETS.map(async ([path, mimeType]) => {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Packaged local speech asset is unavailable: ${path}`);
    return { path, mimeType, blob: await response.blob() };
  })).catch((error: unknown) => {
    localSpeechAssetBlobs = undefined;
    throw error;
  });
  return localSpeechAssetBlobs;
}

export class SpeechAssetRenderer {
  #worker?: Worker;
  #workerReady?: Promise<Worker>;
  #workerFailure?: Error;
  #audio?: HTMLAudioElement;
  #pending = new Map<string, { reject: (error: Error) => void; timeout: number }>();
  #cache = new Map<string, RenderedSpeechAsset>();
  #activeId?: string;

  async play(request: LocalSpeechRequest): Promise<void> {
    this.cancel();
    this.#activeId = request.id;
    const asset = await this.render(request);
    if (this.#activeId !== request.id) throw new DOMException("Speech cancelled", "AbortError");
    const url = URL.createObjectURL(asset.blob);
    const audio = new Audio(url);
    this.#audio = audio;
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("Local speech playback failed.")), { once: true });
      void audio.play().catch(reject);
    }).finally(() => {
      URL.revokeObjectURL(url);
      if (this.#audio === audio) this.#audio = undefined;
      if (this.#activeId === request.id) this.#activeId = undefined;
    });
  }

  async render(request: LocalSpeechRequest, onProgress?: (label: SpeechRenderProgress) => void): Promise<RenderedSpeechAsset> {
    const key = await speechCacheKey(request);
    const cached = this.#cache.get(key);
    if (cached) return cached;
    const blob = await this.#generate(request, onProgress);
    const buffer = await blob.arrayBuffer();
    const asset = { blob, durationMs: wavDurationMs(buffer) };
    this.#cache.set(key, asset);
    return asset;
  }

  cancel() {
    this.#activeId = undefined;
    if (this.#audio) {
      this.#audio.pause();
      this.#audio.src = "";
      this.#audio = undefined;
    }
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new DOMException("Speech cancelled", "AbortError"));
    }
    this.#pending.clear();
  }

  dispose() {
    this.cancel();
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#workerReady = undefined;
  }

  async #generate(request: LocalSpeechRequest, onProgress?: (label: SpeechRenderProgress) => void): Promise<Blob> {
    onProgress?.("Loading local voice runtime");
    const worker = await this.#readyWorker();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.removeEventListener("message", onMessage);
        this.#pending.delete(request.id);
        const error = new Error("Local speech generation timed out.");
        this.#failWorker(error);
        reject(error);
      }, 120_000);
      this.#pending.set(request.id, { reject, timeout });
      const onMessage = (event: MessageEvent<LocalSpeechWorkerMessage>) => {
        if (event.data.id !== request.id) return;
        if (event.data.type === "progress") {
          const labels: Record<NonNullable<LocalSpeechWorkerMessage["phase"]>, SpeechRenderProgress> = {
            "loading-model": "Loading Kokoro model",
            rendering: "Rendering narration",
            encoding: "Encoding narration",
          };
          if (event.data.phase) onProgress?.(labels[event.data.phase]);
          return;
        }
        if (event.data.type !== "rendered") return;
        worker.removeEventListener("message", onMessage);
        window.clearTimeout(timeout);
        this.#pending.delete(request.id);
        if (event.data.ok && event.data.buffer) resolve(new Blob([event.data.buffer], { type: "audio/wav" }));
        else reject(new Error(event.data.error ?? "Local speech generation failed."));
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ type: "render", request });
    });
  }

  #readyWorker(): Promise<Worker> {
    if (this.#workerFailure) return Promise.reject(this.#workerFailure);
    if (this.#workerReady) return this.#workerReady;
    const worker = this.#worker ??= new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module", name: "vibesurfer-kokoro" });
    worker.addEventListener("error", (event) => this.#failWorker(new Error(event.message || "Local speech worker failed to load.")));
    worker.addEventListener("messageerror", () => this.#failWorker(new Error("Local speech worker returned an unreadable message.")));
    this.#workerReady = (async () => {
      const assets = await loadLocalSpeechAssets();
      const transferred: LocalSpeechWorkerAsset[] = await Promise.all(assets.map(async (asset) => ({
        path: asset.path,
        mimeType: asset.mimeType,
        buffer: await asset.blob.arrayBuffer(),
      })));
      return new Promise<Worker>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          worker.removeEventListener("message", onMessage);
          const error = new Error("Local speech worker initialization timed out.");
          this.#failWorker(error);
          reject(error);
        }, 15_000);
        const onMessage = (event: MessageEvent<LocalSpeechWorkerMessage>) => {
          if (event.data.type !== "initialized") return;
          worker.removeEventListener("message", onMessage);
          window.clearTimeout(timeout);
          if (event.data.ok) resolve(worker);
          else {
            const error = new Error(event.data.error ?? "Local speech worker initialization failed.");
            this.#failWorker(error);
            reject(error);
          }
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ type: "initialize", assets: transferred }, { transfer: transferred.map((asset) => asset.buffer) });
      });
    })().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.#failWorker(failure);
      throw failure;
    });
    return this.#workerReady;
  }

  #failWorker(error: Error) {
    this.#workerFailure ??= error;
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(this.#workerFailure);
    }
    this.#pending.clear();
    this.#worker?.terminate();
    this.#worker = undefined;
  }
}

export { SpeechAssetRenderer as LocalSpeechPlayer };

export function wavDurationMs(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const label = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.byteLength < 44 || label(0) !== "RIFF" || label(8) !== "WAVE") {
    throw new Error("Local speech returned an invalid WAV file.");
  }
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const chunk = label(offset);
    const size = view.getUint32(offset + 4, true);
    if (chunk === "fmt " && size >= 12 && offset + 8 + size <= bytes.byteLength) {
      byteRate = view.getUint32(offset + 16, true);
    } else if (chunk === "data") {
      dataBytes = Math.min(size, bytes.byteLength - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (byteRate <= 0 || dataBytes <= 0) throw new Error("Local speech WAV has no playable audio data.");
  return Math.max(1, Math.round(dataBytes / byteRate * 1_000));
}

async function speechCacheKey(request: Omit<LocalSpeechRequest, "id">) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
