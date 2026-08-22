import type { CapabilityExecutionTarget, CapabilityId } from "../types/browser";

export const USER_CONFIGURABLE_CAPABILITY_IDS = [
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
  "pseudo-video",
  "speech",
  "sound",
] as const satisfies readonly CapabilityId[];

export type UserConfigurableCapabilityId = typeof USER_CONFIGURABLE_CAPABILITY_IDS[number];

export interface GenerationCapabilityOption {
  id: UserConfigurableCapabilityId;
  title: string;
  description: string;
  execution: CapabilityExecutionTarget;
}

export const GENERATION_CAPABILITY_OPTIONS: readonly GenerationCapabilityOption[] = [
  { id: "pattern-background", title: "Pattern backgrounds", description: "Restrained dots, grids, waves, paper, or diagonal textures.", execution: "compiler" },
  { id: "motion-presets", title: "Motion presets", description: "Purposeful reveal, stagger, pulse, and ticker motion.", execution: "trusted-runtime" },
  { id: "data-chart", title: "Data charts", description: "Offline Vega-Lite charts rendered from bounded inline data.", execution: "compiler" },
  { id: "diagram", title: "Diagrams", description: "Offline flowcharts, timelines, sequences, and architecture diagrams.", execution: "compiler" },
  { id: "math", title: "Math typesetting", description: "Accessible inline and display equations.", execution: "compiler" },
  { id: "code-highlight", title: "Code highlighting", description: "Syntax-highlighted source and configuration blocks.", execution: "compiler" },
  { id: "qr-code", title: "QR codes", description: "Locally rendered QR codes for visible values.", execution: "compiler" },
  { id: "avatar", title: "Generated avatars", description: "Stable fictional avatars without remote person photos.", execution: "compiler" },
  { id: "synthetic-map", title: "Synthetic maps", description: "Fictional schematic places and routes.", execution: "compiler" },
  { id: "micro-widgets", title: "Micro-widgets", description: "Progress, countdown, rating, poll, terminal, price, and waveform primitives.", execution: "trusted-runtime" },
  { id: "carousel", title: "Carousels", description: "User-controlled horizontal collections with readable fallbacks.", execution: "trusted-runtime" },
  { id: "slideshow", title: "Slideshows", description: "Lightweight galleries with previous, next, and play controls.", execution: "trusted-runtime" },
  { id: "pseudo-video", title: "Pseudo-video players", description: "Local multi-scene timelines with seek, captions, transcript, and fullscreen.", execution: "trusted-runtime" },
  { id: "speech", title: "Read-aloud controls", description: "User-triggered speech for bounded visible page text.", execution: "trusted-runtime" },
  { id: "sound", title: "Procedural sound", description: "User-triggered confirm, alert, chime, and tick tones.", execution: "trusted-runtime" },
];

export const DEFAULT_GENERATION_CAPABILITY_FLAGS: Record<UserConfigurableCapabilityId, boolean> =
  Object.fromEntries(USER_CONFIGURABLE_CAPABILITY_IDS.map((id) => [id, true])) as Record<UserConfigurableCapabilityId, boolean>;
