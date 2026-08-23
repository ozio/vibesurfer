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
    expect(result.html.match(/data-vibe-scene=""/g)?.length ?? 0).toBeLessThanOrEqual(12);
    expect(result.html).toContain("<vibe-video");
    expect(result.html).toContain('data-aspect-ratio="16:9"');
    expect(result.html).not.toContain("data-vibe-video-scene");
    expect(result.html).toContain('data-vibe-duration-ms="600000"');
    expect(result.html).not.toContain("arbitrary-code");
    expect(result.html).toContain('data-music-track="silence"');
    expect(result.html).not.toContain("data-vibe-music");
    expect(result.html).not.toContain("data-at-ms");
    expect(result.capabilityManifest).toContainEqual(expect.objectContaining({ id: "pseudo-video", instances: 1 }));
  });

  it("accepts every declarative video preset and normalizes unknown IDs without executable media", async () => {
    const settings = { ...generationCommand().settings, images: { mode: "off" as const, fetchExternal: false, safeContent: true }, minInternalLinks: 0 };
    const kinds = ["title", "text", "image", "split", "quote", "stat", "credits"];
    const transitions = ["cut", "crossfade", "dip-black", "slide-left", "slide-up", "push", "wipe", "zoom", "blur"];
    const motions = ["still", "ken-burns-in", "ken-burns-out", "pan-left", "pan-right", "drift", "stagger", "credits-roll", "unknown-motion"];
    const scenes = transitions.map((transition, index) => `<section data-vibe-scene data-kind="${index === 8 ? "unknown-kind" : kinds[index % kinds.length]}" data-transition="${transition}" data-motion="${motions[index]}" data-music-track="${index === 8 ? "https://evil.example/song.mid" : "ambient-glass"}" data-midi-notes="60,64,67"><p data-vibe-narration data-voice="unlisted-paid-voice" lang="invalid language">${"word ".repeat(index === 0 ? 200 : 2)}</p><audio src="https://evil.example/voice.mp3"></audio><script>window.badVideoCode=true</script><button autoplay data-vibe-video-action="eval-code">Bad control</button><output data-vibe-video-time="clock"></output></section>`).join("");
    const result = await transformHtml({ html: `<!doctype html><html><head><title>Video presets</title></head><body><vibe-video autoplay data-pacing="slow" data-aspect-ratio="calc(100vh)" data-music-intent="https://evil.example/generate">${scenes}</vibe-video></body></html>`, url: "https://video.example/watch", title: "Video presets", settings, selectedCapabilities: ["pseudo-video"], browserTheme: "native", artifactSeed: "presets", signal: new AbortController().signal });
    for (const transition of transitions) expect(result.html).toContain(`data-transition="${transition}"`);
    for (const motion of motions.slice(0, -1)) expect(result.html).toContain(`data-motion="${motion}"`);
    for (const kind of kinds) expect(result.html).toContain(`data-kind="${kind}"`);
    expect(result.html).toContain('data-motion="still"');
    expect(result.html).toContain('data-kind="text"');
    expect(result.html).toContain('data-aspect-ratio="16:9"');
    expect(result.html).not.toContain("calc(100vh)");
    expect(result.html).toContain('data-music-track="silence"');
    expect(result.html).not.toContain("evil.example");
    expect(result.html).not.toContain("data-music-intent");
    expect(result.html).not.toContain("unlisted-paid-voice");
    expect(result.html).not.toContain("invalid language");
    expect(result.html).not.toContain("autoplay");
    expect(result.html).not.toContain("eval-code");
    expect(result.html).not.toContain('data-vibe-video-time="clock"');
    expect(result.html).not.toContain("data-midi-notes");
    expect(result.html).not.toContain("badVideoCode");
    expect(result.html).not.toContain("word ".repeat(161));
  });

  it("pins a safe source-aware viewport ratio for landscape and vertical video pages", async () => {
    const settings = { ...generationCommand().settings, images: { mode: "off" as const, fetchExternal: false, safeContent: true }, minInternalLinks: 0 };
    const markup = (aspect = "") => `<!doctype html><html><head><title>Ratio</title></head><body><vibe-video${aspect}><section data-vibe-scene data-kind="image">Frame</section></vibe-video></body></html>`;
    const compile = (url: string, aspect = "") => transformHtml({ html: markup(aspect), url, title: "Ratio", settings, selectedCapabilities: ["pseudo-video"], browserTheme: "native" as const, artifactSeed: "ratio", signal: new AbortController().signal });
    expect((await compile("https://www.youtube.com/watch?v=tram")).html).toContain('data-aspect-ratio="16:9"');
    expect((await compile("https://www.youtube.com/shorts/tram")).html).toContain('data-aspect-ratio="9:16"');
    expect((await compile("https://www.tiktok.com/@north/video/123")).html).toContain('data-aspect-ratio="9:16"');
    expect((await compile("https://vimeo.com/123", ' data-aspect-ratio="4:5"')).html).toContain('data-aspect-ratio="4:5"');
  });

  it("binds model-authored player chrome instead of allowing fake time or runtime fallback UI", async () => {
    const settings = { ...generationCommand().settings, images: { mode: "off" as const, fetchExternal: false, safeContent: true }, minInternalLinks: 0 };
    const result = await transformHtml({
      html: `<!doctype html><html><head><title>Video chrome</title></head><body><vibe-video><section data-vibe-scene>Frame</section><div class="player-controls"><button data-vibe-video-action="play">▶</button><div class="progress" aria-hidden="true"><span></span></div><span class="time">2:31 / 6:42</span><button data-vibe-video-action="mute">🔊</button><button data-vibe-video-action="fullscreen">Fullscreen</button></div></vibe-video></body></html>`,
      url: "https://youtube.com/watch?v=test",
      title: "Video chrome",
      settings,
      selectedCapabilities: ["pseudo-video"],
      browserTheme: "native",
      artifactSeed: "video-chrome",
      signal: new AbortController().signal,
    });
    expect(result.html).toContain('data-vibe-video-controls=""');
    expect(result.html).toContain('data-vibe-video-action="toggle"');
    expect(result.html).toContain('data-vibe-video-seek=""');
    expect(result.html).toContain('data-vibe-video-progress-fill=""');
    expect(result.html).toContain('data-vibe-video-time="combined"');
    expect(result.html).not.toContain("2:31 / 6:42");
    expect(result.html).not.toContain("Fullscreen");
    expect(result.html).not.toContain('data-vibe-video-action="fullscreen"');
  });

  it("switches narration, music and external generation independently", async () => {
    const base = generationCommand().settings;
    const markup = `<!doctype html><html><head><title>Layers</title></head><body><vibe-video data-music-intent="quiet glass score"><section data-vibe-scene data-kind="text" data-transition="cut" data-motion="still" data-music-track="ambient-glass"><p data-vibe-narration>Spoken caption</p></section></vibe-video></body></html>`;
    const compile = (settings: typeof base) => transformHtml({ html: markup, url: "https://video.example/watch", title: "Layers", settings: { ...settings, minInternalLinks: 0 }, selectedCapabilities: ["pseudo-video"], browserTheme: "native" as const, artifactSeed: "layers", signal: new AbortController().signal });
    const narrationOff = await compile({ ...base, capabilities: { ...base.capabilities, audioSpeechEnabled: false } });
    expect(narrationOff.html).not.toContain("data-vibe-narration");
    expect(narrationOff.html).toContain("Spoken caption");
    expect(narrationOff.html).toContain('data-music-track="ambient-glass"');
    const musicOff = await compile({ ...base, voice: { ...base.voice, musicMode: "off" } });
    expect(musicOff.html).toContain("data-vibe-narration");
    expect(musicOff.html).toContain('data-music-track="silence"');
    const externalOn = await compile({ ...base, capabilities: { ...base.capabilities, externalMediaEnabled: true }, voice: { ...base.voice, provider: "elevenlabs", mediaConnectionId: "media-1", availableVoiceIds: ["voice-one"], musicMode: "generate-if-requested" } });
    expect(externalOn.html).toContain('data-music-intent="quiet glass score"');
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
