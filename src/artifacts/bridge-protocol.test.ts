import { describe, expect, it } from "vitest";
import { ARTIFACT_BRIDGE_VERSION, createArtifactRenderCommand } from "./bridge-protocol";

describe("artifact render protocol", () => {
  it("carries monotonic revision, render mode and bounded audio preferences", () => {
    const command = createArtifactRenderCommand({ artifactId: "artifact-1", nonce: "nonce-for-artifact" }, {
      revision: 17,
      renderMode: "preview",
      pageUrl: "https://example.com/",
      title: "Preview",
      html: "<!doctype html><title>Preview</title>",
      voiceSettings: { engine: "local", voice: "af_heart", speed: 1.1, musicEnabled: true },
    });
    expect(ARTIFACT_BRIDGE_VERSION).toBe(3);
    expect(command).toMatchObject({ revision: 17, renderMode: "preview", voiceSettings: { engine: "local", speed: 1.1 } });
  });

  it("rejects invalid revisions before reaching the iframe", () => {
    expect(() => createArtifactRenderCommand({ artifactId: "artifact-1", nonce: "nonce-for-artifact" }, { revision: Number.NaN, renderMode: "final", pageUrl: "https://example.com/", title: "Final", html: "<!doctype html><title>Final</title>" })).toThrow("revision");
  });
});
