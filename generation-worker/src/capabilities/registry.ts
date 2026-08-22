import type { BrowserTheme, GenerationSettings } from "../domain.js";
import {
  type CapabilityExecutionTarget,
  type CapabilityId,
  type ResolvedCapability,
  USER_CONFIGURABLE_CAPABILITY_IDS,
} from "./types.js";

export interface CapabilityDescriptor {
  id: CapabilityId;
  directorHint: string;
  builderContract: string;
  execution: CapabilityExecutionTarget;
  maxInstances: number;
  version: string;
  noticeIds: readonly string[];
  compact: boolean;
  available(settings: GenerationSettings, browserTheme: BrowserTheme): boolean;
}

const always = () => true;
const userConfigurableCapabilities = new Set<CapabilityId>(USER_CONFIGURABLE_CAPABILITY_IDS);

export const VIDEO_SCENE_KINDS = ["title", "text", "image", "split", "quote", "stat", "credits"] as const;
export const VIDEO_TRANSITIONS = ["cut", "crossfade", "dip-black", "slide-left", "slide-up", "push", "wipe", "zoom", "blur"] as const;
export const VIDEO_MOTIONS = ["still", "ken-burns-in", "ken-burns-out", "pan-left", "pan-right", "drift", "stagger", "credits-roll"] as const;
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "4:3", "3:2", "1:1", "4:5", "21:9"] as const;
export const VIDEO_MUSIC_TRACKS = [
  "ambient-glass", "documentary-pulse", "warm-memory", "investigative-low",
  "night-drive", "playful-pluck", "minimal-piano", "soft-suspense",
  "resolution-rise", "retro-digital", "quiet-nature", "credits-drift",
] as const;

export function hasVerifiedExternalMediaConnection(settings: GenerationSettings): boolean {
  return settings.voice.provider === "elevenlabs"
    && Boolean(settings.voice.mediaConnectionId)
    && settings.voice.availableVoiceIds.length > 0;
}

function pseudoVideoBuilderContract(settings: GenerationSettings): string {
  const hasVerifiedMediaConnection = hasVerifiedExternalMediaConnection(settings);
  const voiceIds = settings.voice.engine === "cloud" && hasVerifiedMediaConnection
    ? settings.voice.availableVoiceIds.slice(0, 100)
    : [settings.voice.voice || "af_heart"];
  const narration = settings.capabilities.audioSpeechEnabled
    ? settings.voice.engine === "cloud" && (!settings.capabilities.externalMediaEnabled || !hasVerifiedMediaConnection)
      ? "Cloud narration has no enabled verified connection. You may use one data-vibe-narration per scene for visible captions and transcript, but omit data-voice; playback will use a caption-only hold."
      : `Narration is available through safe voice IDs: ${voiceIds.join("|")}. Put zero or one <p data-vibe-narration lang="..." data-voice="optional-listed-id">spoken text</p> inside each scene; it also becomes captions and transcript.`
    : "Narration is disabled: do not emit data-vibe-narration.";
  const music = settings.voice.musicMode === "off"
    ? "Background music is disabled: use data-music-track=\"silence\"."
    : `Music track IDs: ${VIDEO_MUSIC_TRACKS.join("|")}|inherit|silence.${settings.voice.musicMode === "generate-if-requested" && settings.capabilities.externalMediaEnabled && hasVerifiedMediaConnection ? " If none fits, put one short English data-music-intent on <vibe-video>." : " Do not request generated music."}`;
  return [
    `Use one <vibe-video aria-label="..." data-pacing="slow|balanced|fast" data-aspect-ratio="${VIDEO_ASPECT_RATIOS.join("|")}"> with 1-12 direct children marked data-vibe-scene. The ratio is mandatory and is the immutable visual viewport: YouTube/Vimeo and ordinary landscape video use 16:9; TikTok, Reels and Shorts use 9:16; square feeds use 1:1; portrait editorial uses 4:5; cinematic pages may use 21:9.`,
    `Scene data-kind: ${VIDEO_SCENE_KINDS.join("|")}; data-transition: ${VIDEO_TRANSITIONS.join("|")}; data-motion: ${VIDEO_MOTIONS.join("|")}.`,
    "data-duration-ms is optional desired hold time 1000..120000, never a speech cutoff. Put visible headings/copy/images in the scene and mark automatically animated children data-vibe-layer.",
    narration,
    music,
    "Optional custom controls use data-vibe-video-action=play|pause|toggle|stop|mute|fullscreen, data-vibe-video-seek, data-vibe-video-volume, and data-vibe-video-time=current|duration. The trusted runtime supplies any missing controls, timing, captions and transcript.",
    "Do not emit audio/video URLs, raw MIDI notes, executable code, autoplay, external requests, or fake controls.",
  ].join(" ");
}

