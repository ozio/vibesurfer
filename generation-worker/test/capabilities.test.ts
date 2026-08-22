import { describe, expect, it } from "vitest";

import { CAPABILITY_REGISTRY, compactCapabilityContracts, resolveCapabilities } from "../src/capabilities/registry.js";
import { USER_CONFIGURABLE_CAPABILITY_IDS, type CapabilityId } from "../src/capabilities/types.js";
import { capabilityCatalog } from "../src/prompt-builder.js";
import { transformHtml, transformPreviewHtml } from "../src/html/transform.js";
import { generationCommand } from "./helpers.js";

const selected: CapabilityId[] = [
  "pattern-background",
  "motion-presets",
  "data-chart",
  "diagram",
  "math",
  "code-highlight",
  "qr-code",
  "avatar",
  "synthetic-map",
  "micro-widgets",
  "carousel",
  "slideshow",
  "speech",
  "sound",
];

const capabilityDocument = `<!doctype html><html><head><title>Capability report</title></head><body data-vibe-pattern="grid">
  <main data-vibe-motion="reveal">
    <vibe-chart aria-label="Population by year"><template>{"mark":"line","data":{"values":[{"year":2000,"population":10},{"year":2005,"population":12}]},"encoding":{"x":{"field":"year","type":"ordinal"},"y":{"field":"population","type":"quantitative"}}}</template><figcaption>Population by year</figcaption></vibe-chart>
    <vibe-diagram aria-label="Research flow"><pre>graph LR
      A[Survey] --> B[Report]</pre><figcaption>Research flow</figcaption></vibe-diagram>
    <div data-vibe-math data-display="block">x^2 + y^2 = z^2</div>
    <pre data-vibe-code="rust"><code>fn main() { println!("hello"); }</code></pre>
    <vibe-qr data-value="https://example.com/report" aria-label="Report QR"></vibe-qr>
    <vibe-avatar data-seed="Ada North" data-style="initials" aria-label="Ada North"></vibe-avatar>
    <vibe-map aria-label="Map of Northbridge"><template>{"places":[{"name":"Archive","x":15,"y":30},{"name":"Observatory","x":75,"y":60}],"routes":[[0,1]]}</template><figcaption>Northbridge schematic</figcaption></vibe-map>
    <div data-vibe-widget="progress" data-value="62" data-max="100">62%</div>
    <section data-vibe-carousel><article>One</article><article>Two</article><button data-vibe-next>Next</button></section>
    <section data-vibe-slideshow><article>Scene one</article><article>Scene two</article><button data-vibe-play>Play</button></section>
    <article id="summary">A short demographic summary.</article><button data-vibe-speak="#summary">Read aloud</button><button data-vibe-sound="chime">Play tone</button>
  </main>
</body></html>`;

