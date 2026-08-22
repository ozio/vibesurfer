import type { DynamicManifest, VoiceAudioSettings } from "../types/browser";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_MOTIONS,
  VIDEO_MUSIC_TRACK_IDS,
  VIDEO_SCENE_KINDS,
  VIDEO_TRANSITIONS,
  type VideoMediaState,
  type VideoPlan,
  type VideoTimeline,
} from "../media/video-types";

export const ARTIFACT_BRIDGE_PROTOCOL = "vibesurfer:artifact-bridge" as const;
export const ARTIFACT_BRIDGE_VERSION = 4 as const;

export const MAX_BRIDGE_MESSAGE_BYTES = 256 * 1024;
export const MAX_DYNAMIC_ACTION_BYTES = 32 * 1024;
export const MAX_DYNAMIC_PATCH_BYTES = 256 * 1024;
export const MAX_ARTIFACT_RENDER_BYTES = 4 * 1024 * 1024;
const MAX_URL_LENGTH = 4_096;
const MAX_TEXT_LENGTH = 512;
const MAX_CONTEXT_LENGTH = 1_024;
const MAX_FORM_FIELDS = 128;
const MAX_VALUES_PER_FIELD = 32;

export type ArtifactNavigationDisposition =
  | "current"
  | "background-tab"
  | "foreground-tab";

export interface ArtifactBridgeIdentity {
  artifactId: string;
  nonce: string;
}

export interface ArtifactBridgeInit extends ArtifactBridgeIdentity {
  protocol: typeof ARTIFACT_BRIDGE_PROTOCOL;
  version: typeof ARTIFACT_BRIDGE_VERSION;
  type: "init";
  instanceId: string;
}

export interface ArtifactBootstrapReady extends ArtifactBridgeIdentity {
  protocol: typeof ARTIFACT_BRIDGE_PROTOCOL;
  version: typeof ARTIFACT_BRIDGE_VERSION;
  type: "bootstrap-ready";
  instanceId: string;
}

interface ArtifactFrameEventBase extends ArtifactBridgeIdentity {
  protocol: typeof ARTIFACT_BRIDGE_PROTOCOL;
  version: typeof ARTIFACT_BRIDGE_VERSION;
}

export interface ArtifactRenderPayload {
  revision: number;
  renderMode: "preview" | "final";
  pageUrl: string;
  title: string;
  html: string;
  executeScripts?: boolean;
  dynamicManifest?: DynamicManifest;
  voiceSettings?: Pick<VoiceAudioSettings, "musicMode">;
  mediaPermissions?: {
    narrationEnabled: boolean;
    externalMediaEnabled: boolean;
  };
}

export interface ArtifactRenderCommand extends ArtifactFrameEventBase, ArtifactRenderPayload {
  type: "render";
}

export interface ArtifactReadyForRenderEvent extends ArtifactFrameEventBase {
  type: "ready-for-render";
}

export interface ArtifactReadyEvent extends ArtifactFrameEventBase {
  type: "ready";
  title: string;
}

export interface ArtifactNavigateEvent extends ArtifactFrameEventBase {
  type: "navigate";
  href: string;
  disposition: ArtifactNavigationDisposition;
  linkText?: string;
  ariaLabel?: string;
  linkContext?: string;
  context?: string;
}

export interface ArtifactHashChangeEvent extends ArtifactFrameEventBase {
  type: "hash-change";
  href: string;
  hash: string;
}

export interface ArtifactLinkHoverEvent extends ArtifactFrameEventBase {
  type: "link-hover";
  href?: string;
}

export interface ArtifactContextMenuEvent extends ArtifactFrameEventBase {
  type: "context-menu";
  x: number;
  y: number;
  href?: string;
  linkText?: string;
  ariaLabel?: string;
  linkContext?: string;
  context?: string;
}

export interface ArtifactBrowserCommandEvent extends ArtifactFrameEventBase {
  type: "browser-command";
  command: "open-settings";
}

export interface ArtifactFormSubmitEvent extends ArtifactFrameEventBase {
  type: "form-submit";
  action: string;
  method: "GET";
  fields: Record<string, string[]>;
}

export interface ArtifactTitleChangeEvent extends ArtifactFrameEventBase {
  type: "title-change";
  title: string;
}

export interface ArtifactRuntimeErrorEvent extends ArtifactFrameEventBase {
  type: "runtime-error";
  message: string;
}

