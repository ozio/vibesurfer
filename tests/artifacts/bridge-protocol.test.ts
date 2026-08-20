import { expect, test } from "vitest";
import {
  ARTIFACT_BRIDGE_PROTOCOL,
  ARTIFACT_BRIDGE_VERSION,
  MAX_ARTIFACT_RENDER_BYTES,
  MAX_BRIDGE_MESSAGE_BYTES,
  MAX_DYNAMIC_ACTION_BYTES,
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
    executeScripts: false,
  });
  expect(() => createArtifactRenderCommand(identity, {
    pageUrl: "https://example.com/",
    title: "Oversized",
    html: "x".repeat(MAX_ARTIFACT_RENDER_BYTES),
  })).toThrow("exceeds the size limit");
  expect(() => createArtifactRenderCommand(identity, {
    pageUrl: "https://example.com/",
    title: "Invalid manifest",
    html: "<main>Safe</main>",
    dynamicManifest: {
      version: 1,
      regions: [{ id: "thread", refreshSeconds: 60 }],
      actions: [{ action: "model:send", execution: "state", targets: ["thread"] }],
      bindings: [],
      localTabs: false,
    },
  })).toThrow("namespace");
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
    linkContext: "News desk, 12 August edition",
    context: "Latest stories",
  }, identity);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.event.type).toBe("navigate");
  if (result.event.type !== "navigate") return;
  expect(result.event.disposition).toBe("background-tab");
  expect(result.event.linkText).toBe("News");
  expect(result.event.linkContext).toBe("News desk, 12 August edition");
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "navigate",
    href: "https://example.com/news",
    disposition: "current",
    linkContext: "x".repeat(1_025),
  }, identity)).toEqual({ ok: true, event: { ...envelope, type: "navigate", href: "https://example.com/news", disposition: "current" } });
});

test("accepts safe link hover changes and rejects unsafe targets", () => {
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "link-hover",
    href: "https://example.com/hovered",
  }, identity)).toEqual({
    ok: true,
    event: { ...envelope, type: "link-hover", href: "https://example.com/hovered" },
  });
  expect(parseArtifactFrameEvent({ ...envelope, type: "link-hover" }, identity)).toEqual({
    ok: true,
    event: { ...envelope, type: "link-hover" },
  });
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "link-hover",
    href: "javascript:alert(1)",
  }, identity)).toEqual({ ok: false, reason: "Invalid link hover event" });
});

test("accepts page and safe-link context menu events", () => {
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "context-menu",
    x: 24,
    y: 48,
  }, identity)).toEqual({
    ok: true,
    event: { ...envelope, type: "context-menu", x: 24, y: 48 },
  });

  const link = parseArtifactFrameEvent({
    ...envelope,
    type: "context-menu",
    x: 12.5,
    y: 18.25,
    href: "https://example.com/docs",
    linkText: "Docs",
  }, identity);
  expect(link.ok).toBe(true);
  if (link.ok && link.event.type === "context-menu") {
    expect(link.event.href).toBe("https://example.com/docs");
    expect(link.event.linkText).toBe("Docs");
  }
});

test("rejects unsafe context menu targets and coordinates", () => {
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "context-menu",
    x: -1,
    y: 20,
  }, identity)).toEqual({ ok: false, reason: "Invalid context menu event" });
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "context-menu",
    x: 10,
    y: 20,
    href: "javascript:alert(1)",
  }, identity)).toEqual({ ok: false, reason: "Invalid context menu event" });
});

test("accepts only the settings browser command", () => {
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "browser-command",
    command: "open-settings",
  }, identity)).toEqual({
    ok: true,
    event: { ...envelope, type: "browser-command", command: "open-settings" },
  });

  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "browser-command",
    command: "close-window",
  }, identity)).toEqual({ ok: false, reason: "Invalid browser command event" });
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

test("accepts bounded manifest-backed dynamic actions and rejects oversized or malformed ones", () => {
  const valid = parseArtifactFrameEvent({
    ...envelope,
    type: "dynamic-action",
    requestId: "dynamic-request-1",
    action: "state:cart.setQuantity",
    targets: ["cart-panel"],
    fields: { productId: ["sku-1"], quantity: ["2"] },
    regions: [{ regionId: "cart-panel", html: "<p>Cart</p>", revision: 1 }],
  }, identity);
  expect(valid.ok).toBe(true);
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "dynamic-action",
    requestId: "dynamic-request-2",
    action: "navigate-anywhere",
    targets: [],
    fields: {},
    regions: [],
  }, identity).ok).toBe(false);
  expect(parseArtifactFrameEvent({
    ...envelope,
    type: "dynamic-action",
    requestId: "dynamic-request-3",
    action: "model:send",
    targets: ["thread"],
    fields: { message: ["x".repeat(MAX_DYNAMIC_ACTION_BYTES)] },
    regions: [],
  }, identity)).toEqual({ ok: false, reason: "Dynamic action exceeds the size limit" });
});
