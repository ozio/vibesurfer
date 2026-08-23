// These focused imports keep image-only native dependencies (notably sharp)
// out of the speech executable while retaining the exact Transformers.js
// model implementation used by Kokoro.
// @ts-expect-error Transformers.js does not publish declarations for focused source imports.
import { env } from "../../node_modules/@huggingface/transformers/src/env.js";
// @ts-expect-error Transformers.js does not publish declarations for focused source imports.
import { StyleTextToSpeech2Model } from "../../node_modules/@huggingface/transformers/src/models.js";
// @ts-expect-error Transformers.js does not publish declarations for focused source imports.
import { AutoTokenizer } from "../../node_modules/@huggingface/transformers/src/tokenizers.js";
// @ts-expect-error Transformers.js does not publish declarations for focused source imports.
import { Tensor } from "../../node_modules/@huggingface/transformers/src/utils/tensor.js";
import { once } from "node:events";
import { phonemize } from "phonemizer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

interface LocalSpeechSidecarRequest {
  requestId: string;
  text: string;
  voice: "af_heart";
  speed: number;
}

function parseRequest(line: string): LocalSpeechSidecarRequest {
  const value = JSON.parse(line) as Partial<LocalSpeechSidecarRequest>;
  if (typeof value.requestId !== "string" || value.requestId.length < 1 || value.requestId.length > 160) {
    throw new Error("speech request id is invalid");
  }
  if (typeof value.text !== "string" || value.text.trim().length === 0 || [...value.text].length > 800) {
    throw new Error("speech text must contain 1 to 800 characters");
  }
  if (value.voice !== "af_heart") throw new Error("unsupported packaged Kokoro voice");
  if (typeof value.speed !== "number" || !Number.isFinite(value.speed) || value.speed < 0.6 || value.speed > 1.5) {
    throw new Error("speech speed must be between 0.6 and 1.5");
  }
  return { requestId: value.requestId, text: value.text, voice: value.voice, speed: value.speed };
}

async function main() {
  const modelRoot = process.argv[2];
  if (!modelRoot) throw new Error("the packaged model directory is required");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.localModelPath = `${resolve(modelRoot).replace(/\/$/, "")}/`;

  const modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const [model, tokenizer, voiceBytes] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(modelId, { dtype: "q8", device: "cpu" }),
    AutoTokenizer.from_pretrained(modelId),
    readFile(resolve(modelRoot, modelId, "voices", "af_heart.bin")),
  ]);
  await writeJsonLine({ type: "ready", protocolVersion: 1 });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let requestId: string | undefined;
    try {
      const request = parseRequest(line);
      requestId = request.requestId;
      const wav = await renderSpeech(model, tokenizer, voiceBytes, request);
      await writeJsonLine({ type: "audio", requestId, byteLength: wav.byteLength });
      await writeBuffer(wav);
    } catch (error) {
      await writeJsonLine({
        type: "error",
        ...(requestId ? { requestId } : {}),
        message: error instanceof Error ? error.message.slice(0, 512) : "local speech failed",
      });
    }
  }
}

async function renderSpeech(
  model: Awaited<ReturnType<typeof StyleTextToSpeech2Model.from_pretrained>>,
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>,
  voiceBytes: Buffer,
  request: LocalSpeechSidecarRequest,
): Promise<Buffer> {
  const phonemes = (await phonemize(normalizeText(request.text), "en-us")).join(" ")
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .trim();
  const { input_ids: inputIds } = tokenizer(phonemes, { truncation: true });
  const voiceData = new Float32Array(voiceBytes.buffer.slice(voiceBytes.byteOffset, voiceBytes.byteOffset + voiceBytes.byteLength));
  const tokenCount = Number(inputIds.dims.at(-1) ?? 0);
  const styleOffset = 256 * Math.min(Math.max(tokenCount - 2, 0), 509);
  const style = voiceData.slice(styleOffset, styleOffset + 256);
  const { waveform } = await model({
    input_ids: inputIds,
    style: new Tensor("float32", style, [1, 256]),
    speed: new Tensor("float32", [request.speed], [1]),
  });
  const wav = pcm16Wav(waveform.data as Float32Array, 24_000);
  if (wav.byteLength < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Kokoro returned an invalid WAV file");
  }
  return wav;
}

async function writeJsonLine(value: unknown): Promise<void> {
  await writeBuffer(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
}

async function writeBuffer(value: Buffer): Promise<void> {
  if (!process.stdout.write(value)) await once(process.stdout, "drain");
}

function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/[、，]/g, ", ")
    .replace(/[。]/g, ". ")
    .replace(/[！]/g, "! ")
    .replace(/[？]/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function pcm16Wav(samples: Float32Array, sampleRate: number): Buffer {
  const bytes = Buffer.allocUnsafe(44 + samples.length * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    bytes.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), 44 + index * 2);
  }
  return bytes;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