export interface ArtifactSpeechRequestEvent extends ArtifactFrameEventBase {
  type: "speech-request";
  requestId: string;
  engine: "local" | "cloud";
  text: string;
  lang: string;
  voice: string;
  speed: number;
}

export interface ArtifactSpeechCancelEvent extends ArtifactFrameEventBase {
  type: "speech-cancel";
  requestId?: string;
}

export interface ArtifactMediaPrepareEvent extends ArtifactFrameEventBase {
  type: "media-prepare";
  requestId: string;
  plan: VideoPlan;
}

export interface ArtifactMediaCommandEvent extends ArtifactFrameEventBase {
  type: "media-command";
  videoId: string;
  action: "play" | "pause" | "stop" | "seek" | "set-volume" | "set-muted" | "skip-music";
  currentTimeMs?: number;
  volume?: number;
  muted?: boolean;
}

export interface ArtifactDynamicRegionSnapshot {
  regionId: string;
  html: string;
  revision: number;
}

export interface ArtifactDynamicActionEvent extends ArtifactFrameEventBase {
  type: "dynamic-action";
  requestId: string;
  action: string;
  targets: string[];
  fields: Record<string, string[]>;
  regions: ArtifactDynamicRegionSnapshot[];
}

export interface ArtifactDynamicSnapshotEvent extends ArtifactFrameEventBase {
  type: "dynamic-snapshot";
  requestId: string;
  regions: ArtifactDynamicRegionSnapshot[];
}

export type ArtifactFrameEvent =
  | ArtifactReadyForRenderEvent
  | ArtifactReadyEvent
  | ArtifactNavigateEvent
  | ArtifactHashChangeEvent
  | ArtifactLinkHoverEvent
  | ArtifactContextMenuEvent
  | ArtifactBrowserCommandEvent
  | ArtifactFormSubmitEvent
  | ArtifactTitleChangeEvent
  | ArtifactDynamicActionEvent
  | ArtifactDynamicSnapshotEvent
  | ArtifactSpeechRequestEvent
  | ArtifactSpeechCancelEvent
  | ArtifactMediaPrepareEvent
  | ArtifactMediaCommandEvent
  | ArtifactRuntimeErrorEvent;

export type ArtifactHostCommand =
  | ArtifactRenderCommand
  | (ArtifactFrameEventBase & { type: "dynamic-pending"; requestId: string; regionIds: string[] })
  | (ArtifactFrameEventBase & {
      type: "dynamic-patch";
      requestId: string;
      sessionRevision: number;
      patches: ArtifactDynamicRegionSnapshot[];
      announcement?: string;
    })
  | (ArtifactFrameEventBase & {
      type: "dynamic-error";
      requestId: string;
      regionIds: string[];
      message: string;
      retryable: boolean;
    })
  | (ArtifactFrameEventBase & {
      type: "state-sync";
      requestId?: string;
      sessionRevision: number;
      bindings: Record<string, string>;
      snapshots: ArtifactDynamicRegionSnapshot[];
    })
  | (ArtifactFrameEventBase & { type: "dynamic-snapshot-request"; requestId: string; regionIds: string[] })
  | (ArtifactFrameEventBase & { type: "speech-state"; requestId: string; status: "completed" | "failed" | "cancelled"; message?: string })
  | (ArtifactFrameEventBase & { type: "media-timeline"; requestId: string; timeline: VideoTimeline })
  | (ArtifactFrameEventBase & { type: "media-state"; state: VideoMediaState });

export type ArtifactHostDynamicCommandInput =
  | { type: "dynamic-pending"; requestId: string; regionIds: string[] }
  | { type: "dynamic-patch"; requestId: string; sessionRevision: number; patches: ArtifactDynamicRegionSnapshot[]; announcement?: string }
  | { type: "dynamic-error"; requestId: string; regionIds: string[]; message: string; retryable: boolean }
  | { type: "state-sync"; requestId?: string; sessionRevision: number; bindings: Record<string, string>; snapshots: ArtifactDynamicRegionSnapshot[] }
  | { type: "dynamic-snapshot-request"; requestId: string; regionIds: string[] }
  | { type: "speech-state"; requestId: string; status: "completed" | "failed" | "cancelled"; message?: string }
  | { type: "media-timeline"; requestId: string; timeline: VideoTimeline }
  | { type: "media-state"; state: VideoMediaState };

export type ArtifactBridgeParseResult =
  | { ok: true; event: ArtifactFrameEvent }
  | { ok: false; reason: string };

