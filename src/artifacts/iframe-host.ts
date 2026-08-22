import {
  createArtifactRenderCommand,
  createArtifactHostCommand,
  createBridgeInit,
  isBootstrapReady,
  parseArtifactFrameEvent,
  type ArtifactBridgeIdentity,
  type ArtifactFrameEvent,
  type ArtifactRenderPayload,
  type ArtifactDynamicRegionSnapshot,
} from "./bridge-protocol";
import type { VideoMediaState, VideoTimeline } from "../media/video-types";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 4_000;
const MAX_PROTOCOL_VIOLATIONS = 3;
const MAX_RUNTIME_INSTANCES = 4;

export interface ArtifactFrameConnectionOptions extends ArtifactBridgeIdentity {
  iframe?: HTMLIFrameElement;
  getIframe?: () => HTMLIFrameElement | null;
  render: ArtifactRenderPayload;
  onEvent: (event: ArtifactFrameEvent) => void;
  onProtocolError?: (reason: string) => void;
  onRuntimeRestart?: () => void;
  handshakeTimeoutMs?: number;
}

export interface ArtifactFrameConnection {
  disconnect: () => void;
  isReady: () => boolean;
  updateRender: (render: ArtifactRenderPayload) => void;
  setDynamicPending: (requestId: string, regionIds: string[]) => void;
  patchDynamic: (input: { requestId: string; sessionRevision: number; patches: ArtifactDynamicRegionSnapshot[]; announcement?: string }) => void;
  setDynamicError: (input: { requestId: string; regionIds: string[]; message: string; retryable: boolean }) => void;
  syncState: (input: { requestId?: string; sessionRevision: number; bindings: Record<string, string>; snapshots?: ArtifactDynamicRegionSnapshot[] }) => void;
  requestDynamicSnapshot: (regionIds: string[]) => Promise<ArtifactDynamicRegionSnapshot[]>;
  setSpeechState: (input: { requestId: string; status: "completed" | "failed" | "cancelled"; message?: string }) => void;
  setMediaTimeline: (requestId: string, timeline: VideoTimeline) => void;
  setMediaState: (state: VideoMediaState) => void;
}

/**
 * Waits for the artifact runtime to announce itself, then gives it one private
 * MessagePort. The listener may be armed before the iframe mounts. The frame
 * has an opaque origin, so the two
 * bootstrap messages necessarily use `*`; identity is instead bound to the
 * known contentWindow, artifact id, and unguessable nonce. No later runtime
 * traffic uses `window`.
 */
