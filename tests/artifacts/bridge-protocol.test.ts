import { expect, test } from "vitest";
import {
  ARTIFACT_BRIDGE_PROTOCOL,
  ARTIFACT_BRIDGE_VERSION,
  MAX_ARTIFACT_RENDER_BYTES,
  MAX_BRIDGE_MESSAGE_BYTES,
  createArtifactRenderCommand,
  createBootstrapReady,
  createBridgeInit,
  isBootstrapReady,
  parseArtifactFrameEvent,
} from "../../src/artifacts/bridge-protocol.ts";

const identity = { artifactId: "artifact-42", nonce: "private-nonce" };
const instanceId = "runtime-instance-0001";
const envelope = {
  protocol: ARTIFACT_BRIDGE_PROTOCOL,
  version: ARTIFACT_BRIDGE_VERSION,
  artifactId: identity.artifactId,
  nonce: identity.nonce,
};

test("creates a versioned, identity-bound handshake", () => {
  expect(createBridgeInit(identity, instanceId)).toEqual({
    ...envelope,
    type: "init",
    instanceId,
  });
});

test("accepts bootstrap only from the expected artifact identity", () => {
  const bootstrap = createBootstrapReady(identity, instanceId);
  expect(isBootstrapReady(bootstrap, identity)).toBe(true);
  expect(isBootstrapReady({ ...bootstrap, nonce: "stale-nonce" }, identity)).toBe(false);
  expect(isBootstrapReady({ ...bootstrap, instanceId: "short" }, identity)).toBe(false);
  expect(isBootstrapReady({ ...bootstrap, type: "ready" }, identity)).toBe(false);
});

test("creates one bounded, identity-bound render command", () => {
  expect(createArtifactRenderCommand(identity, {
    pageUrl: "https://example.com/path",
    title: "Rendered page",
    html: "<main>Safe</main>",
  })).toEqual({
    ...envelope,
    type: "render",
    pageUrl: "https://example.com/path",
    title: "Rendered page",
    html: "<main>Safe</main>",
  });
  expect(() => createArtifactRenderCommand(identity, {
    pageUrl: "https://example.com/",
    title: "Oversized",
    html: "x".repeat(MAX_ARTIFACT_RENDER_BYTES),
  })).toThrow("exceeds the size limit");
});

test("accepts the shell ready-for-render stage", () => {
  expect(parseArtifactFrameEvent({ ...envelope, type: "ready-for-render" }, identity)).toEqual({
    ok: true,
    event: { ...envelope, type: "ready-for-render" },
  });
});

test("accepts a bounded navigation event", () => {
  const result = parseArtifactFrameEvent({
    ...envelope,
    type: "navigate",
    href: "https://example.com/news",
    disposition: "background-tab",
    linkText: "News",
    context: "Latest stories",
  }, identity);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.event.type).toBe("navigate");
  if (result.event.type !== "navigate") return;
  expect(result.event.disposition).toBe("background-tab");
  expect(result.event.linkText).toBe("News");
});

test("rejects spoofed bridge identities", () => {
  const result = parseArtifactFrameEvent({
    ...envelope,
    nonce: "attacker-nonce",
    type: "ready",
    title: "Spoofed",
  }, identity);

  expect(result).toEqual({ ok: false, reason: "Bridge identity mismatch" });
});

test("rejects navigation outside HTTP(S)", () => {
  const result = parseArtifactFrameEvent({
    ...envelope,
    type: "navigate",
    href: "javascript:alert(1)",
    disposition: "current",
  }, identity);

  expect(result).toEqual({ ok: false, reason: "Invalid navigation event" });
});

test("rejects non-GET and malformed form messages", () => {
  const nonGet = parseArtifactFrameEvent({
    ...envelope,
    type: "form-submit",
    action: "https://example.com/sign-in",
    method: "POST",
    fields: {},
  }, identity);
  const malformedValues = parseArtifactFrameEvent({
    ...envelope,
    type: "form-submit",
    action: "https://example.com/search",
    method: "GET",
    fields: { q: "not-an-array" },
  }, identity);

  expect(nonGet.ok).toBe(false);
  expect(malformedValues.ok).toBe(false);
});

test("rejects messages over the transport budget", () => {
  const result = parseArtifactFrameEvent({
    ...envelope,
    type: "runtime-error",
    message: "x".repeat(MAX_BRIDGE_MESSAGE_BYTES),
  }, identity);

  expect(result).toEqual({ ok: false, reason: "Message exceeds the size limit" });
});