export function createBridgeInit(identity: ArtifactBridgeIdentity, instanceId: string): ArtifactBridgeInit {
  return {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    type: "init",
    instanceId,
    artifactId: identity.artifactId,
    nonce: identity.nonce,
  };
}

export function createBootstrapReady(identity: ArtifactBridgeIdentity, instanceId: string): ArtifactBootstrapReady {
  return {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    type: "bootstrap-ready",
    instanceId,
    artifactId: identity.artifactId,
    nonce: identity.nonce,
  };
}

export function createArtifactRenderCommand(
  identity: ArtifactBridgeIdentity,
  payload: ArtifactRenderPayload,
): ArtifactRenderCommand {
  const pageUrl = boundedHttpUrl(payload.pageUrl);
  const title = boundedString(payload.title, MAX_TEXT_LENGTH);
  if (!pageUrl || !title || typeof payload.html !== "string") {
    throw new Error("Artifact render payload is invalid");
  }
  const command: ArtifactRenderCommand = {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    type: "render",
    artifactId: identity.artifactId,
    nonce: identity.nonce,
    revision: Math.max(0, Math.round(payload.revision)),
    renderMode: payload.renderMode,
    pageUrl,
    title,
    html: payload.html,
    executeScripts: payload.executeScripts === true,
    ...(payload.dynamicManifest ? { dynamicManifest: validateDynamicManifest(payload.dynamicManifest) } : {}),
    ...(payload.voiceSettings ? { voiceSettings: payload.voiceSettings } : {}),
    ...(payload.mediaPermissions ? { mediaPermissions: payload.mediaPermissions } : {}),
  };
  if (!Number.isFinite(payload.revision) || !["preview", "final"].includes(payload.renderMode)) {
    throw new Error("Artifact render revision is invalid");
  }
  if (estimateMessageBytes(command) > MAX_ARTIFACT_RENDER_BYTES) {
    throw new Error("Artifact render payload exceeds the size limit");
  }
  return command;
}

export function isBootstrapReady(value: unknown, expected: ArtifactBridgeIdentity): value is ArtifactBootstrapReady {
  return isRecord(value)
    && value.protocol === ARTIFACT_BRIDGE_PROTOCOL
    && value.version === ARTIFACT_BRIDGE_VERSION
    && value.type === "bootstrap-ready"
    && typeof value.instanceId === "string"
    && value.instanceId.length >= 16
    && value.instanceId.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value.instanceId)
    && value.artifactId === expected.artifactId
    && value.nonce === expected.nonce;
}

