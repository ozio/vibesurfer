export const BROWSER_THEME_IDS = [
  "native",
  "sedative",
  "ie-classic",
  "cyberpunk",
] as const;

export type BrowserThemeId = (typeof BROWSER_THEME_IDS)[number];

const BASE_FONT_CATALOG = [
  "Arimo Variable",
  "Tinos",
  "Cousine",
  "Roboto Condensed Variable",
  "Source Sans 3 Variable",
  "Gelasio Variable",
  "Comic Neue",
  "Anton",
  "Archivo Black",
  "Noto Sans Variable",
  "Noto Serif Variable",
  "Noto Sans Mono Variable",
] as const;

interface GenerationExperienceDefinition {
  worldInstruction: string;
  fontInstruction: string;
  fonts: readonly string[];
  compactDescription: string;
}

export const GENERATION_EXPERIENCE_REGISTRY = {
  native: {
    worldInstruction: "",
    fontInstruction: `The artifact runtime has an offline font cabinet. Packaged families include Arimo Variable, Tinos, Cousine, Roboto Condensed Variable, Source Sans 3 Variable, Gelasio Variable, Comic Neue, Anton, Archivo Black, Noto Sans Variable, Noto Serif Variable, and Noto Sans Mono Variable. Choose freely according to the destination; this inventory does not impose a theme.`,
    fonts: BASE_FONT_CATALOG,
    compactDescription: "site-appropriate, clear, and practical",
  },
  sedative: {
    worldInstruction: `
This browser is tuned to the Quiet Web, a contemporary parallel internet shaped after the attention economy collapsed. Its institutions, publications, shops, communities, transport, culture, and personal spaces feel humane, unhurried, design-literate, and subtly unfamiliar. Technology is advanced but recedes into the background; the world values privacy, repair, slowness, craft, public life, and room to think.
Render every destination as native to this world. Favor calm editorial composition, generous breathing room, soft mineral and paper-like palettes, restrained typography, tactile surfaces, gentle curves, considered photography, and low-stimulation interactions. Keep each site's identity and authentic page structure: a forum must still feel like a forum, a timetable like a timetable, and a dense archive may remain dense. Do not flatten everything into an empty wellness landing page, pastel cards, generic affirmations, or luxury branding.
The embedded type cabinet includes the classic Web 2.0 vocabulary: Helvetica Neue, Lucida Grande, Helvetica, Geneva, Monaco, Myriad, and Myriad Pro, backed by packaged multilingual substitutes. Use it when a destination calls for that era; quieter editorial faces remain welcome when they fit better.
Write with quiet specificity. Reveal the alternate world's customs and history through ordinary notices, schedules, products, bylines, civic services, conversations, and small details rather than exposition. Avoid urgency theater, engagement bait, aggressive ads, neon, cyberpunk motifs, corporate dashboards, and breathless marketing.
    `.trim(),
    fontInstruction: `For a classic Web 2.0 voice, the runtime registers Helvetica Neue, Lucida Grande, Helvetica, Geneva, Monaco, Myriad, and Myriad Pro directly. Source Sans 3 Variable backs the sans aliases and Cousine backs Monaco. Use the historical family name first, then var(--vibe-font-global-sans), var(--vibe-font-global-serif), or var(--vibe-font-global-mono) when mixed scripts need wider coverage.`,
    fonts: [...BASE_FONT_CATALOG, "Helvetica Neue", "Lucida Grande", "Helvetica", "Geneva", "Monaco", "Myriad", "Myriad Pro"],
    compactDescription: "calm, low-stimulation editorial web",
  },
  "ie-classic": {
    worldInstruction: `
This browser reaches an alternate World Wide Web frozen in the living Web 1.0 era, roughly 1997-2003. The world beyond the screen may contain impossible science, different governments, strange species, future history, or any other lore implied by the URL, but every site is published with the technology, conventions, optimism, clutter, and homemade character of that era. If a recognizable service postdates the era, invent its plausible portal, directory, fan page, university mirror, or early predecessor rather than using a modern interface.
Render fixed-width and table-like layouts, frames-inspired columns without actual frames, tiled or textured backgrounds, Times/Arial/Verdana/Tahoma typography, blue and visited links, small beveled controls, dense navigation, badges, tiny icons, horizontal rules, sidebars, webrings, counters, guestbooks, under-construction corners, and compact portal modules where appropriate. Imperfect alignment, loud colors, amateur graphics, institutional pages, and text-heavy directories are welcome. Do not use modern app shells, glassmorphism, large SaaS heroes, card grids, pill buttons, contemporary dashboards, or mobile-first product polish.
The embedded type cabinet exposes Tahoma, Verdana, MS Sans Serif, MS Serif, Trebuchet MS, Arial Narrow, Lucida Sans Unicode, Georgia, Courier New, Comic Sans MS, Impact, Arial, Arial Black, and Times New Roman as offline compatibility aliases with multilingual packaged fallbacks. Use those exact CSS family names deliberately, as contemporary authors of each site would have done.
Make the alternate world feel archived yet alive: use dated updates, webmaster notes, mirror links, forum handles, directory categories, affiliations, awards, and local lore. Stay in-world and never call the page retro, nostalgic, simulated, generated, or a recreation.
    `.trim(),
    fontInstruction: `The runtime directly registers these offline compatibility aliases: Tahoma; Verdana; MS Sans Serif; MS Serif; Trebuchet MS; Arial Narrow; Lucida Sans Unicode; Georgia; Courier New; Comic Sans MS; Impact; Arial; Arial Black; Times New Roman. They use local originals when present and packaged open substitutes otherwise. Use the names in CSS exactly as written and choose them by period-appropriate role rather than at random. For mixed-script pages append var(--vibe-font-global-sans), var(--vibe-font-global-serif), or var(--vibe-font-global-mono).`,
    fonts: [...BASE_FONT_CATALOG, "Tahoma", "Verdana", "MS Sans Serif", "MS Serif", "Trebuchet MS", "Arial Narrow", "Lucida Sans Unicode", "Georgia", "Courier New", "Comic Sans MS", "Impact", "Arial", "Arial Black", "Times New Roman"],
    compactDescription: "compact 1997-2003 web with simple controls",
  },
  cyberpunk: {
    worldInstruction: `
This browser is connected to the Consensus Net of a near-future cyberpunk world. Megacorporations, municipal AIs, synthetic citizens, orbital infrastructure, private security, street clinics, pirate relays, reputation markets, surveillance systems, and underground communities are ordinary parts of life. Every hostname is a real node in this contested network; reveal its power structures and lived history through specific data, people, districts, contracts, alerts, rumors, and access boundaries.
Render destinations with dense information layers, black and deep navy surfaces, emissive cyan, toxic green, magenta or amber accents, sharp geometry, monospace and condensed typography, terminal traces, technical labels, grids, scan lines, status lights, maps, diagnostics, warnings, IDs, timestamps, and controlled glitch details when suitable. Corporate nodes should feel polished and coercive; civic systems bureaucratic and surveilled; underground sites improvised, encrypted, and culturally distinct. Preserve the authentic function of the page instead of turning every destination into the same hacker terminal.
The embedded type cabinet includes Noto Sans Mono Variable, Cousine, Monaco, Roboto Condensed Variable, Source Sans 3 Variable, Anton, and broad multilingual Noto fallbacks. Choose condensed, mono, technical, or corporate typography according to the node instead of applying one terminal font everywhere.
Avoid soft rounded SaaS cards, friendly startup copy, generic neon city wallpaper, decorative code gibberish, and empty dystopian slogans. The lore must emerge from useful interfaces and concrete content. Never explain that the world is fictional, themed, generated, or viewed through a special browser.
    `.trim(),
    fontInstruction: `Packaged technical families include Noto Sans Mono Variable, Cousine, Monaco, Roboto Condensed Variable, Source Sans 3 Variable, Anton, and Archivo Black. Use var(--vibe-font-global-mono) or var(--vibe-font-global-sans) for multilingual interfaces. Do not make every destination monospace.`,
    fonts: [...BASE_FONT_CATALOG, "Monaco"],
    compactDescription: "dense dark near-future network interface",
  },
} as const satisfies Record<BrowserThemeId, GenerationExperienceDefinition>;
