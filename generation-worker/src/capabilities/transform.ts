import { Buffer } from "node:buffer";

import { parseFragment } from "parse5";

import type { ArtifactWarning } from "../domain.js";
import {
  elements,
  firstElement,
  getAttribute,
  removeAttribute,
  removeNode,
  setAttribute,
  type DocumentNode,
  type ElementNode,
  type Node,
} from "../html/tree.js";
import {
  CAPABILITY_REGISTRY,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MOTIONS,
  VIDEO_MUSIC_TRACKS,
  VIDEO_SCENE_KINDS,
  VIDEO_TRANSITIONS,
  hasVerifiedExternalMediaConnection,
  resolveCapabilities,
} from "./registry.js";
import { renderMermaidIsolated } from "./renderer-process.js";
import type { ArtifactCapabilityUse, CapabilityId } from "./types.js";
import type { BrowserTheme, GenerationSettings } from "../domain.js";

const MAX_HEAVY_INSTANCES = 8;
const MAX_RENDERED_BYTES = 256 * 1024;
const MAX_SPEC_CHARS = 96 * 1024;
const MAX_MERMAID_CHARS = 24 * 1024;
const MAX_CODE_CHARS = 64 * 1024;
const MAX_MATH_CHARS = 4 * 1024;
const SAFE_CODE_LANGUAGES = new Set([
  "text", "plaintext", "html", "css", "javascript", "js", "typescript", "ts",
  "json", "bash", "shell", "rust", "python", "markdown", "md", "sql",
]);

const STATIC_ELEMENT_CAPABILITIES: Readonly<Record<string, CapabilityId>> = {
  "vibe-chart": "data-chart",
  "vibe-diagram": "diagram",
  "vibe-qr": "qr-code",
  "vibe-avatar": "avatar",
  "vibe-map": "synthetic-map",
  "vibe-video": "pseudo-video",
};

export interface CompileCapabilitiesInput {
  document: DocumentNode;
  pageUrl?: string;
  settings: GenerationSettings;
  browserTheme: BrowserTheme;
  selectedCapabilities: readonly CapabilityId[];
  preview: boolean;
  signal?: AbortSignal;
}

export interface CompileCapabilitiesResult {
  manifest: ArtifactCapabilityUse[];
  warnings: ArtifactWarning[];
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Capability compilation was cancelled.");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function compactText(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function nodeText(node: Node | { childNodes: Node[] }): string {
  let result = "";
  const visit = (candidate: Node | { childNodes: Node[] }) => {
    if ("nodeName" in candidate && candidate.nodeName === "#text" && "value" in candidate) {
      result += candidate.value;
    }
    if ("childNodes" in candidate) candidate.childNodes.forEach(visit);
    if ("content" in candidate && candidate.content && typeof candidate.content === "object") {
      visit(candidate.content as { childNodes: Node[] });
    }
  };
  visit(node);
  return result;
}

function childElement(element: ElementNode, tagName: string): ElementNode | undefined {
  return element.childNodes.find((node): node is ElementNode => "tagName" in node && node.tagName === tagName);
}

function templateSource(element: ElementNode): string {
  const template = childElement(element, "template");
  return template ? nodeText(template).trim() : "";
}

function captionText(element: ElementNode): string {
  const caption = childElement(element, "figcaption");
  return caption ? compactText(nodeText(caption), 1_000) : "";
}

function replaceChildren(element: ElementNode, markup: string): void {
  const fragment = parseFragment(element, markup, {});
  element.childNodes = fragment.childNodes;
  for (const child of element.childNodes) child.parentNode = element;
}

function replaceAsFigure(element: ElementNode, capability: CapabilityId, markup: string, caption: string): void {
  element.nodeName = "figure";
  element.tagName = "figure";
  element.attrs = element.attrs.filter(({ name }) => name === "id" || name === "class" || name === "style"
    || name === "title" || name === "role" || name.startsWith("aria-"));
  setAttribute(element, "data-vibe-capability", capability);
  replaceChildren(element, `${markup}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}`);
}

function replaceFailure(element: ElementNode, capability: CapabilityId, caption: string): void {
  const label = caption || `${capability.replaceAll("-", " ")} unavailable`;
  replaceAsFigure(element, capability, `<div data-vibe-capability-fallback role="img">${escapeHtml(label)}</div>`, "");
}