export function parseArtifactFrameEvent(
  value: unknown,
  expected: ArtifactBridgeIdentity,
  maxBytes = MAX_BRIDGE_MESSAGE_BYTES,
): ArtifactBridgeParseResult {
  if (!isRecord(value)) return invalid("Message must be an object");
  if (estimateMessageBytes(value) > maxBytes) return invalid("Message exceeds the size limit");
  if (value.protocol !== ARTIFACT_BRIDGE_PROTOCOL || value.version !== ARTIFACT_BRIDGE_VERSION) {
    return invalid("Unsupported bridge protocol");
  }
  if (value.artifactId !== expected.artifactId || value.nonce !== expected.nonce) {
    return invalid("Bridge identity mismatch");
  }

  const base: ArtifactFrameEventBase = {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    artifactId: expected.artifactId,
    nonce: expected.nonce,
  };

  switch (value.type) {
    case "ready-for-render":
      return valid({ ...base, type: "ready-for-render" });
    case "ready": {
      const title = optionalBoundedString(value.title, MAX_TEXT_LENGTH) ?? "";
      return valid({ ...base, type: "ready", title });
    }
    case "navigate": {
      const href = boundedHttpUrl(value.href);
      const disposition = parseDisposition(value.disposition);
      if (!href || !disposition) return invalid("Invalid navigation event");
      return valid({
        ...base,
        type: "navigate",
        href,
        disposition,
        ...optionalTextFields(value),
      });
    }
    case "hash-change": {
      const href = boundedHttpUrl(value.href);
      const hash = boundedString(value.hash, MAX_URL_LENGTH);
      if (!href || !hash || !hash.startsWith("#")) return invalid("Invalid hash event");
      return valid({ ...base, type: "hash-change", href, hash });
    }
    case "link-hover": {
      const href = value.href === undefined ? undefined : boundedHttpUrl(value.href);
      if (value.href !== undefined && !href) return invalid("Invalid link hover event");
      return valid({ ...base, type: "link-hover", ...(href ? { href } : {}) });
    }
    case "context-menu": {
      const x = boundedCoordinate(value.x);
      const y = boundedCoordinate(value.y);
      const href = value.href === undefined ? undefined : boundedHttpUrl(value.href);
      if (x === undefined || y === undefined || (value.href !== undefined && !href)) {
        return invalid("Invalid context menu event");
      }
      return valid({
        ...base,
        type: "context-menu",
        x,
        y,
        ...(href ? { href } : {}),
        ...optionalTextFields(value),
      });
    }
    case "browser-command":
      if (value.command !== "open-settings") return invalid("Invalid browser command event");
      return valid({ ...base, type: "browser-command", command: "open-settings" });
    case "form-submit": {
      const action = boundedHttpUrl(value.action);
      const fields = parseFormFields(value.fields);
      if (!action || value.method !== "GET" || !fields) return invalid("Invalid form event");
      return valid({ ...base, type: "form-submit", action, method: "GET", fields });
    }
    case "title-change": {
      const title = boundedString(value.title, MAX_TEXT_LENGTH);
      if (!title) return invalid("Invalid title event");
      return valid({ ...base, type: "title-change", title });
    }
    case "dynamic-action": {
      if (estimateMessageBytes(value) > MAX_DYNAMIC_ACTION_BYTES) return invalid("Dynamic action exceeds the size limit");
      const requestId = boundedIdentifier(value.requestId);
      const action = boundedDynamicAction(value.action);
      const targets = parseRegionIds(value.targets);
      const fields = parseFormFields(value.fields);
      const regions = parseRegionSnapshots(value.regions);
      if (!requestId || !action || !targets || !fields || !regions) return invalid("Invalid dynamic action event");
      return valid({ ...base, type: "dynamic-action", requestId, action, targets, fields, regions });
    }
    case "dynamic-snapshot": {
      const requestId = boundedIdentifier(value.requestId);
      const regions = parseRegionSnapshots(value.regions);
      if (!requestId || !regions) return invalid("Invalid dynamic snapshot event");
      return valid({ ...base, type: "dynamic-snapshot", requestId, regions });
    }
    case "speech-request": {
      const requestId = boundedIdentifier(value.requestId);
      const text = boundedString(value.text, 4_000);
      const lang = boundedString(value.lang, 40);
      const voice = optionalBoundedString(value.voice, 120) ?? "af_heart";
      const speed = typeof value.speed === "number" && value.speed >= 0.6 && value.speed <= 1.5 ? value.speed : undefined;
      if (!requestId || !text || !lang || !speed || (value.engine !== "local" && value.engine !== "cloud")) return invalid("Invalid speech request");
      return valid({ ...base, type: "speech-request", requestId, engine: value.engine, text, lang, voice, speed });
    }
    case "speech-cancel": {
      const requestId = value.requestId === undefined ? undefined : boundedIdentifier(value.requestId);
      if (value.requestId !== undefined && !requestId) return invalid("Invalid speech cancellation");
      return valid({ ...base, type: "speech-cancel", ...(requestId ? { requestId } : {}) });
    }
    case "media-prepare": {
      const requestId = boundedIdentifier(value.requestId);
      const plan = parseVideoPlan(value.plan);
      if (!requestId || !plan) return invalid("Invalid media preparation request");
      return valid({ ...base, type: "media-prepare", requestId, plan });
    }
    case "media-command": {
      const videoId = boundedIdentifier(value.videoId);
      const action = value.action;
      if (!videoId || !["play", "pause", "stop", "seek", "set-volume", "set-muted", "skip-music"].includes(String(action))) {
        return invalid("Invalid media command");
      }
      const currentTimeMs = value.currentTimeMs === undefined ? undefined : boundedNumber(value.currentTimeMs, 0, 3_600_000);
      const volume = value.volume === undefined ? undefined : boundedNumber(value.volume, 0, 1);
      const muted = value.muted === undefined ? undefined : typeof value.muted === "boolean" ? value.muted : undefined;
      if ((action === "seek" && currentTimeMs === undefined)
          || (action === "set-volume" && volume === undefined)
          || (action === "set-muted" && muted === undefined)) return invalid("Invalid media command value");
      return valid({
        ...base,
        type: "media-command",
        videoId,
        action: action as ArtifactMediaCommandEvent["action"],
        ...(currentTimeMs !== undefined ? { currentTimeMs } : {}),
        ...(volume !== undefined ? { volume } : {}),
        ...(muted !== undefined ? { muted } : {}),
      });
    }
    case "runtime-error": {
      const message = boundedString(value.message, MAX_CONTEXT_LENGTH);
      if (!message) return invalid("Invalid runtime error event");
      return valid({ ...base, type: "runtime-error", message });
    }
    default:
      return invalid("Unknown bridge event");
  }
}

