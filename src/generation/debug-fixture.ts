import { GENERATION_CAPABILITY_OPTIONS, type UserConfigurableCapabilityId } from "./capability-settings";
import type { GenerationSettings } from "../types/browser";

export interface GenerationDebugFixture {
  html: string;
  enabledCapabilities: UserConfigurableCapabilityId[];
  allowGeneratedScripts: boolean;
}

export function buildGenerationDebugFixture(
  settings: GenerationSettings,
  animationsEnabled: boolean,
): GenerationDebugFixture {
  const turbo = settings.strategy === "turbo";
  const enabled = (id: UserConfigurableCapabilityId) => !turbo
    && settings.capabilities.enabled[id] !== false
    && (id !== "motion-presets" || animationsEnabled)
    && (!(["speech", "sound"] as string[]).includes(id) || settings.capabilities.audioSpeechEnabled);
  const enabledCapabilities = GENERATION_CAPABILITY_OPTIONS.filter(({ id }) => enabled(id)).map(({ id }) => id);
  const imagesEnabled = !turbo && settings.images.enabled
    && settings.images.provider === "tag-placeholder"
    && settings.images.allowExternalRequests;
  const scriptsEnabled = !turbo && settings.style.allowGeneratedScripts;
  const tailwindEnabled = !turbo && settings.style.tailwindEnabled;
  const iconsEnabled = !turbo && settings.capabilities.iconsEnabled;
  const dynamicEnabled = !turbo && settings.dynamicMode !== "off";

  const capabilityCard = (id: UserConfigurableCapabilityId, body: string) => {
    const option = GENERATION_CAPABILITY_OPTIONS.find((candidate) => candidate.id === id)!;
    return `<article class="debug-card" data-debug-feature="${id}" data-debug-enabled="${enabled(id)}">
      <header><strong>${option.title}</strong><code>${id}</code></header>
      ${enabled(id) ? body : '<p class="debug-disabled">Disabled in generation settings</p>'}
    </article>`;
  };

  const image = imagesEnabled
    ? '<img class="debug-photo" src="https://loremflickr.com/640/360/tram,city?lock=99173&random=99173" alt="A city tram used to verify LoremFlickr image rendering" loading="lazy">'
    : '<p class="debug-disabled">LoremFlickr image resolution is disabled</p>';
  const sceneImage = (query: string, lock: number) => imagesEnabled
    ? `<img src="https://loremflickr.com/640/360/${query}?lock=${lock}&random=${lock}" alt="Pseudo-video scene">`
    : '<div class="debug-scene-art" aria-hidden="true"></div>';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Generation debug fixture</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eef1f5;color:#172033;font:14px/1.45 Arial,sans-serif}.debug-page{max-width:1240px;margin:auto;padding:28px}.debug-page>header{margin-bottom:22px}.debug-page h1{margin:0 0 8px;font-size:30px}.debug-page>header p{margin:0;color:#596577}.debug-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.debug-card{min-width:0;padding:16px;border:1px solid #c8d0dc;border-radius:12px;background:white;box-shadow:0 3px 12px #1d2a3a12}.debug-card>header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.debug-card code{font-size:10px;color:#667085}.debug-card svg,.debug-card img{display:block;max-width:100%;height:auto}.debug-disabled{padding:16px;border:1px dashed #a9b2bf;border-radius:8px;color:#697586;background:#f6f7f9}.debug-photo{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px}.debug-bars{display:flex;align-items:end;gap:8px;height:120px;padding:12px;border-left:2px solid #5d6b80;border-bottom:2px solid #5d6b80}.debug-bars i{flex:1;background:#5e5ce6;border-radius:4px 4px 0 0}.debug-flow{display:flex;align-items:center;justify-content:center;gap:9px;min-height:90px}.debug-flow span{padding:9px;border:1px solid #8390a3;border-radius:7px;background:#f8fafc}.debug-code{overflow:auto;padding:12px;border-radius:8px;background:#101722;color:#a7f3d0}.debug-map{width:100%;aspect-ratio:16/9;color:#3256a8;background:#edf3ff;border-radius:8px}.debug-avatar{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;color:white;background:linear-gradient(135deg,#7257d5,#32a6a0);font-size:26px;font-weight:700}.debug-pattern{min-height:96px;padding:18px;border-radius:8px;background-color:#f4f1e8;--vibe-pattern-color:#7b715c22;--vibe-pattern-size:18px;background-image:radial-gradient(circle,var(--vibe-pattern-color) 1px,transparent 1.5px);background-size:var(--vibe-pattern-size) var(--vibe-pattern-size)}.debug-scene-art{min-height:130px;background:linear-gradient(135deg,#203652,#af7958)}[data-vibe-slideshow]>article,[data-vibe-video-scene]{min-height:130px;padding:14px;border-radius:8px;background:#e9edf5}[data-vibe-video-scene] img{width:100%;aspect-ratio:16/9;object-fit:cover}.debug-carousel{display:flex;overflow:auto;gap:10px}.debug-carousel article{min-width:70%;padding:22px;border-radius:8px;background:#edf3ff}.debug-controls,[data-vibe-video-controls]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.debug-controls button,.debug-card>button,[data-vibe-video-controls] button{padding:7px 11px;border:1px solid #8390a3;border-radius:6px;background:#f7f8fa}[data-vibe-video-controls] label{display:flex;align-items:center;gap:6px;flex:1 1 160px}[data-vibe-video-controls] input{min-width:90px;flex:1}[data-vibe-video-caption]{display:block;margin:8px 0}[data-vibe-video-transcript]{margin-top:8px}.debug-qr{width:112px;height:112px}.debug-widget{padding:10px;border-radius:8px;background:linear-gradient(90deg,#5e5ce6 var(--vibe-progress,62%),#e5e7eb 0);color:#111;font-weight:700}.debug-motion{padding:18px;border-radius:8px;background:#edf3ff}.debug-icon{width:56px;color:#5e5ce6}.debug-script-ok{color:#147a45;font-weight:700}.debug-region{padding:12px;border:1px solid #83a1d5;border-radius:8px;background:#f4f7ff}@media(max-width:600px){.debug-page{padding:16px}}
  </style></head><body><main class="debug-page"><header><h1>Generated output fixture</h1><p>Final compiler-shaped markup rendered inside the production artifact sandbox.</p></header><section class="debug-grid">
    <article class="debug-card" data-debug-feature="image-intents" data-debug-enabled="${imagesEnabled}"><header><strong>LoremFlickr images</strong><code>image-intents</code></header>${image}</article>
    <article class="debug-card" data-debug-feature="tailwind-utilities" data-debug-enabled="${tailwindEnabled}"><header><strong>Tailwind utilities</strong><code>tailwind-utilities</code></header>${tailwindEnabled ? '<div data-vibe-capability="tailwind-utilities" style="padding:18px;border-radius:8px;background:#172033;color:white">Compiled utility output remains styled offline.</div>' : '<p class="debug-disabled">Tailwind compilation is disabled</p>'}</article>
    <article class="debug-card" data-debug-feature="iconify" data-debug-enabled="${iconsEnabled}"><header><strong>Icon library</strong><code>selected_icon_contract</code></header>${iconsEnabled ? '<svg class="debug-icon" data-vibe-capability="iconify" viewBox="0 0 24 24" role="img" aria-label="Compiled sparkle icon"><path fill="currentColor" d="m12 2 1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2Zm6 12 .9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9L18 14Z"/></svg>' : '<p class="debug-disabled">Icon catalog is withheld from the Director</p>'}</article>
    <article class="debug-card" data-debug-feature="local-dom-scripts" data-debug-enabled="${scriptsEnabled}"><header><strong>Generated JavaScript</strong><code>local-dom-scripts</code></header><p data-debug-script-output>${scriptsEnabled ? "Waiting for the final sandbox script…" : "Generated scripts are disabled"}</p>${scriptsEnabled ? '<script>document.querySelector("[data-debug-script-output]").textContent="Final sandbox script executed";document.querySelector("[data-debug-script-output]").className="debug-script-ok";</script>' : ""}</article>
    <article class="debug-card" data-debug-feature="dynamic-regions" data-debug-enabled="${dynamicEnabled}"><header><strong>Dynamic regions</strong><code>dynamic-regions</code></header>${dynamicEnabled ? '<section class="debug-region" data-vibe-region="debug-status">Host-mediated region ready</section>' : '<p class="debug-disabled">Dynamic regions are disabled</p>'}</article>
    ${capabilityCard("pattern-background", '<div class="debug-pattern" data-vibe-pattern="dots">One restrained compiled texture</div>')}
    ${capabilityCard("motion-presets", '<div class="debug-motion" data-vibe-motion="reveal">One-shot reveal in the trusted runtime</div>')}
    ${capabilityCard("data-chart", '<figure data-vibe-capability="data-chart"><div class="debug-bars" role="img" aria-label="Generated requests by day"><i style="height:35%"></i><i style="height:58%"></i><i style="height:82%"></i><i style="height:66%"></i></div><figcaption>Bounded inline chart data</figcaption></figure>')}
    ${capabilityCard("diagram", '<figure data-vibe-capability="diagram"><div class="debug-flow" role="img" aria-label="Director to compiler flow"><span>Director</span><b>→</b><span>Builder</span><b>→</b><span>Compiler</span></div><figcaption>Rendered diagram output</figcaption></figure>')}
    ${capabilityCard("math", '<div data-vibe-capability="math"><math display="block"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup><mo>=</mo><msup><mi>z</mi><mn>2</mn></msup></mrow></math></div>')}
    ${capabilityCard("code-highlight", '<div data-vibe-capability="code-highlight" class="debug-code"><code><span style="color:#93c5fd">const</span> rendered = <span style="color:#fca5a5">true</span>;</code></div>')}
    ${capabilityCard("qr-code", '<figure data-vibe-capability="qr-code"><svg class="debug-qr" viewBox="0 0 21 21" role="img" aria-label="Locally rendered debug QR"><rect width="21" height="21" fill="white"/><path fill="#111" d="M1 1h7v7H1zm2 2v3h3V3zm10-2h7v7h-7zm2 2v3h3V3zM1 13h7v7H1zm2 2v3h3v-3zm7-5h2v2h-2zm3 0h2v3h-2zm3 1h4v2h-4zm-6 3h3v2h-3zm4 1h2v5h-2zm3-1h3v2h-3zm0 4h3v2h-3zm-7 0h2v2h-2z"/></svg><figcaption>Inline SVG QR output</figcaption></figure>')}
    ${capabilityCard("avatar", '<span class="debug-avatar" data-vibe-capability="avatar" role="img" aria-label="Ada North avatar">AN</span>')}
    ${capabilityCard("synthetic-map", '<figure data-vibe-capability="synthetic-map"><svg class="debug-map" viewBox="0 0 400 220" role="img" aria-label="Synthetic map"><path d="M45 170C120 80 225 190 350 55" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="45" cy="170" r="9" fill="currentColor"/><circle cx="350" cy="55" r="9" fill="currentColor"/><text x="55" y="190" fill="currentColor">Archive</text><text x="260" y="42" fill="currentColor">Observatory</text></svg><figcaption>Fictional bounded geography</figcaption></figure>')}
    ${capabilityCard("micro-widgets", '<div class="debug-widget" data-vibe-widget="progress" data-value="62" data-max="100">62% complete</div>')}
    ${capabilityCard("carousel", '<section class="debug-carousel" data-vibe-carousel aria-label="Debug carousel"><article>First generated item</article><article>Second generated item</article><div class="debug-controls"><button data-vibe-prev type="button">Previous</button><button data-vibe-next type="button">Next</button></div></section>')}
    ${capabilityCard("slideshow", '<section data-vibe-slideshow aria-label="Debug slideshow"><article>First generated slide</article><article>Second generated slide</article><div class="debug-controls"><button data-vibe-prev type="button">Previous</button><button data-vibe-play type="button">Play</button><button data-vibe-next type="button">Next</button></div></section>')}
    ${capabilityCard("pseudo-video", `<section data-vibe-pseudo-video aria-label="Debug pseudo-video"><figure data-vibe-video-scene data-duration-ms="5000">${sceneImage("tram,city", 99174)}<figcaption>Arrival at Northbridge</figcaption></figure><figure data-vibe-video-scene data-duration-ms="5000">${sceneImage("railway,night", 99175)}<figcaption>Night service begins</figcaption></figure></section>`)}
    ${capabilityCard("speech", '<p id="debug-spoken-text">This bounded text verifies the generated read-aloud control.</p><button type="button" data-vibe-speak="#debug-spoken-text">Read aloud</button>')}
    ${capabilityCard("sound", '<button type="button" data-vibe-sound="chime">Play generated chime</button>')}
  </section></main></body></html>`;

  return { html, enabledCapabilities, allowGeneratedScripts: scriptsEnabled };
}
