import type { DynamicManifest } from "../types/browser";

export const ARTIFACT_BRIDGE_PROTOCOL = "vibesurfer:artifact-bridge" as const;
export const ARTIFACT_BRIDGE_VERSION = 2 as const;

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
  pageUrl: string;
  title: string;
  html: string;
  executeScripts?: boolean;
  dynamicManifest?: DynamicManifest;
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
  | (ArtifactFrameEventBase & { type: "dynamic-snapshot-request"; requestId: string; regionIds: string[] });

export type ArtifactHostDynamicCommandInput =
  | { type: "dynamic-pending"; requestId: string; regionIds: string[] }
  | { type: "dynamic-patch"; requestId: string; sessionRevision: number; patches: ArtifactDynamicRegionSnapshot[]; announcement?: string }
  | { type: "dynamic-error"; requestId: string; regionIds: string[]; message: string; retryable: boolean }
  | { type: "state-sync"; requestId?: string; sessionRevision: number; bindings: Record<string, string>; snapshots: ArtifactDynamicRegionSnapshot[] }
  | { type: "dynamic-snapshot-request"; requestId: string; regionIds: string[] };

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
    pageUrl,
    title,
    html: payload.html,
    executeScripts: payload.executeScripts === true,
    ...(payload.dynamicManifest ? { dynamicManifest: validateDynamicManifest(payload.dynamicManifest) } : {}),
  };
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