function sanitizeSvg(svg: string): string {
  let sanitized = svg
    .replace(/<\/?(?:script|foreignObject|iframe|object|embed|image|a)\b[^>]*>/gi, "")
    .replace(/\s(?:on[a-z]+|href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/url\(\s*["']?(?!#)[^)]+\)/gi, "none");
  if (!/^\s*<svg\b/i.test(sanitized)) throw new Error("Renderer did not return SVG.");
  if (Buffer.byteLength(sanitized, "utf8") > MAX_RENDERED_BYTES) {
    throw new Error("Rendered SVG exceeds the per-capability size budget.");
  }
  sanitized = sanitized.replace(/<svg\b/i, '<svg data-vibe-rendered="true" focusable="false"');
  return sanitized;
}

function assertBoundedJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("Capability JSON is too deeply nested.");
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error("Capability JSON array exceeds 200 entries.");
    value.forEach((item) => assertBoundedJson(item, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /(?:https?:|data:|javascript:|file:)/i.test(value)) {
      throw new Error("Capability JSON may not contain external or executable URLs.");
    }
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 80) throw new Error("Capability JSON object has too many properties.");
  for (const [key, item] of entries) {
    if (["url", "href", "src", "usermeta"].includes(key.toLowerCase())) {
      throw new Error(`Capability JSON property is forbidden: ${key}`);
    }
    assertBoundedJson(item, depth + 1);
  }
}

async function renderChart(source: string): Promise<string> {
  if (!source || source.length > MAX_SPEC_CHARS) throw new Error("Vega-Lite specification is missing or too large.");
  const specification = JSON.parse(source) as Record<string, unknown>;
  assertBoundedJson(specification);
  delete specification.$schema;
  const [{ parse: parseVega, View }, { compile: compileVegaLite }] = await Promise.all([
    import("vega"),
    import("vega-lite"),
  ]);
  const compiled = compileVegaLite(specification as never, { config: { background: "transparent" } });
  const view = new View(parseVega(compiled.spec), { renderer: "none" });
  try {
    return sanitizeSvg(await view.toSVG());
  } finally {
    view.finalize();
  }
}

async function renderDiagram(source: string, signal?: AbortSignal): Promise<string> {
  if (!source || source.length > MAX_MERMAID_CHARS) throw new Error("Mermaid source is missing or too large.");
  if (/\b(?:click|href|linkStyle)\b|https?:|javascript:|data:/i.test(source)) {
    throw new Error("Mermaid links and click directives are forbidden.");
  }
  return sanitizeSvg(await renderMermaidIsolated(source, signal));
}

async function mathMarkup(element: ElementNode): Promise<string> {
  const source = nodeText(element).trim();
  if (!source || source.length > MAX_MATH_CHARS) throw new Error("Math source is missing or too large.");
  const { default: katex } = await import("katex");
  return katex.renderToString(source, {
    displayMode: getAttribute(element, "data-display") === "block",
    output: "mathml",
    throwOnError: true,
    strict: "error",
    trust: false,
  });
}

async function highlightedCode(element: ElementNode): Promise<string> {
  const requestedLanguage = (getAttribute(element, "data-vibe-code") ?? "text").toLowerCase();
  const language = SAFE_CODE_LANGUAGES.has(requestedLanguage) ? requestedLanguage : "text";
  const source = nodeText(element);
  if (source.length > MAX_CODE_CHARS) throw new Error("Code block exceeds the highlighting budget.");
  const { codeToHtml } = await import("shiki");
  return codeToHtml(source, { lang: language, theme: "github-dark" });
}

async function avatarSvg(element: ElementNode): Promise<string> {
  const [{ botttsNeutral, initials, personas, shapes }, { createAvatar }] = await Promise.all([
    import("@dicebear/collection"),
    import("@dicebear/core"),
  ]);
  const seed = compactText(getAttribute(element, "data-seed") ?? getAttribute(element, "aria-label") ?? "visitor", 160) || "visitor";
  const style = getAttribute(element, "data-style") ?? "initials";
  const options = { seed, backgroundType: ["solid"] as ["solid"] };
  if (style === "shapes") return sanitizeSvg(createAvatar(shapes, options).toString());
  if (style === "personas") return sanitizeSvg(createAvatar(personas, options).toString());
  if (style === "bottts") return sanitizeSvg(createAvatar(botttsNeutral, options).toString());
  return sanitizeSvg(createAvatar(initials, options).toString());
}

function mapSvg(source: string, label: string): string {
  if (!source || source.length > MAX_SPEC_CHARS) throw new Error("Synthetic map specification is missing or too large.");
  const value = JSON.parse(source) as { places?: unknown; routes?: unknown };
  assertBoundedJson(value);
  const places = Array.isArray(value.places) ? value.places.slice(0, 24).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.name !== "string" || typeof candidate.x !== "number" || typeof candidate.y !== "number") return [];
    return [{ name: compactText(candidate.name, 80), x: Math.max(0, Math.min(100, candidate.x)), y: Math.max(0, Math.min(100, candidate.y)) }];
  }) : [];
  if (places.length === 0) throw new Error("Synthetic map requires at least one valid place.");
  const routes = Array.isArray(value.routes) ? value.routes.slice(0, 32).flatMap((route) => {
    if (!Array.isArray(route) || route.length < 2) return [];
    const indexes = route.map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < places.length);
    return indexes.length >= 2 ? [indexes] : [];
  }) : [];
  const routeMarkup = routes.map((route) => `<polyline points="${route.map((index) => `${places[index]!.x * 8},${places[index]!.y * 5}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".62"/>`).join("");
  const placeMarkup = places.map((place, index) => `<g transform="translate(${place.x * 8} ${place.y * 5})"><circle r="${index === 0 ? 8 : 6}" fill="currentColor"/><text x="10" y="4" fill="currentColor" font-size="14">${escapeHtml(place.name)}</text></g>`).join("");
  return `<svg data-vibe-rendered="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label="${escapeHtml(label)}"><path d="M0 70C130 10 260 120 400 55S690 5 800 90M0 390C180 300 250 470 430 390S650 330 800 420" fill="none" stroke="currentColor" stroke-width="2" opacity=".16"/><g>${routeMarkup}${placeMarkup}</g></svg>`;
}