describe("capability compiler", () => {
  it("resolves only available settings-backed capabilities and keeps host providers unavailable", () => {
    const settings = generationCommand().settings;
    expect(resolveCapabilities(settings, "native", ["data-chart", "speech"]).map(({ id }) => id))
      .toEqual(["semantic-navigation", "inline-page-css", "data-chart", "speech"]);
    expect(() => resolveCapabilities({ ...settings, motionEnabled: false }, "native", ["motion-presets"]))
      .toThrow("Director selected unavailable capability: motion-presets");
    expect(() => resolveCapabilities(settings, "native", ["external-media"]))
      .toThrow("Director selected unavailable capability: external-media");
    expect(CAPABILITY_REGISTRY.get("data-chart")?.maxInstances).toBe(8);
    expect(compactCapabilityContracts(settings, "native")).not.toHaveProperty("pattern-background");
  });

  it("withholds every user-configurable capability independently from Director and compiler", () => {
    const base = generationCommand().settings;
    for (const disabledId of USER_CONFIGURABLE_CAPABILITY_IDS) {
      const settings = {
        ...base,
        capabilities: {
          ...base.capabilities,
          enabled: { ...base.capabilities.enabled, [disabledId]: false },
        },
      };
      expect(capabilityCatalog(settings, "native").capabilities, disabledId).not.toHaveProperty(disabledId);
      expect(() => resolveCapabilities(settings, "native", [disabledId]), disabledId)
        .toThrow(`Director selected unavailable capability: ${disabledId}`);
      const stillEnabled = USER_CONFIGURABLE_CAPABILITY_IDS.find((id) => id !== disabledId)!;
      expect(capabilityCatalog(settings, "native").capabilities, stillEnabled).toHaveProperty(stillEnabled);
    }
  });

  it("keeps pseudo-video independent from speech and sound permissions", () => {
    const base = generationCommand().settings;
    const settings = {
      ...base,
      capabilities: { ...base.capabilities, audioSpeechEnabled: false },
    };
    expect(resolveCapabilities(settings, "native", ["pseudo-video"]).map(({ id }) => id)).toContain("pseudo-video");
    expect(() => resolveCapabilities(settings, "native", ["speech"]))
      .toThrow("Director selected unavailable capability: speech");
    expect(() => resolveCapabilities(settings, "native", ["sound"]))
      .toThrow("Director selected unavailable capability: sound");
  });

  it("deterministically reduces SCP-like pattern overload to one family and two uses", async () => {
    const settings = { ...generationCommand().settings, images: { mode: "tag-placeholder" as const, fetchExternal: false, safeContent: true }, minInternalLinks: 4 };
    const patterns = Array.from({ length: 12 }, (_, index) => `<section data-vibe-pattern="${index % 2 ? "dots" : "grid"}"><a href="/item-${index}">Item ${index}</a></section>`).join("");
    const result = await transformHtml({ html: `<!doctype html><html><head><title>Patterns</title></head><body><main>${patterns}</main></body></html>`, url: "https://scp.example/report", title: "Patterns", settings, selectedCapabilities: ["pattern-background"], browserTheme: "ie-classic", artifactSeed: "patterns", signal: new AbortController().signal });
    expect(result.html.match(/<section data-vibe-pattern=/g)).toHaveLength(2);
    expect(new Set([...result.html.matchAll(/<section data-vibe-pattern="([^"]+)/g)].map((match) => match[1])).size).toBe(1);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "pattern-background-capped" }));
  });

  it("bounds pseudo-video scenes, duration and music contracts", async () => {
    const settings = { ...generationCommand().settings, images: { mode: "tag-placeholder" as const, fetchExternal: false, safeContent: true }, minInternalLinks: 4 };
    const scenes = Array.from({ length: 14 }, (_, index) => `<figure data-vibe-video-scene data-duration-ms="120000"><img data-vibe-image="tram night" alt="Scene ${index}"><figcaption>Scene ${index}</figcaption><span data-vibe-narration data-at-ms="999999" data-pause-after-ms="999999">Narration ${index}</span><i data-vibe-music data-preset="arbitrary-code" data-intensity="9"></i></figure>`).join("");
    const result = await transformHtml({ html: `<!doctype html><html><head><title>Video</title></head><body><a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a><a href="/four">Four</a><section data-vibe-pseudo-video>${scenes}</section></body></html>`, url: "https://youtube.example/watch?v=tram", title: "Video", settings, selectedCapabilities: ["pseudo-video", "image-intents"], browserTheme: "native", artifactSeed: "video", signal: new AbortController().signal });
    expect(result.html.match(/data-vibe-video-scene/g)?.length).toBeLessThanOrEqual(12);
    expect(result.html).toContain('data-vibe-duration-ms="600000"');
    expect(result.html).not.toContain("arbitrary-code");
    expect(result.html).toContain('data-preset="silence"');
    expect(result.html).toContain('data-intensity="1.00"');
    expect(result.capabilityManifest).toContainEqual(expect.objectContaining({ id: "pseudo-video", instances: 1 }));
  });

  it("turns selected semantic markers into bounded offline artifacts and records actual usage", async () => {
    const settings = {
      ...generationCommand().settings,
      images: { mode: "off" as const, fetchExternal: false, safeContent: true },
      minInternalLinks: 0,
    };
    const result = await transformHtml({
      html: capabilityDocument,
      url: "https://science.example/demographic-report-2005",
      title: "Capability report",
      settings,
      selectedCapabilities: selected,
      browserTheme: "native",
      artifactSeed: "capability-report",
      signal: new AbortController().signal,
    });

    expect(result.html).not.toMatch(/<vibe-(?:chart|diagram|qr|avatar|map)\b/);
    expect(result.html).not.toContain("<template");
    expect(result.html).toContain('data-vibe-capability="data-chart"');
    expect(result.html).toContain('data-vibe-capability="diagram"');
    expect(result.html).toContain('data-vibe-capability="math"');
    expect(result.html).toContain('data-vibe-highlighted=""');
    expect(result.html).toContain('data-vibesurfer-capability="pattern-background"');
    expect(result.html).toContain("<math");
    expect(result.html).not.toContain("<script");
    expect(result.warnings).toEqual([]);
    expect(result.capabilityManifest.map((entry) => entry.id)).toEqual(expect.arrayContaining(selected));
  }, 20_000);

  it("uses passive placeholders in previews and strips unselected markers", async () => {
    const settings = { ...generationCommand().settings, allowGeneratedScripts: true, images: { mode: "off" as const, fetchExternal: false, safeContent: true } };
    const preview = await transformPreviewHtml({
      html: capabilityDocument.replace("</main>", "<script>document.body.dataset.unselected = 'bad'</script></main>"),
      url: "https://science.example/report",
      title: "Preview",
      settings,
      selectedCapabilities: ["data-chart"],
    });

    expect(preview).toContain("data-vibe-capability-preview");
    expect(preview).not.toContain("vega_legend");
    expect(preview).not.toContain("data-vibe-speak");
    expect(preview).not.toContain("<template");
    expect(preview).not.toContain("<script");
  });

  it("rejects network-bearing chart and diagram input without failing the page", async () => {
    const settings = { ...generationCommand().settings, images: { mode: "off" as const, fetchExternal: false, safeContent: true }, minInternalLinks: 0 };
    const result = await transformHtml({
      html: `<!doctype html><html><head><title>Bad data</title></head><body>
        <vibe-chart><template>{"data":{"url":"https://tracker.example/data.json"},"mark":"bar"}</template><figcaption>Bad chart</figcaption></vibe-chart>
        <vibe-diagram><pre>graph LR
A-->B
click A "https://tracker.example"</pre><figcaption>Bad diagram</figcaption></vibe-diagram>
      </body></html>`,
      url: "https://example.com/",
      title: "Bad data",
      settings,
      selectedCapabilities: ["data-chart", "diagram"],
      artifactSeed: "bad-capabilities",
      signal: new AbortController().signal,
    });

    expect(result.html).not.toContain("tracker.example");
    expect(result.html).toContain("data-vibe-capability-fallback");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "data-chart-render-failed" }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "diagram-render-failed" }));
  });

  it("caps chart and diagram rendering at eight heavy instances", async () => {
    const settings = { ...generationCommand().settings, images: { mode: "off" as const, fetchExternal: false, safeContent: true }, minInternalLinks: 0 };
    const chart = (index: number) => `<vibe-chart><template>{"mark":"bar","data":{"values":[{"x":"A","y":${index}}]},"encoding":{"x":{"field":"x"},"y":{"field":"y","type":"quantitative"}}}</template><figcaption>Chart ${index}</figcaption></vibe-chart>`;
    const result = await transformHtml({
      html: `<!doctype html><html><head><title>Budget</title></head><body>${Array.from({ length: 9 }, (_, index) => chart(index)).join("")}</body></html>`,
      url: "https://example.com/budget",
      title: "Budget",
      settings,
      selectedCapabilities: ["data-chart"],
      artifactSeed: "capability-budget",
      signal: new AbortController().signal,
    });

    expect(result.capabilityManifest.find(({ id }) => id === "data-chart")?.instances).toBe(8);
    expect(result.html.match(/data-vibe-rendered="true"/g)).toHaveLength(8);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "heavy-capability-capped" }));
  }, 20_000);
});
