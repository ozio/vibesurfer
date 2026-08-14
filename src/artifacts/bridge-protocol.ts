export const ARTIFACT_BRIDGE_PROTOCOL = "vibesurfer:artifact-bridge" as const;
export const ARTIFACT_BRIDGE_VERSION = 1 as const;

export const MAX_BRIDGE_MESSAGE_BYTES = 32 * 1024;
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
  | ArtifactRuntimeErrorEvent;

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
    case "runtime-error": {
      const message = boundedString(value.message, MAX_CONTEXT_LENGTH);
      if (!message) return invalid("Invalid runtime error event");
      return valid({ ...base, type: "runtime-error", message });
    }
    default:
      return invalid("Unknown bridge event");
  }
}

function optionalTextFields(value: Record<string, unknown>) {
  const linkText = optionalBoundedString(value.linkText, MAX_TEXT_LENGTH);
  const ariaLabel = optionalBoundedString(value.ariaLabel, MAX_TEXT_LENGTH);
  const context = optionalBoundedString(value.context, MAX_CONTEXT_LENGTH);
  return {
    ...(linkText ? { linkText } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
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