function injectPatternStyles(document: DocumentNode): void {
  const head = firstElement(document, "head");
  if (!head) return;
  const style = `<style data-vibesurfer-capability="pattern-background">
[data-vibe-pattern]{--vibe-pattern-color:currentColor;--vibe-pattern-size:24px;background-position:0 0}
[data-vibe-pattern="dots"]{background-image:radial-gradient(circle,var(--vibe-pattern-color) 1px,transparent 1.5px);background-size:var(--vibe-pattern-size) var(--vibe-pattern-size)}
[data-vibe-pattern="grid"]{background-image:linear-gradient(var(--vibe-pattern-color) 1px,transparent 1px),linear-gradient(90deg,var(--vibe-pattern-color) 1px,transparent 1px);background-size:var(--vibe-pattern-size) var(--vibe-pattern-size)}
[data-vibe-pattern="diagonal"]{background-image:repeating-linear-gradient(135deg,transparent 0 calc(var(--vibe-pattern-size)*.4),var(--vibe-pattern-color) calc(var(--vibe-pattern-size)*.4) calc(var(--vibe-pattern-size)*.45))}
[data-vibe-pattern="cross"]{background-image:linear-gradient(var(--vibe-pattern-color) 1px,transparent 1px),linear-gradient(90deg,var(--vibe-pattern-color) 1px,transparent 1px);background-size:var(--vibe-pattern-size) var(--vibe-pattern-size);background-position:center}
[data-vibe-pattern="waves"]{background-image:radial-gradient(ellipse at center bottom,transparent 55%,var(--vibe-pattern-color) 57%,transparent 60%);background-size:var(--vibe-pattern-size) calc(var(--vibe-pattern-size)*.6)}
[data-vibe-pattern="paper"]{background-image:linear-gradient(90deg,color-mix(in srgb,var(--vibe-pattern-color) 8%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--vibe-pattern-color) 6%,transparent) 1px,transparent 1px);background-size:7px 9px}
</style>`;
  const fragment = parseFragment(head, style, {});
  for (const child of fragment.childNodes) {
    child.parentNode = head;
    head.childNodes.push(child);
  }
}

function countRuntimeMarkers(document: DocumentNode, capability: CapabilityId): number {
  const all = elements(document);
  switch (capability) {
    case "semantic-navigation": return all.filter((element) => element.tagName === "a" || element.tagName === "form").length;
    case "tailwind-utilities": return all.some((element) => Boolean(getAttribute(element, "class"))) ? 1 : 0;
    case "inline-page-css": return elements(document, "style").length;
    case "image-intents": return elements(document, "img").length;
    case "local-dom-scripts": return elements(document, "script").filter((element) => !getAttribute(element, "src")).length;
    case "pattern-background": return all.filter((element) => getAttribute(element, "data-vibe-pattern")).length;
    case "motion-presets": return all.filter((element) => getAttribute(element, "data-vibe-motion")).length;
    case "micro-widgets": return all.filter((element) => getAttribute(element, "data-vibe-widget")).length;
    case "carousel": return all.filter((element) => getAttribute(element, "data-vibe-carousel") !== undefined).length;
    case "slideshow": return all.filter((element) => getAttribute(element, "data-vibe-slideshow") !== undefined).length;
    case "pseudo-video": return all.filter((element) => element.tagName === "vibe-video" || getAttribute(element, "data-vibe-pseudo-video") !== undefined).length;
    case "speech": return all.filter((element) => getAttribute(element, "data-vibe-speak") !== undefined).length;
    case "sound": return all.filter((element) => getAttribute(element, "data-vibe-sound") !== undefined).length;
    case "dynamic-regions": return all.filter((element) => getAttribute(element, "data-vibe-region") !== undefined).length;
    default: return 0;
  }
}

