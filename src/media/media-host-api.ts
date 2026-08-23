import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/platform";
import type { VideoCaptionWord } from "./video-types";

interface HostMediaAsset {
  mimeType: string;
  assetUrl: string;
  durationMs: number;
  captionWords?: VideoCaptionWord[];
  cacheHit: boolean;
}

export interface MediaVoice {
  id: string;
  name: string;
  category?: string;
}

export interface MediaConnection {
  id: string;
  profileId: string;
  provider: "elevenlabs";
  displayName: string;
  secretRef: string;
  status: "valid" | "invalid";
  lastVerifiedAt?: string;
  voices: MediaVoice[];
}

export interface HostSpeechRequest {
  requestId: string;
  profileId: string;
  engine: "local" | "system" | "cloud";
  connectionId?: string;
  provider: "kokoro" | "openai" | "elevenlabs" | "deepgram";
  model: string;
  voice: string;
  speed: number;
  text: string;
  lang: string;
}

export interface HostMusicRequest {
  requestId: string;
  profileId: string;
  connectionId: string;
  prompt: string;
  durationMs: number;
}

export interface LocalSpeechCacheKey {
  profileId: string;
  model: string;
  voice: string;
  speed: number;
  text: string;
  lang: string;
}

export interface BrowserMediaAsset {
  blob: Blob;
  durationMs: number;
  captionWords?: VideoCaptionWord[];
  cacheHit: boolean;
}

export async function renderHostSpeech(request: HostSpeechRequest): Promise<BrowserMediaAsset> {
  if (!isTauri()) throw new Error(`${request.engine === "cloud" ? "Cloud" : request.engine === "local" ? "Local" : "System"} speech requires the desktop host.`);
  const response = await invokeHost<HostMediaAsset>("render_media_speech", { request });
  return await fromHostAsset(response);
}

export async function generateHostMusic(request: HostMusicRequest): Promise<BrowserMediaAsset> {
  if (!isTauri()) throw new Error("Generated music requires the desktop host.");
  const response = await invoke<HostMediaAsset>("generate_media_music", { request });
  return await fromHostAsset(response);
}

export async function getCachedLocalSpeech(request: LocalSpeechCacheKey): Promise<BrowserMediaAsset | undefined> {
  if (!isTauri()) return undefined;
  const response = await invoke<HostMediaAsset | null>("get_cached_local_speech", { request });
  return response ? await fromHostAsset(response) : undefined;
}

export async function cacheLocalSpeech(request: LocalSpeechCacheKey, asset: { blob: Blob; durationMs: number }): Promise<BrowserMediaAsset> {
  if (!isTauri()) return { ...asset, cacheHit: false };
  const dataBase64 = bytesToBase64(new Uint8Array(await asset.blob.arrayBuffer()));
  const response = await invoke<HostMediaAsset>("cache_local_speech", {
    request: { ...request, mimeType: "audio/wav", dataBase64, durationMs: asset.durationMs },
  });
  return await fromHostAsset(response);
}

export async function listMediaConnections(profileId: string): Promise<MediaConnection[]> {
  if (!isTauri()) return [];
  return invoke<MediaConnection[]>("list_media_connections", { profileId });
}

export async function saveMediaConnection(input: {
  id: string;
  profileId: string;
  displayName: string;
  apiKey: string;
}): Promise<MediaConnection> {
  if (!isTauri()) throw new Error("Media connections require the desktop host.");
  return invoke<MediaConnection>("save_media_connection", { input });
}

export async function verifyMediaConnection(profileId: string, id: string): Promise<MediaConnection> {
  if (!isTauri()) throw new Error("Media connections require the desktop host.");
  return invoke<MediaConnection>("verify_media_connection", { profileId, id });
}

export async function removeMediaConnection(profileId: string, id: string): Promise<void> {
  if (!isTauri()) throw new Error("Media connections require the desktop host.");
  await invoke("delete_media_connection", { profileId, id });
}

export async function cancelHostMedia(requestId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_media_request", { requestId });
}

async function fromHostAsset(asset: HostMediaAsset): Promise<BrowserMediaAsset> {
  if (!asset.mimeType.startsWith("audio/") || !Number.isFinite(asset.durationMs) || asset.durationMs <= 0) {
    throw new Error("The media host returned an invalid audio asset.");
  }
  const response = await fetch(asset.assetUrl, { credentials: "omit", cache: "force-cache" });
  if (!response.ok) throw new Error("The media host asset is no longer available.");
  const blob = await response.blob();
  if (!blob.type.startsWith("audio/") || blob.size === 0) throw new Error("The media host returned invalid audio bytes.");
  return {
    blob,
    durationMs: Math.round(asset.durationMs),
    ...(asset.captionWords?.length ? { captionWords: asset.captionWords } : {}),
    cacheHit: asset.cacheHit,
  };
}

async function invokeHost<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
