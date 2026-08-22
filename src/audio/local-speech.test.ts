import { describe, expect, it, vi } from "vitest";
import { SpeechAssetRenderer, wavDurationMs } from "./local-speech";

function pcmWav(durationSeconds: number, sampleRate = 16_000): ArrayBuffer {
  const samples = Math.round(durationSeconds * sampleRate);
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  return bytes;
}

describe("SpeechAssetRenderer WAV timing", () => {
  it("reads deterministic seekable fixture duration instead of estimating speech", () => {
    expect(wavDurationMs(pcmWav(2.375))).toBe(2_375);
    expect(() => wavDurationMs(new ArrayBuffer(44))).toThrow("invalid WAV");
  });

  it("preloads every pinned asset on the trusted page before asking the Worker to render", async () => {
    class FakeWorker extends EventTarget {
      static instance?: FakeWorker;
      messages: unknown[] = [];
      terminated = false;

      constructor() {
        super();
        FakeWorker.instance = this;
      }

      postMessage(message: unknown) {
        this.messages.push(message);
        const record = message as { type?: string; request?: { id?: string }; assets?: unknown[] };
        if (record.type === "initialize") {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "initialized", ok: true } })));
        } else if (record.type === "render") {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: {
            type: "progress",
            id: record.request?.id,
            ok: true,
            phase: "rendering",
          } })));
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: {
            type: "rendered",
            id: record.request?.id,
            ok: true,
            buffer: pcmWav(1.5),
          } })));
        }
      }

      terminate() { this.terminated = true; }
    }
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("fetch", fetchMock);
    const renderer = new SpeechAssetRenderer();
    const progress: string[] = [];

    const result = await renderer.render(
      { id: "speech-1", text: "A pinned fixture.", voice: "af_heart", speed: 1 },
      (label) => progress.push(label),
    );
    const initialize = FakeWorker.instance?.messages[0] as { type: string; assets: { path: string }[] };

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(initialize.type).toBe("initialize");
    expect(initialize.assets).toHaveLength(6);
    expect(initialize.assets.map((asset) => asset.path)).toContain("/ort/ort-wasm-simd-threaded.jsep.wasm");
    expect(FakeWorker.instance?.messages[1]).toMatchObject({ type: "render", request: { id: "speech-1" } });
    expect(progress).toEqual(["Loading local voice runtime", "Rendering narration"]);
    expect(result.durationMs).toBe(1_500);
    renderer.dispose();
    expect(FakeWorker.instance?.terminated).toBe(true);
    vi.unstubAllGlobals();
  });
});
