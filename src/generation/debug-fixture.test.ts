// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATION_SETTINGS } from "../store/browser-store";
import { USER_CONFIGURABLE_CAPABILITY_IDS } from "./capability-settings";
import { buildGenerationDebugFixture } from "./debug-fixture";

const markerSelectors: Record<(typeof USER_CONFIGURABLE_CAPABILITY_IDS)[number], string> = {
  "pattern-background": "[data-vibe-pattern]",
  "motion-presets": "[data-vibe-motion]",
  "data-chart": '[data-vibe-capability="data-chart"]',
  diagram: '[data-vibe-capability="diagram"]',
  math: '[data-vibe-capability="math"]',
  "code-highlight": '[data-vibe-capability="code-highlight"]',
  "qr-code": '[data-vibe-capability="qr-code"]',
  avatar: '[data-vibe-capability="avatar"]',
  "synthetic-map": '[data-vibe-capability="synthetic-map"]',
  "micro-widgets": "[data-vibe-widget]",
  carousel: "[data-vibe-carousel]",
  slideshow: "[data-vibe-slideshow]",
  "pseudo-video": "vibe-video",
  speech: "[data-vibe-speak]",
  sound: "[data-vibe-sound]",
};

function documentFor(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("generation debug fixture", () => {
  it("contains a visible production-shaped marker for every enabled capability", () => {
    const fixture = buildGenerationDebugFixture(structuredClone(DEFAULT_GENERATION_SETTINGS), true);
    const document = documentFor(fixture.html);
    expect(fixture.enabledCapabilities).toEqual(USER_CONFIGURABLE_CAPABILITY_IDS);
    for (const id of USER_CONFIGURABLE_CAPABILITY_IDS) {
      expect(document.querySelector(`[data-debug-feature="${id}"]`)?.getAttribute("data-debug-enabled"), id).toBe("true");
      expect(document.querySelector(markerSelectors[id]), id).not.toBeNull();
    }
    expect(document.querySelector('[data-debug-feature="image-intents"] img')?.getAttribute("src")).toContain("loremflickr.com");
    expect(document.querySelectorAll("vibe-video > [data-vibe-scene]")).toHaveLength(6);
    expect(document.querySelector("vibe-video")?.getAttribute("data-aspect-ratio")).toBe("16:9");
    expect(document.querySelector("vibe-video [data-vibe-narration]")?.textContent).toContain("Every evening");
    expect(document.querySelector('[data-music-track="documentary-pulse"]')).not.toBeNull();
    expect(document.querySelector('[data-kind="credits"]')).not.toBeNull();
    expect(document.querySelector('[data-vibe-video-time="combined"]')).not.toBeNull();
    expect(document.querySelector("[data-vibe-video-volume]")).not.toBeNull();
    expect(document.querySelector('[data-vibe-video-visible-when="muted"]')).not.toBeNull();
    expect(document.querySelector('[data-vibe-video-action="fullscreen"], [data-vibe-video-status], [data-vibe-video-transcript]')).toBeNull();
  });

  it("removes each capability marker independently when its setting is off", () => {
    for (const id of USER_CONFIGURABLE_CAPABILITY_IDS) {
      const settings = structuredClone(DEFAULT_GENERATION_SETTINGS);
      settings.capabilities.enabled[id] = false;
      const fixture = buildGenerationDebugFixture(settings, true);
      const document = documentFor(fixture.html);
      const card = document.querySelector(`[data-debug-feature="${id}"]`)!;
      expect(card.getAttribute("data-debug-enabled"), id).toBe("false");
      expect(card.querySelector(markerSelectors[id]), id).toBeNull();
      expect(fixture.enabledCapabilities, id).not.toContain(id);
      expect(fixture.enabledCapabilities).toHaveLength(USER_CONFIGURABLE_CAPABILITY_IDS.length - 1);
    }
  });

  it("mirrors Turbo's no-enrichment contract without changing saved Full settings", () => {
    const settings = structuredClone(DEFAULT_GENERATION_SETTINGS);
    settings.strategy = "turbo";
    settings.style.allowGeneratedScripts = true;
    const fixture = buildGenerationDebugFixture(settings, true);
    const document = documentFor(fixture.html);
    expect(fixture.enabledCapabilities).toEqual([]);
    expect(fixture.allowGeneratedScripts).toBe(false);
    expect(document.querySelector('[data-debug-feature="image-intents"]')?.getAttribute("data-debug-enabled")).toBe("false");
    expect(document.querySelector("script")).toBeNull();
    expect(settings.capabilities.enabled["data-chart"]).toBe(true);
  });
});