function enforceCapabilityBudgets(document: DocumentNode, selected: ReadonlySet<CapabilityId>): ArtifactWarning[] {
  const warnings: ArtifactWarning[] = [];
  const warn = (id: CapabilityId, maximum: number) => warnings.push({
    code: `${id}-capped`,
    message: `Only the first ${maximum} ${id} instances were kept; excess markers were disabled.`,
  });
  const capAttribute = (id: CapabilityId, attribute: string) => {
    if (!selected.has(id)) return;
    const maximum = CAPABILITY_REGISTRY.get(id)?.maxInstances ?? 0;
    const matches = elements(document).filter((element) => getAttribute(element, attribute) !== undefined);
    if (matches.length <= maximum) return;
    for (const element of matches.slice(maximum)) removeAttribute(element, attribute);
    warn(id, maximum);
  };

  const styles = elements(document, "style");
  const styleMaximum = CAPABILITY_REGISTRY.get("inline-page-css")?.maxInstances ?? 1;
  if (styles.length > styleMaximum) {
    for (const style of styles.slice(styleMaximum)) removeNode(style);
    warn("inline-page-css", styleMaximum);
  }

  const scripts = elements(document, "script");
  const scriptMaximum = CAPABILITY_REGISTRY.get("local-dom-scripts")?.maxInstances ?? 0;
  if (!selected.has("local-dom-scripts")) {
    for (const script of scripts) removeNode(script);
  } else if (scripts.length > scriptMaximum) {
    for (const script of scripts.slice(scriptMaximum)) removeNode(script);
    warn("local-dom-scripts", scriptMaximum);
  }

  if (selected.has("pattern-background")) {
    const patterns = elements(document).filter((element) => getAttribute(element, "data-vibe-pattern") !== undefined);
    const fullPage = patterns.find((element) => element.tagName === "html" || element.tagName === "body");
    const family = fullPage
      ? getAttribute(fullPage, "data-vibe-pattern")
      : patterns[0] ? getAttribute(patterns[0], "data-vibe-pattern") : undefined;
    let kept = 0;
    for (const element of patterns) {
      const sameFamily = getAttribute(element, "data-vibe-pattern") === family;
      const allowed = sameFamily && kept < 2 && (!fullPage || element === fullPage);
      if (allowed) kept += 1;
      else removeAttribute(element, "data-vibe-pattern");
    }
    if (kept < patterns.length) warn("pattern-background", fullPage ? 1 : 2);
  }
  capAttribute("motion-presets", "data-vibe-motion");
  capAttribute("math", "data-vibe-math");
  capAttribute("code-highlight", "data-vibe-code");
  capAttribute("micro-widgets", "data-vibe-widget");
  capAttribute("carousel", "data-vibe-carousel");
  capAttribute("slideshow", "data-vibe-slideshow");
  capAttribute("pseudo-video", "data-vibe-pseudo-video");
  capAttribute("speech", "data-vibe-speak");
  capAttribute("sound", "data-vibe-sound");

  for (const [tagName, id] of [["vibe-qr", "qr-code"], ["vibe-avatar", "avatar"], ["vibe-map", "synthetic-map"]] as const) {
    if (!selected.has(id)) continue;
    const maximum = CAPABILITY_REGISTRY.get(id)?.maxInstances ?? 0;
    const matches = elements(document, tagName);
    if (matches.length <= maximum) continue;
    for (const element of matches.slice(maximum)) replaceFailure(element, id, captionText(element));
    warn(id, maximum);
  }
  return warnings;
}

const VIDEO_SCENE_KIND_SET = new Set<string>(VIDEO_SCENE_KINDS);
const VIDEO_TRANSITION_SET = new Set<string>(VIDEO_TRANSITIONS);
const VIDEO_MOTION_SET = new Set<string>(VIDEO_MOTIONS);
const VIDEO_MUSIC_TRACK_SET = new Set<string>([...VIDEO_MUSIC_TRACKS, "inherit", "silence"]);
const VIDEO_CONTROL_ACTION_SET = new Set(["play", "pause", "toggle", "stop", "mute", "skip-music"]);
const VIDEO_TIME_ROLE_SET = new Set(["current", "duration", "combined"]);
const VIDEO_VISIBLE_STATE_SET = new Set(["idle", "preparing", "ready", "playing", "paused", "waiting", "ended", "error", "not-playing", "muted", "unmuted"]);
const UNSAFE_MEDIA_VALUE = /(?:https?:|data:|blob:|file:|javascript:)/i;
const SAFE_MEDIA_IDENTIFIER = /^[A-Za-z0-9_-]{1,160}$/;
const LEGACY_VIDEO_MUSIC: Readonly<Record<string, string>> = {
  "calm-documentary": "documentary-pulse",
  "warm-memory": "warm-memory",
  melancholy: "minimal-piano",
  "investigative-tension": "investigative-low",
  danger: "soft-suspense",
  resolution: "resolution-rise",
  silence: "silence",
};

function isWithin(element: ElementNode, container: ElementNode): boolean {
  let candidate: Node | undefined = element;
  while (candidate && "parentNode" in candidate) {
    if (candidate === container) return true;
    candidate = candidate.parentNode as Node | undefined;
  }
  return candidate === container;
}