export function connectArtifactFrame({
  iframe,
  getIframe,
  render,
  artifactId,
  nonce,
  onEvent,
  onProtocolError,
  onRuntimeRestart,
  handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
}: ArtifactFrameConnectionOptions): ArtifactFrameConnection {
  const resolveIframe = getIframe ?? (() => iframe ?? null);
  if (!getIframe && !iframe?.contentWindow) {
    onProtocolError?.("Artifact frame is not available");
    return {
      disconnect: () => undefined,
      isReady: () => false,
      updateRender: () => undefined,
      setDynamicPending: () => undefined,
      patchDynamic: () => undefined,
      setDynamicError: () => undefined,
      syncState: () => undefined,
      requestDynamicSnapshot: async () => [],
      setSpeechState: () => undefined,
      setMediaTimeline: () => undefined,
      setMediaState: () => undefined,
    };
  }

  const identity = { artifactId, nonce };
  let latestRender = render;
  let ready = false;
  let disconnected = false;
  let violations = 0;
  let renderSent = false;
  const seenInstanceIds = new Set<string>();
  let timeout: number | undefined;
  let active: { instanceId: string; channel: MessageChannel } | undefined;
  const snapshotRequests = new Map<string, { resolve: (regions: ArtifactDynamicRegionSnapshot[]) => void; timeout: number }>();

  const armTimeout = () => {
    if (timeout !== undefined) window.clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      if (ready || disconnected) return;
      onProtocolError?.("Artifact bridge handshake timed out");
      disconnect();
    }, handshakeTimeoutMs);
  };

  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
    window.removeEventListener("message", acceptBootstrap);
    if (active) {
      active.channel.port1.onmessage = null;
      active.channel.port1.close();
      active = undefined;
    }
    for (const pending of snapshotRequests.values()) {
      window.clearTimeout(pending.timeout);
      pending.resolve([]);
    }
    snapshotRequests.clear();
  };

  const acceptBootstrap = (event: MessageEvent<unknown>) => {
    const frameWindow = resolveIframe()?.contentWindow;
    if (disconnected || !isBootstrapReady(event.data, identity)) return;
    if (!frameWindow) return;
    if (event.source !== frameWindow) return;
    const instanceId = event.data.instanceId;
    if (seenInstanceIds.has(instanceId)) return;
    if (seenInstanceIds.size >= MAX_RUNTIME_INSTANCES) {
      onProtocolError?.("Artifact bridge restarted too many times");
      disconnect();
      return;
    }

    const nextChannel = new MessageChannel();
    nextChannel.port1.onmessage = (messageEvent: MessageEvent<unknown>) => {
      if (disconnected || active?.channel !== nextChannel) return;
      const parsed = parseArtifactFrameEvent(messageEvent.data, identity);
      if (!parsed.ok) {
        violations += 1;
        onProtocolError?.(parsed.reason);
        if (violations >= MAX_PROTOCOL_VIOLATIONS) disconnect();
        return;
      }
      if (parsed.event.type === "ready-for-render") {
        if (ready || renderSent) {
          violations += 1;
          onProtocolError?.("Artifact requested an unexpected render");
          if (violations >= MAX_PROTOCOL_VIOLATIONS) disconnect();
          return;
        }
        try {
          nextChannel.port1.postMessage(createArtifactRenderCommand(identity, latestRender));
          renderSent = true;
          armTimeout();
        } catch (error) {
          onProtocolError?.(error instanceof Error ? error.message : "Artifact render payload could not be sent");
          disconnect();
        }
        return;
      }
      if (!ready && parsed.event.type === "runtime-error") {
        onProtocolError?.(parsed.event.message);
        disconnect();
        return;
      }
      if (!ready && (parsed.event.type !== "ready" || !renderSent)) {
        violations += 1;
        onProtocolError?.("Artifact sent data before completing the handshake");
        if (violations >= MAX_PROTOCOL_VIOLATIONS) disconnect();
        return;
      }
      if (parsed.event.type === "ready") {
        if (ready) return;
        ready = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
      }
      if (parsed.event.type === "dynamic-snapshot") {
        const pending = snapshotRequests.get(parsed.event.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        snapshotRequests.delete(parsed.event.requestId);
        pending.resolve(parsed.event.regions);
        return;
      }
      onEvent(parsed.event);
    };
    nextChannel.port1.start();

    try {
      frameWindow.postMessage(createBridgeInit(identity, instanceId), "*", [nextChannel.port2]);
    } catch {
      nextChannel.port1.onmessage = null;
      nextChannel.port1.close();
      return;
    }

    const previous = active;
    const wasReady = ready;
    active = { instanceId, channel: nextChannel };
    seenInstanceIds.add(instanceId);
    violations = 0;
    renderSent = false;
    ready = false;
    armTimeout();
    if (wasReady) onRuntimeRestart?.();
    if (previous) {
      previous.channel.port1.onmessage = null;
      previous.channel.port1.close();
    }
  };

  window.addEventListener("message", acceptBootstrap);
  armTimeout();

  const updateRender = (nextRender: ArtifactRenderPayload) => {
    latestRender = nextRender;
    if (disconnected || !active || !renderSent) return;
    try {
      active.channel.port1.postMessage(createArtifactRenderCommand(identity, latestRender));
    } catch (error) {
      onProtocolError?.(error instanceof Error ? error.message : "Artifact render payload could not be sent");
      disconnect();
    }
  };

  const postDynamic = (command: Parameters<typeof createArtifactHostCommand>[1]) => {
    if (disconnected || !ready || !active) return;
    try {
      active.channel.port1.postMessage(createArtifactHostCommand(identity, command));
    } catch (error) {
      onProtocolError?.(error instanceof Error ? error.message : "Dynamic command could not be sent");
    }
  };

  const requestDynamicSnapshot = (regionIds: string[]) => new Promise<ArtifactDynamicRegionSnapshot[]>((resolve) => {
    if (disconnected || !ready || !active) {
      resolve([]);
      return;
    }
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      snapshotRequests.delete(requestId);
      resolve([]);
    }, 2_000);
    snapshotRequests.set(requestId, { resolve, timeout });
    postDynamic({ type: "dynamic-snapshot-request", requestId, regionIds });
  });

  return {
    disconnect,
    isReady: () => ready && !disconnected,
    updateRender,
    setDynamicPending: (requestId, regionIds) => postDynamic({ type: "dynamic-pending", requestId, regionIds }),
    patchDynamic: (input) => postDynamic({ type: "dynamic-patch", ...input }),
    setDynamicError: (input) => postDynamic({ type: "dynamic-error", ...input }),
    syncState: (input) => postDynamic({ type: "state-sync", ...input, snapshots: input.snapshots ?? [] }),
    requestDynamicSnapshot,
    setSpeechState: (input) => postDynamic({ type: "speech-state", ...input }),
    setMediaTimeline: (requestId, timeline) => postDynamic({ type: "media-timeline", requestId, timeline }),
    setMediaState: (state) => postDynamic({ type: "media-state", state }),
  };
}