export function createArtifactHostCommand(
  identity: ArtifactBridgeIdentity,
  command: ArtifactHostDynamicCommandInput,
): ArtifactHostCommand {
  const value = { ...command, protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, ...identity } as ArtifactHostCommand;
  if (estimateMessageBytes(value) > MAX_DYNAMIC_PATCH_BYTES) throw new Error("Dynamic bridge command exceeds the size limit");
  return value;
}

function optionalTextFields(value: Record<string, unknown>) {
  const linkText = optionalBoundedString(value.linkText, MAX_TEXT_LENGTH);
  const ariaLabel = optionalBoundedString(value.ariaLabel, MAX_TEXT_LENGTH);
  const linkContext = optionalBoundedString(value.linkContext, MAX_CONTEXT_LENGTH);
  const context = optionalBoundedString(value.context, MAX_CONTEXT_LENGTH);
  return {
    ...(linkText ? { linkText } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
    ...(linkContext ? { linkContext } : {}),
    ...(context ? { context } : {}),
  };
}

function parseFormFields(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_FORM_FIELDS) return undefined;
  const fields: Record<string, string[]> = {};
  for (const [key, rawValues] of entries) {
    if (!key || key.length > MAX_TEXT_LENGTH || !Array.isArray(rawValues)) return undefined;
    if (rawValues.length > MAX_VALUES_PER_FIELD) return undefined;
    const values: string[] = [];
    for (const rawValue of rawValues) {
      const parsed = optionalBoundedString(rawValue, MAX_CONTEXT_LENGTH);
      if (parsed === undefined) return undefined;
      values.push(parsed);
    }
    fields[key] = values;
  }
  return fields;
}

function parseRegionIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const ids = value.map((item) => boundedRegionId(item));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return undefined;
  return ids as string[];
}

function parseRegionSnapshots(value: unknown): ArtifactDynamicRegionSnapshot[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const snapshots: ArtifactDynamicRegionSnapshot[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return undefined;
    const regionId = boundedRegionId(candidate.regionId);
    const html = optionalBoundedString(candidate.html, 64 * 1024);
    const revision = Number.isInteger(candidate.revision) && Number(candidate.revision) >= 0
      ? Number(candidate.revision)
      : undefined;
    if (!regionId || html === undefined || revision === undefined) return undefined;
    snapshots.push({ regionId, html, revision });
  }
  if (new Set(snapshots.map((snapshot) => snapshot.regionId)).size !== snapshots.length) return undefined;
  return snapshots;
}