function boundedInteger(value: string | undefined, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function inferredVideoAspectRatio(pageUrl?: string): string {
  try {
    const url = new URL(pageUrl ?? "https://video.invalid/");
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")
        || (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") && path.startsWith("/shorts/")
        || (host === "instagram.com" || host.endsWith(".instagram.com")) && (path.startsWith("/reel/") || path.startsWith("/reels/"))) return "9:16";
  } catch { /* malformed source URLs already fail at the outer transform boundary */ }
  return "16:9";
}

function directElementChildren(element: ElementNode): ElementNode[] {
  return element.childNodes.filter((node): node is ElementNode => "tagName" in node);
}

function normalizeAuthoredVideoControls(document: DocumentNode, video: ElementNode): void {
  const descendants = elements(document).filter((element) => element !== video && isWithin(element, video));
  const groups = directElementChildren(video).filter((element) => {
    if (getAttribute(element, "data-vibe-scene") !== undefined || getAttribute(element, "data-vibe-video-scene") !== undefined) return false;
    return getAttribute(element, "data-vibe-video-controls") !== undefined
      || descendants.some((control) => control !== element && isWithin(control, element)
        && (getAttribute(control, "data-vibe-video-action") !== undefined
          || getAttribute(control, "data-vibe-video-play") !== undefined
          || getAttribute(control, "data-vibe-video-restart") !== undefined
          || getAttribute(control, "data-vibe-video-seek") !== undefined
          || getAttribute(control, "data-vibe-video-volume") !== undefined
          || getAttribute(control, "data-vibe-video-time") !== undefined));
  });

  for (const group of groups) {
    setAttribute(group, "data-vibe-video-controls", "");
    const controls = descendants.filter((element) => isWithin(element, group));
    for (const legacy of controls.filter((element) => getAttribute(element, "data-vibe-video-play") !== undefined)) {
      if (getAttribute(legacy, "data-vibe-video-action") === undefined) setAttribute(legacy, "data-vibe-video-action", "toggle");
    }
    for (const legacy of controls.filter((element) => getAttribute(element, "data-vibe-video-restart") !== undefined)) {
      if (getAttribute(legacy, "data-vibe-video-action") === undefined) setAttribute(legacy, "data-vibe-video-action", "stop");
    }
    const play = controls.filter((element) => getAttribute(element, "data-vibe-video-action") === "play");
    const hasPauseOrToggle = controls.some((element) => ["pause", "toggle"].includes(getAttribute(element, "data-vibe-video-action") ?? ""));
    if (play.length === 1 && !hasPauseOrToggle) setAttribute(play[0]!, "data-vibe-video-action", "toggle");

    if (!controls.some((element) => getAttribute(element, "data-vibe-video-time") !== undefined)) {
      const staticTime = controls.find((element) => directElementChildren(element).length === 0
        && /^\s*\d{1,3}:\d{2}\s*\/\s*(?:\d{1,3}:\d{2}|--:--)\s*$/.test(nodeText(element)));
      if (staticTime) {
        setAttribute(staticTime, "data-vibe-video-time", "combined");
        replaceChildren(staticTime, "0:00 / --:--");
      }
    }

    if (!controls.some((element) => getAttribute(element, "data-vibe-video-seek") !== undefined)) {
      const visualSeek = controls.find((element) => {
        const hint = `${getAttribute(element, "class") ?? ""} ${getAttribute(element, "role") ?? ""}`;
        return /(?:^|[\s_-])(?:progress|timeline|seek|scrub)(?:$|[\s_-])/i.test(hint)
          && getAttribute(element, "data-vibe-video-time") === undefined;
      });
      if (visualSeek) {
        setAttribute(visualSeek, "data-vibe-video-seek", "");
        setAttribute(visualSeek, "role", "slider");
        setAttribute(visualSeek, "tabindex", "0");
        removeAttribute(visualSeek, "aria-hidden");
        const fill = directElementChildren(visualSeek)[0];
        if (fill) setAttribute(fill, "data-vibe-video-progress-fill", "");
      }
    }
  }
}

function sanitizePseudoVideo(document: DocumentNode, selected: ReadonlySet<CapabilityId>, settings: GenerationSettings, pageUrl?: string): ArtifactWarning[] {
  if (!selected.has("pseudo-video")) return [];
  const warnings: ArtifactWarning[] = [];
  const videos = elements(document).filter((element) => element.tagName === "vibe-video" || getAttribute(element, "data-vibe-pseudo-video") !== undefined);
  for (const extra of videos.slice(1)) replaceFailure(extra, "pseudo-video", compactText(nodeText(extra), 1_000));
  for (const video of videos.slice(0, 1)) {
    if (video.tagName !== "vibe-video") {
      video.nodeName = "vibe-video";
      video.tagName = "vibe-video";
      removeAttribute(video, "data-vibe-pseudo-video");
      setAttribute(video, "data-vibe-legacy", "");
    }
    const videoIdCandidate = compactText(getAttribute(video, "id") ?? "", 160);
    const videoId = SAFE_MEDIA_IDENTIFIER.test(videoIdCandidate) ? videoIdCandidate : "vibe-video-1";
    setAttribute(video, "id", videoId);
    const pacing = getAttribute(video, "data-pacing");
    setAttribute(video, "data-pacing", pacing === "slow" || pacing === "fast" ? pacing : "balanced");
    const requestedAspectRatio = getAttribute(video, "data-aspect-ratio") ?? getAttribute(video, "data-video-aspect-ratio");
    setAttribute(video, "data-aspect-ratio", VIDEO_ASPECT_RATIOS.includes(requestedAspectRatio as typeof VIDEO_ASPECT_RATIOS[number])
      ? requestedAspectRatio!
      : inferredVideoAspectRatio(pageUrl));
    removeAttribute(video, "data-video-aspect-ratio");
    const musicIntent = compactText(getAttribute(video, "data-music-intent") ?? "", 160);
    if (musicIntent && !UNSAFE_MEDIA_VALUE.test(musicIntent) && settings.capabilities.externalMediaEnabled
        && hasVerifiedExternalMediaConnection(settings) && settings.voice.musicMode === "generate-if-requested") setAttribute(video, "data-music-intent", musicIntent);
    else removeAttribute(video, "data-music-intent");

    normalizeAuthoredVideoControls(document, video);

    for (const control of elements(document).filter((element) => isWithin(element, video))) {
      removeAttribute(control, "autoplay");
      for (const attribute of [...control.attrs]) {
        if (/(?:midi|audio-url|voice-url|music-url|music-src)/i.test(attribute.name)) removeAttribute(control, attribute.name);
      }
      const action = getAttribute(control, "data-vibe-video-action");
      if (action === "fullscreen" || getAttribute(control, "data-vibe-video-fullscreen") !== undefined) {
        removeNode(control);
        continue;
      }
      if (action !== undefined && !VIDEO_CONTROL_ACTION_SET.has(action)) removeAttribute(control, "data-vibe-video-action");
      const timeRole = getAttribute(control, "data-vibe-video-time");
      if (timeRole !== undefined && !VIDEO_TIME_ROLE_SET.has(timeRole)) removeAttribute(control, "data-vibe-video-time");
      const visibleWhen = getAttribute(control, "data-vibe-video-visible-when");
      if (visibleWhen !== undefined) {
        const states = visibleWhen.split(/[\s,|]+/).filter((state) => VIDEO_VISIBLE_STATE_SET.has(state));
        if (states.length) setAttribute(control, "data-vibe-video-visible-when", states.join(" "));
        else removeAttribute(control, "data-vibe-video-visible-when");
      }
    }

    const scenes = elements(document).filter((element) => (getAttribute(element, "data-vibe-scene") !== undefined
      || getAttribute(element, "data-vibe-video-scene") !== undefined) && isWithin(element, video));
    for (const mediaElement of elements(document).filter((element) => ["audio", "video", "source", "track", "script"].includes(element.tagName) && isWithin(element, video))) {
      removeNode(mediaElement);
      warnings.push({ code: "pseudo-video-media-url-removed", message: "Pseudo-video media and behavior must use trusted declarative voice, music and control identifiers." });
    }
    let total = 0;
    let removed = 0;
    const sceneIds = new Set<string>();
    for (const [index, scene] of scenes.entries()) {
      if (index >= 12 || total >= 600_000) {
        removeNode(scene);
        removed += 1;
        continue;
      }
      setAttribute(scene, "data-vibe-scene", "");
      removeAttribute(scene, "data-vibe-video-scene");
      const sceneIdCandidate = compactText(getAttribute(scene, "id") ?? "", 160);
      let sceneId = SAFE_MEDIA_IDENTIFIER.test(sceneIdCandidate) && !sceneIds.has(sceneIdCandidate)
        ? sceneIdCandidate
        : `${videoId}-scene-${index + 1}`;
      for (let suffix = 2; sceneIds.has(sceneId); suffix += 1) sceneId = `${videoId}-scene-${index + 1}-${suffix}`;
      setAttribute(scene, "id", sceneId);
      sceneIds.add(sceneId);
      const kindCandidate = getAttribute(scene, "data-kind") ?? (elements(document, "img").some((image) => isWithin(image, scene)) ? "image" : "text");
      const kind = VIDEO_SCENE_KIND_SET.has(kindCandidate) ? kindCandidate : "text";
      const transitionCandidate = getAttribute(scene, "data-transition") ?? "crossfade";
      const motionCandidate = getAttribute(scene, "data-motion") ?? "still";
      setAttribute(scene, "data-kind", kind);
      setAttribute(scene, "data-transition", VIDEO_TRANSITION_SET.has(transitionCandidate) ? transitionCandidate : "crossfade");
      setAttribute(scene, "data-motion", VIDEO_MOTION_SET.has(motionCandidate) ? motionCandidate : "still");
      const durationFallback = kind === "title" ? 2_500 : kind === "credits" ? 6_000 : 4_000;
      const hasDuration = getAttribute(scene, "data-duration-ms") !== undefined;
      const duration = Math.min(boundedInteger(getAttribute(scene, "data-duration-ms"), 1_000, 120_000, durationFallback), 600_000 - total);
      if (duration < 1_000) {
        removeNode(scene);
        removed += 1;
        continue;
      }
      if (hasDuration) setAttribute(scene, "data-duration-ms", String(duration));
      total += duration;

      const narrations = elements(document).filter((element) => getAttribute(element, "data-vibe-narration") !== undefined && isWithin(element, scene));
      for (const cue of narrations.slice(1)) removeNode(cue);
      const narration = narrations[0];
      if (narration && settings.capabilities.audioSpeechEnabled) {
        const text = compactText(nodeText(narration), 800);
        if (text) replaceChildren(narration, escapeHtml(text));
        else removeNode(narration);
        const voiceId = getAttribute(narration, "data-voice");
        const allowedVoices = new Set(settings.voice.engine === "cloud" && settings.voice.availableVoiceIds.length
          ? settings.voice.availableVoiceIds
          : [settings.voice.voice]);
        if (voiceId && !allowedVoices.has(voiceId)) removeAttribute(narration, "data-voice");
        const lang = compactText(getAttribute(narration, "lang") ?? "", 24);
        if (lang && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang)) setAttribute(narration, "lang", lang);
        else removeAttribute(narration, "lang");
        removeAttribute(narration, "data-at-ms");
        removeAttribute(narration, "data-pause-after-ms");
      } else if (narration) {
        // Narration is also author-visible scene copy. Disabling synthesized
        // speech must not erase that content from the compiled artifact; only
        // remove the trusted-runtime marker and voice metadata.
        removeAttribute(narration, "data-vibe-narration");
        removeAttribute(narration, "data-voice");
        removeAttribute(narration, "data-at-ms");
        removeAttribute(narration, "data-pause-after-ms");
      }

      const legacyMusic = elements(document).find((element) => getAttribute(element, "data-vibe-music") !== undefined && isWithin(element, scene));
      const legacyPreset = (legacyMusic ? getAttribute(legacyMusic, "data-preset") : undefined) ?? getAttribute(scene, "data-music-preset");
      const requestedTrack = getAttribute(scene, "data-music-track") ?? (legacyPreset ? LEGACY_VIDEO_MUSIC[legacyPreset] : undefined) ?? (index === 0 ? "silence" : "inherit");
      setAttribute(scene, "data-music-track", settings.voice.musicMode !== "off" && VIDEO_MUSIC_TRACK_SET.has(requestedTrack) ? requestedTrack : "silence");
      if (legacyMusic) removeNode(legacyMusic);
      removeAttribute(scene, "data-music-preset");
      removeAttribute(scene, "data-music-intensity");
    }
    setAttribute(video, "data-vibe-duration-ms", String(total));
    if (removed > 0) warnings.push({ code: "pseudo-video-scenes-capped", message: "Pseudo-video was limited to 12 scenes and 10 minutes." });
  }
  return warnings;
}

