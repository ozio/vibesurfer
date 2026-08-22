export default function sharpUnavailable(): never {
  throw new Error("Image processing is not available in the speech-only media worker.");
}
