import { describe, expect, it } from "vitest";
import { ARTIFACT_BRIDGE_PROTOCOL, ARTIFACT_BRIDGE_VERSION, createArtifactRenderCommand, parseArtifactFrameEvent } from "./bridge-protocol";

describe("artifact render protocol", () => {
  it("carries monotonic revision, render mode and bounded audio preferences", () => {
    const command = createArtifactRenderCommand({ artifactId: "artifact-1", nonce: "nonce-for-artifact" }, {
      revision: 17,
      renderMode: "preview",
      pageUrl: "https://example.com/",
      title: "Preview",
      html: "<!doctype html><title>Preview</title>",
      voiceSettings: { musicMode: "built-in" },
      mediaPermissions: { narrationEnabled: true, externalMediaEnabled: false },
    });
    expect(ARTIFACT_BRIDGE_VERSION).toBe(4);
    expect(command).toMatchObject({ revision: 17, renderMode: "preview", voiceSettings: { musicMode: "built-in" } });
  });

  it("rejects invalid revisions before reaching the iframe", () => {
    expect(() => createArtifactRenderCommand({ artifactId: "artifact-1", nonce: "nonce-for-artifact" }, { revision: Number.NaN, renderMode: "final", pageUrl: "https://example.com/", title: "Final", html: "<!doctype html><title>Final</title>" })).toThrow("revision");
  });

  it("accepts only bounded declarative media plans and never needs URLs, credentials or audio bytes", () => {
    const identity = { artifactId: "artifact-1", nonce: "nonce-for-artifact" };
    const event = {
      protocol: ARTIFACT_BRIDGE_PROTOCOL,
      version: ARTIFACT_BRIDGE_VERSION,
      type: "media-prepare",
      ...identity,
      requestId: "prepare-1",
      plan: {
        videoId: "video-1",
        aspectRatio: "9:16",
        pacing: "balanced",
        loop: false,
        scenes: [{ id: "scene-1", kind: "title", transition: "crossfade", motion: "stagger", desiredDurationMs: 2_500, narration: { text: "Visible and spoken.", lang: "en", voice: "voice-1" }, musicTrack: "ambient-glass" }],
      },
    };
    expect(parseArtifactFrameEvent(event, identity)).toMatchObject({ ok: true, event: { type: "media-prepare", plan: { videoId: "video-1", aspectRatio: "9:16" } } });
    expect(JSON.stringify(event)).not.toMatch(/api[-_]?key|audioBase64|https?:\/\//i);
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, scenes: [{ ...event.plan.scenes[0], musicTrack: "https://evil.example/music.mid" }] } }, identity)).toMatchObject({ ok: false });
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, scenes: Array.from({ length: 13 }, (_, index) => ({ ...event.plan.scenes[0], id: `scene-${index}` })) } }, identity)).toMatchObject({ ok: false });
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, scenes: [{ ...event.plan.scenes[0], narration: { text: "x".repeat(801), lang: "en" } }] } }, identity)).toMatchObject({ ok: false });
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, musicIntent: "fetch https://evil.example/track" } }, identity)).toMatchObject({ ok: false });
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, aspectRatio: "calc(100vh)" } }, identity)).toMatchObject({ ok: false });
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, scenes: [{ ...event.plan.scenes[0], narration: { text: "Hello", lang: "invalid language", voice: "voice-1" } }] } }, identity)).toMatchObject({ ok: false });
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, scenes: [{ ...event.plan.scenes[0], narration: { text: "Hello", lang: "en", voice: "voice with spaces" } }] } }, identity)).toMatchObject({ ok: false });
    expect(parseArtifactFrameEvent({ ...event, plan: { ...event.plan, scenes: Array.from({ length: 6 }, (_, index) => ({ ...event.plan.scenes[0], id: `scene-${index}`, desiredDurationMs: 120_000 })) } }, identity)).toMatchObject({ ok: false });
  });
});