function stripUnavailableMarkers(document: DocumentNode, selected: ReadonlySet<CapabilityId>): ArtifactWarning[] {
  const warnings: ArtifactWarning[] = [];
  for (const element of elements(document)) {
    const staticCapability = STATIC_ELEMENT_CAPABILITIES[element.tagName];
    if (staticCapability && !selected.has(staticCapability)) {
      replaceFailure(element, staticCapability, captionText(element));
      warnings.push({ code: "capability-not-selected", message: `${staticCapability} markup was replaced because the Director did not select it.` });
    }
    const attributes: Array<[string, CapabilityId]> = [
      ["data-vibe-pattern", "pattern-background"], ["data-vibe-motion", "motion-presets"],
      ["data-vibe-widget", "micro-widgets"], ["data-vibe-carousel", "carousel"],
      ["data-vibe-slideshow", "slideshow"], ["data-vibe-speak", "speech"], ["data-vibe-sound", "sound"],
      ["data-vibe-pseudo-video", "pseudo-video"],
    ];
    for (const [attribute, capability] of attributes) {
      if (getAttribute(element, attribute) !== undefined && !selected.has(capability)) removeAttribute(element, attribute);
    }
  }
  return warnings;
}

function manifestEntry(id: CapabilityId, instances: number): ArtifactCapabilityUse {
  const descriptor = CAPABILITY_REGISTRY.get(id);
  if (!descriptor) throw new Error(`Capability descriptor is missing: ${id}`);
  return {
    id,
    version: descriptor.version,
    execution: descriptor.execution,
    instances,
    noticeIds: [...descriptor.noticeIds],
  };
}