function parseVideoPlan(value: unknown): VideoPlan | undefined {
  if (!isRecord(value)) return undefined;
  const videoId = boundedIdentifier(value.videoId);
  const aspectRatio = value.aspectRatio === undefined
    ? "16:9"
    : VIDEO_ASPECT_RATIOS.find((entry) => entry === value.aspectRatio);
  const pacing = value.pacing === "slow" || value.pacing === "fast" ? value.pacing : value.pacing === "balanced" ? "balanced" : undefined;
  if (!videoId || !aspectRatio || !pacing || typeof value.loop !== "boolean" || !Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 12) return undefined;
  const musicIntent = value.musicIntent === undefined ? undefined : optionalBoundedString(value.musicIntent, 160);
  if (value.musicIntent !== undefined && (musicIntent === undefined || /(?:https?:|data:|blob:|file:|javascript:)/i.test(musicIntent))) return undefined;
  const scenes: VideoPlan["scenes"] = [];
  const ids = new Set<string>();
  let desiredTotalMs = 0;
  for (const candidate of value.scenes) {
    if (!isRecord(candidate)) return undefined;
    const id = boundedIdentifier(candidate.id);
    const desiredDurationMs = candidate.desiredDurationMs === undefined
      ? undefined
      : boundedNumber(candidate.desiredDurationMs, 1_000, 120_000);
    const kind = VIDEO_SCENE_KINDS.find((entry) => entry === candidate.kind);
    const transition = VIDEO_TRANSITIONS.find((entry) => entry === candidate.transition);
    const motion = VIDEO_MOTIONS.find((entry) => entry === candidate.motion);
    const musicTrack = ([...VIDEO_MUSIC_TRACK_IDS, "inherit", "silence"] as const).find((entry) => entry === candidate.musicTrack);
    if (!id || ids.has(id) || !kind || !transition || !motion || !musicTrack
        || (candidate.desiredDurationMs !== undefined && desiredDurationMs === undefined)) return undefined;
    desiredTotalMs += desiredDurationMs ?? 0;
    if (desiredTotalMs > 600_000) return undefined;
    ids.add(id);
    let narration: VideoPlan["scenes"][number]["narration"];
    if (candidate.narration !== undefined) {
      if (!isRecord(candidate.narration)) return undefined;
      const text = boundedString(candidate.narration.text, 800);
      const lang = boundedString(candidate.narration.lang, 40);
      const voice = candidate.narration.voice === undefined ? undefined : boundedIdentifier(candidate.narration.voice);
      if (!text || !lang || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang)
          || (candidate.narration.voice !== undefined && voice === undefined)) return undefined;
      narration = { text, lang, ...(voice ? { voice } : {}) };
    }
    scenes.push({
      id,
      kind,
      transition,
      motion,
      musicTrack,
      ...(desiredDurationMs !== undefined ? { desiredDurationMs } : {}),
      ...(narration ? { narration } : {}),
    });
  }
  return { videoId, aspectRatio, pacing, loop: value.loop, ...(musicIntent ? { musicIntent } : {}), scenes };
}

function validateDynamicManifest(value: DynamicManifest): DynamicManifest {
  if (value.version !== 1 || value.regions.length > 16 || value.actions.length > 32 || value.bindings.length > 64) {
    throw new Error("Dynamic manifest is invalid");
  }
  const regionIds = new Set(value.regions.map((region) => boundedRegionId(region.id)));
  if (regionIds.has(undefined) || regionIds.size !== value.regions.length) throw new Error("Dynamic manifest regions are invalid");
  if (value.regions.some((region) => region.refreshSeconds !== undefined
      && (!Number.isInteger(region.refreshSeconds) || region.refreshSeconds < 60 || region.refreshSeconds > 3_600))) {
    throw new Error("Dynamic manifest refresh interval is invalid");
  }
  for (const action of value.actions) {
    if (!boundedDynamicAction(action.action) || !["state", "model"].includes(action.execution)) throw new Error("Dynamic manifest action is invalid");
    if (!action.action.startsWith(`${action.execution}:`)) throw new Error("Dynamic manifest action namespace is invalid");
    if (action.targets.length > 16 || new Set(action.targets).size !== action.targets.length
        || action.targets.some((target) => !regionIds.has(target))) throw new Error("Dynamic manifest target is invalid");
  }
  if (value.bindings.some((binding) => typeof binding !== "string"
      || !/^(?:cart\.(?:count|total)|wishlist\.count|value\.[A-Za-z][A-Za-z0-9_.-]{0,63})$/.test(binding))) {
    throw new Error("Dynamic manifest binding is invalid");
  }
  return structuredClone(value);
}

function boundedIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : undefined;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

function boundedRegionId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : undefined;
}

function boundedDynamicAction(value: unknown) {
  return typeof value === "string" && /^(?:state:(?:cart\.add|cart\.remove|cart\.setQuantity|wishlist\.toggle|value\.set)|model:[a-z][a-z0-9.-]{0,63})$/.test(value) ? value : undefined;
}

function parseDisposition(value: unknown): ArtifactNavigationDisposition | undefined {
  return value === "current" || value === "background-tab" || value === "foreground-tab"
    ? value
    : undefined;
}

function boundedString(value: unknown, maxLength: number) {
  const parsed = optionalBoundedString(value, maxLength);
  return parsed && parsed.length > 0 ? parsed : undefined;
}

function boundedHttpUrl(value: unknown) {
  const parsed = boundedString(value, MAX_URL_LENGTH);
  if (!parsed) return undefined;
  try {
    const url = new URL(parsed);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function optionalBoundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function boundedCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000
    ? value
    : undefined;
}

function estimateMessageBytes(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valid(event: ArtifactFrameEvent): ArtifactBridgeParseResult {
  return { ok: true, event };
}

function invalid(reason: string): ArtifactBridgeParseResult {
  return { ok: false, reason };
}