export function isCapabilityEnabled(settings: GenerationSettings, id: CapabilityId): boolean {
  return !userConfigurableCapabilities.has(id) || settings.capabilities.enabled[id] !== false;
}

const descriptors: readonly CapabilityDescriptor[] = [
  {
    id: "semantic-navigation",
    directorHint: "real same-site links and GET forms",
    builderContract: "Use real relative or same-origin href/action targets; never use href=# as placeholder navigation.",
    execution: "compiler",
    maxInstances: 128,
    version: "1",
    noticeIds: [],
    compact: true,
    available: always,
  },
  {
    id: "favicon-glyph",
    directorHint: "approved site favicon",
    builderContract: "The favicon is supplied by the approved identity and must not be changed or redrawn in HTML.",
    execution: "compiler",
    maxInstances: 1,
    version: "1",
    noticeIds: [],
    compact: false,
    available: always,
  },
  {
    id: "tailwind-utilities",
    directorHint: "stock Tailwind utility styling",
    builderContract: "Use literal utilities from the locally compiled Tailwind set for primary layout and styling. No CDN, @import, external stylesheet, arbitrary generated class, or dynamic class name.",
    execution: "compiler",
    maxInstances: 1,
    version: "4.3.3",
    noticeIds: ["npm:tailwindcss@4.3.3"],
    compact: true,
    available: (settings) => settings.tailwindEnabled,
  },
  {
    id: "inline-page-css",
    directorHint: "page-owned CSS for exact visual details",
    builderContract: "Use one inline page-level style element for exact selectors, era-specific details, CSS variables, and capability wrappers. Capability output inherits the page design and must not dictate the era.",
    execution: "compiler",
    maxInstances: 1,
    version: "1",
    noticeIds: [],
    compact: true,
    available: always,
  },
  {
    id: "image-intents",
    directorHint: "contextual editorial images",
    builderContract: "Use <img data-vibe-image=\"one or two concrete English nouns\" alt=\"meaningful description\">; never emit a remote image URL.",
    execution: "compiler",
    maxInstances: 24,
    version: "1",
    noticeIds: [],
    compact: true,
    available: (settings) => settings.images.mode !== "off",
  },
  {
    id: "local-dom-scripts",
    directorHint: "small page-authored DOM behavior",
    builderContract: "Inline classic scripts may use DOM-only behavior; no network, storage, workers, eval, navigation, parent/top/opener, or native APIs. Mark non-navigation forms data-vibe-local.",
    execution: "trusted-runtime",
    maxInstances: 16,
    version: "1",
    noticeIds: [],
    compact: false,
    available: (settings) => settings.allowGeneratedScripts,
  },
  {
    id: "pattern-background",
    directorHint: "one restrained procedural texture only when the destination's established visual language clearly calls for it",
    builderContract: "Use data-vibe-pattern=\"dots|grid|diagonal|cross|waves|paper\" only when the approved direction explicitly calls for texture. Use one motif family, on no more than two elements. If body is patterned, do not pattern any panel. Set a low-contrast --vibe-pattern-color, --vibe-pattern-size, and background color in page CSS.",
    execution: "compiler",
    maxInstances: 2,
    version: "1",
    noticeIds: [],
    compact: false,
    available: always,
  },
  {
    id: "motion-presets",
    directorHint: "purposeful reveal, count, pulse, or ticker motion",
    builderContract: "Add data-vibe-motion=\"reveal|stagger|pulse|ticker\" to existing elements. Motion is progressive enhancement and must remain understandable when disabled.",
    execution: "trusted-runtime",
    maxInstances: 32,
    version: "1",
    noticeIds: [],
    compact: true,
    available: (settings) => settings.motionEnabled !== false,
  },
  {
    id: "data-chart",
    directorHint: "bar, line, area, point, or pie charts from page data",
    builderContract: "Use <vibe-chart aria-label=\"...\"><template>{valid Vega-Lite JSON with inline values only}</template><figcaption>...</figcaption></vibe-chart>. Keep data truthful to the page and under 200 rows; do not add URLs.",
    execution: "compiler",
    maxInstances: 8,
    version: "vega-lite-6.4.3",
    noticeIds: ["npm:vega-lite@6.4.3", "npm:vega@6.4.0"],
    compact: true,
    available: always,
  },
  {
    id: "diagram",
    directorHint: "flowchart, timeline, mindmap, sequence, state, ER, or architecture diagram",
    builderContract: "Use <vibe-diagram aria-label=\"...\"><pre>valid Mermaid source</pre><figcaption>...</figcaption></vibe-diagram>. Keep it compact and never use links or click directives.",
    execution: "compiler",
    maxInstances: 8,
    version: "beautiful-mermaid-1.1.3",
    noticeIds: ["npm:beautiful-mermaid@1.1.3"],
    compact: false,
    available: always,
  },
  {
    id: "math",
    directorHint: "accessible inline or display mathematics",
    builderContract: "Use <span data-vibe-math>TeX</span> inline or <div data-vibe-math data-display=\"block\">TeX</div>. Do not include dollar delimiters.",
    execution: "compiler",
    maxInstances: 64,
    version: "katex-0.18.4",
    noticeIds: ["npm:katex@0.18.4"],
    compact: false,
    available: always,
  },
  {
    id: "code-highlight",
    directorHint: "syntax-highlighted source code or configuration",
    builderContract: "Use <pre data-vibe-code=\"language-id\"><code>escaped source</code></pre>. Supported languages: text, html, css, javascript, typescript, json, bash, rust, python, markdown, sql.",
    execution: "compiler",
    maxInstances: 16,
    version: "shiki-4.4.3",
    noticeIds: ["npm:shiki@4.4.3"],
    compact: false,
    available: always,
  },
  {
    id: "qr-code",
    directorHint: "QR code for a visible URL or short text",
    builderContract: "Use <vibe-qr data-value=\"exact visible value\" aria-label=\"...\"></vibe-qr>. The encoded value must also appear as readable text nearby.",
    execution: "compiler",
    maxInstances: 8,
    version: "qrcode-1.5.4",
    noticeIds: ["npm:qrcode@1.5.4"],
    compact: false,
    available: always,
  },
  {
    id: "avatar",
    directorHint: "stable fictional avatars without real-person photos",
    builderContract: "Use <vibe-avatar data-seed=\"stable fictional name\" data-style=\"initials|shapes|personas|bottts\" aria-label=\"...\"></vibe-avatar>. Style the wrapper size and shape in page CSS.",
    execution: "compiler",
    maxInstances: 64,
    version: "dicebear-9.4.2",
    noticeIds: ["npm:@dicebear/core@9.4.3", "npm:@dicebear/collection@9.4.2"],
    compact: false,
    available: always,
  },
  {
    id: "synthetic-map",
    directorHint: "fictional schematic map or route",
    builderContract: "Use <vibe-map aria-label=\"...\"><template>{\"places\":[{\"name\":\"...\",\"x\":0-100,\"y\":0-100}],\"routes\":[[0,1]]}</template><figcaption>...</figcaption></vibe-map>. Use fictional or explicitly schematic geography only.",
    execution: "compiler",
    maxInstances: 4,
    version: "1",
    noticeIds: [],
    compact: false,
    available: always,
  },
  {
    id: "micro-widgets",
    directorHint: "progress, countdown, rating, poll, terminal, patch, sticker, price, marquee, or waveform primitives",
    builderContract: "Use semantic HTML plus data-vibe-widget=\"progress|countdown|rating|poll|terminal|patch|sticker|price|marquee|waveform\". Supply honest visible labels and values through ordinary text, data-value, data-max, data-target, or child buttons; fully style it in page CSS.",
    execution: "trusted-runtime",
    maxInstances: 32,
    version: "1",
    noticeIds: [],
    compact: true,
    available: always,
  },
  {
    id: "carousel",
    directorHint: "user-controlled horizontal collection",
    builderContract: "Use <section data-vibe-carousel aria-label=\"...\"> with direct article/figure children and optional buttons data-vibe-prev/data-vibe-next. It must remain readable as a normal list without JavaScript.",
    execution: "trusted-runtime",
    maxInstances: 4,
    version: "1",
    noticeIds: [],
    compact: true,
    available: always,
  },
  {
    id: "slideshow",
    directorHint: "lightweight user-controlled image gallery",
    builderContract: "Use <section data-vibe-slideshow data-interval=\"4000\" aria-label=\"...\"> with direct article/figure slides. Include visible play/pause, previous and next buttons using data-vibe-play/data-vibe-prev/data-vibe-next.",
    execution: "trusted-runtime",
    maxInstances: 2,
    version: "1",
    noticeIds: [],
    compact: true,
    available: always,
  },
  {
    id: "pseudo-video",
    directorHint: "a real local scene timeline for YouTube and other video-centric pages; select this instead of slideshow for the primary player and preserve the source format (YouTube/Vimeo landscape, TikTok/Reels/Shorts vertical)",
    builderContract: "Use one declarative <vibe-video> scene timeline. The trusted runtime owns time, audio and controls.",
    execution: "trusted-runtime",
    maxInstances: 1,
    version: "3",
    noticeIds: [],
    compact: true,
    available: always,
  },
  {
    id: "speech",
    directorHint: "user-triggered read-aloud controls",
    builderContract: "Use a real <button data-vibe-speak=\"#target-id\">Read aloud</button>. The target must contain bounded visible page text. Never autoplay speech.",
    execution: "trusted-runtime",
    maxInstances: 8,
    version: "web-speech-1",
    noticeIds: [],
    compact: true,
    available: (settings) => settings.capabilities.audioSpeechEnabled,
  },
  {
    id: "sound",
    directorHint: "user-triggered procedural tones",
    builderContract: "Use <button data-vibe-sound=\"confirm|alert|chime|tick\"> with a visible purpose. Sound requires a user gesture and must never autoplay.",
    execution: "trusted-runtime",
    maxInstances: 8,
    version: "web-audio-1",
    noticeIds: [],
    compact: false,
    available: (settings) => settings.capabilities.audioSpeechEnabled,
  },
  {
    id: "dynamic-regions",
    directorHint: "host-mediated live regions for chats, feeds, auctions, statuses, carts, wishlists, or other genuinely changing interfaces",
    builderContract: "Use dynamic regions only when the page genuinely benefits from in-place changes. Mark replaceable blocks with unique data-vibe-region IDs. Use data-vibe-action=\"state:cart.add|state:cart.remove|state:cart.setQuantity|state:wishlist.toggle|state:value.set\" for trusted state or data-vibe-action=\"model:semantic-name\" for generated content; list permitted region IDs in data-vibe-target. Use named form fields for parameters. A model-refreshed region may use data-vibe-refresh=\"60\" or more. Bind deterministic text with data-vibe-bind=\"cart.count|cart.total|wishlist.count|value.key\". Do not write JavaScript, fetch, or timers for these actions. Render a useful initial state, and use this capability sparingly: ordinary articles and static storefronts stay static.",
    execution: "host",
    maxInstances: 16,
    version: "1",
    noticeIds: [],
    compact: true,
    available: (settings) => settings.dynamicMode !== "off",
  },
  {
    id: "external-media",
    directorHint: "licensed stock photo or video from a configured provider",
    builderContract: "External media is resolved by the trusted host. Use only the supplied data-vibe-media marker and preserve its attribution container.",
    execution: "host",
    maxInstances: 8,
    version: "1",
    noticeIds: [],
    compact: false,
    available: () => false,
  },
  {
    id: "gifcities",
    directorHint: "copyright-sensitive archived web GIF",
    builderContract: "Use only host-resolved archived GIF markers and keep the source/copyright notice visible.",
    execution: "host",
    maxInstances: 4,
    version: "1",
    noticeIds: [],
    compact: false,
    available: () => false,
  },
  {
    id: "real-map",
    directorHint: "real map from a user-configured tile provider",
    builderContract: "Use only host-resolved map markers with real coordinates and provider attribution.",
    execution: "host",
    maxInstances: 2,
    version: "1",
    noticeIds: [],
    compact: false,
    available: () => false,
  },
];