export async function compileCapabilities(input: CompileCapabilitiesInput): Promise<CompileCapabilitiesResult> {
  const resolved = resolveCapabilities(input.settings, input.browserTheme, input.selectedCapabilities);
  const selected = new Set(resolved.map((capability) => capability.id));
  const warnings = [
    ...stripUnavailableMarkers(input.document, selected),
    ...enforceCapabilityBudgets(input.document, selected),
    ...sanitizePseudoVideo(input.document, selected, input.settings, input.pageUrl),
  ];
  const counts = new Map<CapabilityId, number>();
  let remainingHeavy = MAX_HEAVY_INSTANCES;

  const noteUse = (id: CapabilityId) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const warn = (id: CapabilityId, error: unknown) => warnings.push({
    code: `${id}-render-failed`,
    message: `${id} could not be rendered: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
  });

  if (!input.preview) {
    for (const id of ["semantic-navigation", "tailwind-utilities", "inline-page-css", "image-intents", "local-dom-scripts"] as const) {
      if (!selected.has(id)) continue;
      const instances = countRuntimeMarkers(input.document, id);
      if (instances > 0) counts.set(id, Math.min(instances, CAPABILITY_REGISTRY.get(id)?.maxInstances ?? instances));
    }
  }

  if (selected.has("pattern-background") && countRuntimeMarkers(input.document, "pattern-background") > 0) {
    injectPatternStyles(input.document);
    counts.set("pattern-background", countRuntimeMarkers(input.document, "pattern-background"));
  }

  if (selected.has("data-chart")) {
    for (const element of elements(input.document, "vibe-chart")) {
      const caption = captionText(element);
      if (input.preview) {
        replaceAsFigure(element, "data-chart", `<div data-vibe-capability-preview role="img">${escapeHtml(caption || "Chart")}</div>`, caption);
        continue;
      }
      if (remainingHeavy <= 0) {
        replaceFailure(element, "data-chart", caption);
        warnings.push({ code: "heavy-capability-capped", message: `Only ${MAX_HEAVY_INSTANCES} chart or diagram instances are rendered per artifact.` });
        continue;
      }
      remainingHeavy -= 1;
      try {
        abortIfNeeded(input.signal);
        replaceAsFigure(element, "data-chart", await renderChart(templateSource(element)), caption);
        noteUse("data-chart");
      } catch (error) {
        replaceFailure(element, "data-chart", caption);
        warn("data-chart", error);
      }
    }
  }

  if (selected.has("diagram")) {
    for (const element of elements(input.document, "vibe-diagram")) {
      const caption = captionText(element);
      const source = nodeText(childElement(element, "pre") ?? element).trim().slice(0, MAX_MERMAID_CHARS + 1);
      if (input.preview) {
        replaceAsFigure(element, "diagram", `<div data-vibe-capability-preview role="img">${escapeHtml(caption || "Diagram")}</div>`, caption);
        continue;
      }
      if (remainingHeavy <= 0) {
        replaceFailure(element, "diagram", caption);
        warnings.push({ code: "heavy-capability-capped", message: `Only ${MAX_HEAVY_INSTANCES} chart or diagram instances are rendered per artifact.` });
        continue;
      }
      remainingHeavy -= 1;
      try {
        abortIfNeeded(input.signal);
        const svg = await renderDiagram(source, input.signal);
        replaceAsFigure(element, "diagram", svg, caption);
        noteUse("diagram");
      } catch (error) {
        replaceFailure(element, "diagram", caption);
        warn("diagram", error);
      }
    }
  }

  if (selected.has("math")) {
    for (const element of elements(input.document).filter((candidate) => getAttribute(candidate, "data-vibe-math") !== undefined)) {
      try {
        replaceChildren(element, await mathMarkup(element));
        setAttribute(element, "data-vibe-capability", "math");
        removeAttribute(element, "data-vibe-math");
        noteUse("math");
      } catch (error) {
        removeAttribute(element, "data-vibe-math");
        warn("math", error);
      }
    }
  }

  if (selected.has("code-highlight") && !input.preview) {
    for (const element of elements(input.document, "pre").filter((candidate) => getAttribute(candidate, "data-vibe-code") !== undefined).slice(0, 16)) {
      try {
        const highlighted = await highlightedCode(element);
        element.nodeName = "div";
        element.tagName = "div";
        element.attrs = element.attrs.filter(({ name }) => name === "id" || name === "class" || name === "style"
          || name === "title" || name === "role" || name.startsWith("aria-"));
        setAttribute(element, "data-vibe-highlighted", "");
        replaceChildren(element, highlighted);
        setAttribute(element, "data-vibe-capability", "code-highlight");
        noteUse("code-highlight");
      } catch (error) {
        removeAttribute(element, "data-vibe-code");
        warn("code-highlight", error);
      }
    }
  }

  if (selected.has("qr-code") && !input.preview) {
    for (const element of elements(input.document, "vibe-qr").slice(0, 8)) {
      const value = (getAttribute(element, "data-value") ?? "").slice(0, 2_048);
      try {
        if (!value) throw new Error("QR value is missing.");
        const { default: QRCode } = await import("qrcode");
        const svg = sanitizeSvg(await QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 1 }));
        replaceAsFigure(element, "qr-code", svg, "");
        noteUse("qr-code");
      } catch (error) {
        replaceFailure(element, "qr-code", "QR code unavailable");
        warn("qr-code", error);
      }
    }
  }

  if (selected.has("avatar") && !input.preview) {
    for (const element of elements(input.document, "vibe-avatar").slice(0, 64)) {
      try {
        const svg = await avatarSvg(element);
        element.nodeName = "span";
        element.tagName = "span";
        element.attrs = element.attrs.filter(({ name }) => name === "id" || name === "class" || name === "style" || name.startsWith("aria-"));
        setAttribute(element, "data-vibe-capability", "avatar");
        replaceChildren(element, svg);
        noteUse("avatar");
      } catch (error) {
        replaceFailure(element, "avatar", "Avatar unavailable");
        warn("avatar", error);
      }
    }
  }

  if (selected.has("synthetic-map") && !input.preview) {
    for (const element of elements(input.document, "vibe-map").slice(0, 4)) {
      const caption = captionText(element);
      try {
        const label = (getAttribute(element, "aria-label") ?? caption) || "Schematic map";
        replaceAsFigure(element, "synthetic-map", mapSvg(templateSource(element), label), caption);
        noteUse("synthetic-map");
      } catch (error) {
        replaceFailure(element, "synthetic-map", caption);
        warn("synthetic-map", error);
      }
    }
  }

  for (const id of ["motion-presets", "micro-widgets", "carousel", "slideshow", "pseudo-video", "speech", "sound", "dynamic-regions"] as const) {
    if (!selected.has(id)) continue;
    const instances = countRuntimeMarkers(input.document, id);
    if (instances > 0) counts.set(id, instances);
  }

  for (const template of elements(input.document, "template")) removeNode(template);

  return {
    manifest: [...counts.entries()].map(([id, instances]) => manifestEntry(id, instances)),
    warnings,
  };
}