export const CAPABILITY_REGISTRY: ReadonlyMap<CapabilityId, CapabilityDescriptor> = new Map(
  descriptors.map((descriptor) => [descriptor.id, descriptor]),
);

export function availableCapabilities(
  settings: GenerationSettings,
  browserTheme: BrowserTheme,
): readonly CapabilityDescriptor[] {
  return descriptors.filter((descriptor) => descriptor.available(settings, browserTheme)
    && isCapabilityEnabled(settings, descriptor.id));
}

export function compactCapabilityContracts(
  settings: GenerationSettings,
  browserTheme: BrowserTheme,
): Readonly<Partial<Record<CapabilityId, string>>> {
  return Object.fromEntries(
    availableCapabilities(settings, browserTheme)
      .filter((descriptor) => descriptor.compact)
      .map((descriptor) => [descriptor.id, descriptor.builderContract]),
  ) as Partial<Record<CapabilityId, string>>;
}

export function resolveCapabilities(
  settings: GenerationSettings,
  browserTheme: BrowserTheme,
  selected: readonly CapabilityId[],
): readonly ResolvedCapability[] {
  const required: CapabilityId[] = [
    "semantic-navigation",
    "inline-page-css",
    ...(settings.tailwindEnabled ? ["tailwind-utilities" as const] : []),
  ];
  const unique = [...new Set([...required, ...selected])];
  return unique.map((id) => {
    const descriptor = CAPABILITY_REGISTRY.get(id);
    if (!descriptor || !descriptor.available(settings, browserTheme)
      || !isCapabilityEnabled(settings, descriptor.id)) {
      throw new Error(`Director selected unavailable capability: ${id}`);
    }
    return {
      id: descriptor.id,
      builderContract: descriptor.id === "pseudo-video" ? pseudoVideoBuilderContract(settings) : descriptor.builderContract,
      execution: descriptor.execution,
      maxInstances: descriptor.maxInstances,
      version: descriptor.version,
      noticeIds: descriptor.noticeIds,
    };
  });
}

export function capabilityContractRecord(
  capabilities: readonly ResolvedCapability[],
): Partial<Record<CapabilityId, string>> {
  return Object.fromEntries(capabilities.map((capability) => [capability.id, capability.builderContract])) as Partial<Record<CapabilityId, string>>;
}
