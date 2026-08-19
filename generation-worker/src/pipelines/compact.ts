import { createHash } from "node:crypto";

import { compactCapabilityContracts } from "../capabilities/registry.js";
import type { CapabilityId } from "../capabilities/types.js";
import type {
  ApprovedPageBrief,
  FaviconDescriptor,
  PageDirection,
  PageResult,
  RouteHint,
  SiteIdentity,
} from "../domain.js";
import type { PromptBundle } from "../prompt-builder.js";
import { compilePage, createProgressivePagePreview } from "./shared.js";
import { type PipelineContext, type PipelineResult, UnsafeOutputError } from "./types.js";

const DEFAULT_ROUTES: ReadonlyArray<readonly [string, string, string]> = [
  ["/", "Home", "Main overview"],
  ["/topics", "Topics", "Browse topics"],
  ["/guides", "Guides", "Read practical guides"],
  ["/search", "Search", "Search this site"],
  ["/about", "About", "Learn about this site"],
  ["/help", "Help", "Get help"],
  ["/reference", "Reference", "Browse reference material"],
  ["/examples", "Examples", "See worked examples"],
  ["/faq", "FAQ", "Read common questions"],
  ["/resources", "Resources", "Find related resources"],
  ["/glossary", "Glossary", "Look up important terms"],
  ["/next-steps", "Next steps", "Continue from this page"],
  ["/overview", "Overview", "See the subject overview"],
  ["/details", "Details", "Read detailed information"],
  ["/history", "History", "Review background and history"],
  ["/contact", "Contact", "Find contact information"],
];

function hashInt(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function titleCaseHostname(hostname: string): string {
  return hostname
    .replace(/^www\./, "")
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ") || "Offline page";
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = l - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function faviconFor(url: URL, seed: number): FaviconDescriptor {
  const parts = url.hostname.replace(/^www\./, "").split(/[.-]/).filter(Boolean);
  const glyph = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "V";
  return {
    kind: "glyph",
    glyph,
    foreground: "#ffffff",
    background: hslToHex(seed % 360, 68, 40),
    shape: (["circle", "rounded-square", "square"] as const)[seed % 3]!,
  };
}

function routeLabel(path: string): string {
  if (path === "/") return "Home";
  const part = path.split("/").filter(Boolean).at(-1) ?? "Page";
  return part
    .replaceAll(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .slice(0, 120);
}

function routesFromHtml(html: string, url: URL): RouteHint[] {
  const routes: RouteHint[] = [];
  for (const match of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    const raw = match[2]?.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;
    try {
      const candidate = new URL(raw, url);
      if (candidate.origin !== url.origin) continue;
      const path = `${candidate.pathname}${candidate.search}`.slice(0, 512);
      if (!path || routes.some((route) => route.path === path)) continue;
      routes.push({ path, label: routeLabel(candidate.pathname), purpose: `Open ${routeLabel(candidate.pathname)}` });
    } catch {
      // Malformed links are handled by the normal HTML validation pass.
    }
  }
  for (const [path, label, purpose] of DEFAULT_ROUTES) {
    if (!routes.some((route) => route.path === path)) routes.push({ path, label, purpose });
  }
  return routes.slice(0, 20);
}

function ensureDocumentBasics(
  html: string,
  requestUrl: string,
  title: string,
  minimumLinks: number,
  tailwindEnabled: boolean,
): string {
  let document = html;
  const headInsertions: string[] = [];
  if (!/<meta\b[^>]*name=["']viewport["']/i.test(document)) {
    headInsertions.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  }
  if (!/<title\b[^>]*>[\s\S]*?<\/title>/i.test(document)) {
    headInsertions.push(`<title>${escapeHtml(title)}</title>`);
  }
  if (headInsertions.length > 0) {
    if (/<\/head>/i.test(document)) {
      document = document.replace(/<\/head>/i, `${headInsertions.join("")}\n</head>`);
    } else {
      document = document.replace(/<html\b[^>]*>/i, (opening) => `${opening}<head>${headInsertions.join("")}</head>`);
    }
  }

  const url = new URL(requestUrl);
  const existing = new Set<string>();
  for (const match of document.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    try {
      const target = new URL(match[2] ?? "", url);
      if (target.origin === url.origin && match[2] !== "#") existing.add(`${target.pathname}${target.search}`);
    } catch {
      // Invalid links remain visible to the authoritative validator.
    }
  }
  const routeCandidates: Array<readonly [string, string, string]> = [...DEFAULT_ROUTES];
  for (let index = 1; routeCandidates.length < minimumLinks + existing.size; index += 1) {
    routeCandidates.push([`/related/${index}`, `Related ${index}`, "Open related information"]);
  }
  const missing = routeCandidates
    .filter(([path]) => !existing.has(path))
    .slice(0, Math.max(0, minimumLinks - existing.size));
  if (missing.length > 0) {
    const links = missing.map(([path, label, description]) => `<a href="${path}" data-vibe-context="${escapeHtml(description)}">${escapeHtml(label)}</a>`).join(" ");
    const navigation = contextFreeCompactNavigation(links, tailwindEnabled);
    document = /<\/body>/i.test(document)
      ? document.replace(/<\/body>/i, `${navigation}</body>`)
      : document.replace(/<\/html>/i, `${navigation}</html>`);
  }
  return document;
}

function contextFreeCompactNavigation(links: string, tailwindEnabled: boolean): string {
  const utilityClasses = tailwindEnabled ? ' class="flex flex-wrap gap-3 p-4"' : "";
  return `<nav data-vibesurfer-compact-links aria-label="More pages"${utilityClasses} style="display:flex;gap:.75rem;flex-wrap:wrap;padding:1rem">${links}</nav>`;
}

function compactIdentity(context: PipelineContext, html: string): SiteIdentity {
  const existing = context.request.context.identityStrategy === "reuse"
    ? context.request.context.siteWorld?.identity
    : undefined;
  if (existing) return existing;

  const url = new URL(context.request.url);
  const seed = hashInt(url.origin);
  const accent = hslToHex(seed % 360, 68, 40);
  const secondary = hslToHex((seed + 74) % 360, 55, 46);
  const localeSource = `${context.request.worldPromptSnapshot.vibe ?? ""} ${context.request.worldPromptSnapshot.prompt} ${context.request.context.navigationIntent.anchorText}`;
  const locale = /[\u0400-\u04ff]/.test(localeSource) ? "ru-RU" : "en-US";
  const name = titleCaseHostname(url.hostname);
  const recognizableHosts = ["wikipedia.org", "wikihow.com", "google.com", "youtube.com", "reddit.com"];
  const routeHints = routesFromHtml(html, url);
  return {
    classification: recognizableHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      ? "recognizable"
      : "original",
    locale,
    era: "contemporary offline web",
    name,
    purpose: `A useful offline reconstruction of ${url.origin} generated from model knowledge.`,
    audience: "People who need a clear, useful page without relying on network access.",
    visualLanguage: {
      palette: ["#f8fafc", "#ffffff", "#172033", accent, secondary],
      typography: "System sans serif with readable editorial proportions",
      density: "comfortable",
      radius: "subtle",
      mood: "clear, practical, trustworthy",
    },
    establishedFacts: [`${name} is represented as an offline generated site.`],
    routeHints,
    palette: {
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#172033",
      mutedText: "#5f6b7a",
      accent,
      accentText: "#ffffff",
      border: "#cbd5e1",
    },
    fonts: { body: "Arial", heading: "Arial", mono: "Courier New" },
    layoutSystem: "Responsive single-document layout with clear navigation and readable content",
    favicon: faviconFor(url, seed),
  };
}

function compactBrief(context: PipelineContext, html: string): ApprovedPageBrief {
  const identity = compactIdentity(context, html);
  const additions = {
    facts: [] as string[],
    routes: routesFromHtml(html, new URL(context.request.url)),
  };
  const selectedCapabilityContracts = compactCapabilityContracts(context.request.settings, context.request.browserTheme);
  const selectedCapabilities = Object.keys(selectedCapabilityContracts) as CapabilityId[];
  if (context.request.settings.allowGeneratedScripts) selectedCapabilities.push("local-dom-scripts");
  const direction: PageDirection = {
    siteClassification: identity.classification,
    locale: identity.locale,
    era: identity.era,
    palette: identity.palette,
    fonts: identity.fonts,
    favicon: identity.favicon,
    density: identity.visualLanguage.density,
    layout: identity.layoutSystem,
    composition: ["Primary navigation", "Useful document content", "Related internal routes"],
    sections: [
      { id: "main", heading: "Main content", goal: "Answer the navigation request usefully", layout: "Readable document flow" },
    ],
    iconSet: null,
    imagery: context.request.settings.images.mode === "tag-placeholder" ? ["Optional semantic image placeholders"] : [],
    selectedCapabilities,
    creativeRationale: "Compact mode lets a small local model focus its limited capacity on one useful HTML document.",
    implementationNotes: "Site identity, metadata, favicon, continuity, and safety transforms are completed deterministically by the host.",
  };
  return { identity, direction, additions, selectedCapabilityContracts };
}

function compactPrompt(context: PipelineContext): PromptBundle {
  const { request } = context;
  const existingIdentity = request.context.siteWorld?.identity;
  const navigation = request.context.navigationIntent;
  const scripts = request.settings.allowGeneratedScripts
    ? "You may use small inline JavaScript. Calculators, converters, filters, menus, and tabs must work immediately without another page-generation request. Mark every non-navigation form with data-vibe-local and preventDefault in its handler. Use ordinary links or unmarked GET forms only when the action genuinely opens another page."
    : "Do not use JavaScript or script tags. Do not render calculators, filters, tabs, or other controls that falsely imply unavailable local behavior; use a genuine navigational link or GET form when another page is required.";
  const styling = request.settings.tailwindEnabled
    ? "Use literal stock Tailwind utility classes for primary layout, spacing, typography, color, and responsive styling. Inline CSS is only for exact selectors or effects Tailwind cannot express cleanly."
    : "Tailwind is unavailable. Keep the complete page CSS inline in one <style> element.";
  const motion = request.settings.motionEnabled !== false
    ? "Page-appropriate motion is allowed when it supports comprehension and fits the site's era."
    : "Motion is disabled. Do not use CSS animations, transitions, animated scrolling, Web Animations, or timer-driven visual motion.";
  const images = request.settings.images.mode === "tag-placeholder"
    ? "For a useful image, use <img data-vibe-image=\"short semantic query\" alt=\"meaningful description\"> instead of a remote URL."
    : "Do not depend on remote images.";
  const capabilityContracts = compactCapabilityContracts(request.settings, request.browserTheme);
  const capabilities = Object.entries(capabilityContracts)
    .filter(([id]) => !["semantic-navigation", "inline-page-css", "tailwind-utilities", "image-intents"].includes(id))
    .map(([id, contract]) => `${id}: ${contract}`)
    .join("\n");
  const history = request.context.relevantHistory.slice(0, 3).map((page) => ({
    url: page.url,
    title: page.title,
    purpose: page.purpose,
  }));
  const system = [
    "You are the compact offline page generator inside VibeSurfer.",
    "Return one complete, self-contained HTML document and nothing else. Do not explain your work and do not use Markdown fences.",
    "Use your internal knowledge to make the page genuinely useful. Do not claim to have fetched live data; label uncertain or time-sensitive facts honestly.",
    "Use semantic HTML, accessible labels, a responsive layout, and same-origin or relative links. Every meaningful link must include data-vibe-context describing its destination entity, relationship, and key visible values.",
    styling,
    motion,
    scripts,
    images,
    capabilities ? `Optional built-in capabilities are available without generated JavaScript. Use them only when useful:\n${capabilities}` : "",
  ].join(" ");
  const prompt = [
    `URL: ${request.url}`,
    `Browser theme: ${request.browserTheme}`,
    `Profile vibe: ${(request.worldPromptSnapshot.vibe ?? "").slice(0, 1_000) || "No additional profile vibe."}`,
    `Profile world instruction: ${request.worldPromptSnapshot.prompt.slice(0, 4_000) || "No additional world instruction."}`,
    existingIdentity ? `Existing site identity to preserve: ${JSON.stringify({
      name: existingIdentity.name,
      purpose: existingIdentity.purpose,
      audience: existingIdentity.audience,
      locale: existingIdentity.locale,
      era: existingIdentity.era,
      visualLanguage: existingIdentity.visualLanguage,
    })}` : "Create an appropriate site from the hostname. Recognizable sites should retain their familiar purpose; unknown domains may be invented coherently.",
    `Navigation request: ${JSON.stringify({
      kind: navigation.kind,
      anchorText: navigation.anchorText,
      linkContext: (navigation.linkContext ?? "").slice(0, 700),
      surroundingText: navigation.surroundingText.slice(0, 700),
      formFields: navigation.formFields,
    })}`,
    history.length > 0 ? `Recent same-site pages: ${JSON.stringify(history)}` : "There is no prior same-site page context.",
    "For original sites and inner pages, derive the composition from the page's dominant task instead of repeating a top-left logo, horizontal nav, content column, and right sidebar. Keep recognizable canonical roots familiar.",
    `Include at least ${request.settings.minInternalLinks} useful same-origin links. Put a meaningful <title> and meta description in <head>.`,
    "Begin with <!doctype html>.",
  ].join("\n\n");
  const fingerprint = createHash("sha256").update(system).update("\0").update(prompt).digest("hex");
  return { system, prompt, fingerprint, version: 14 };
}

function decodeBasicEntities(value: string): string {
  return value
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&amp;/gi, "&")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;/gi, "'");
}

function textContent(value: string): string {
  return decodeBasicEntities(value.replaceAll(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim());
}

export function normalizeGeneratedHtml(raw: string): string {
  let source = raw.replace(/^\uFEFF/, "").trim();
  source = source.replace(/^```(?:html|xml)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const documentStart = source.search(/<!doctype\s+html|<html\b/i);
  if (documentStart > 0) source = source.slice(documentStart);
  const documentEnd = source.toLowerCase().lastIndexOf("</html>");
  if (documentEnd >= 0) source = source.slice(0, documentEnd + 7);
  if (!source) {
    const error = new Error("The compact provider returned an empty page.");
    error.name = "AI_NoObjectGeneratedError";
    throw error;
  }
  if (/^<!doctype\s+html/i.test(source)) return source;
  if (/^<html\b/i.test(source)) return `<!doctype html>\n${source}`;
  if (/<[a-z][\s\S]*>/i.test(source)) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${source}</body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Generated page</title></head><body><main><pre style="white-space:pre-wrap">${escapeHtml(source)}</pre></main></body></html>`;
}

function pageResult(raw: string, requestUrl: string, minimumLinks: number, tailwindEnabled: boolean): PageResult {
  const normalized = normalizeGeneratedHtml(raw);
  const fallbackTitle = titleCaseHostname(new URL(requestUrl).hostname);
  const title = textContent(normalized.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? normalized.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? fallbackTitle).slice(0, 240) || fallbackTitle;
  const html = ensureDocumentBasics(normalized, requestUrl, title, minimumLinks, tailwindEnabled);
  const description = decodeBasicEntities(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
    ?? html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1]
    ?? `Offline generated page for ${requestUrl}`).slice(0, 500);
  const visible = textContent(html);
  const summary = (visible.slice(0, 997) || description).slice(0, 1_000);
  return { meta: { title, description, pageSummary: summary }, html };
}

export async function runCompactPipeline(context: PipelineContext): Promise<PipelineResult> {
  const { request, executor, signal, emit } = context;
  if (!executor.generateText) {
    throw new Error("The selected provider does not support compact text generation.");
  }

  await emit.phase("preparing-context", 0.08);
  const initialBrief = compactBrief(context, "");
  await emit.metadata({ favicon: initialBrief.identity.favicon });
  await emit.phase("generating", 0.2);
  const preview = createProgressivePagePreview({ request, emit, approvedBrief: initialBrief });
  const generated = await executor.generateText({
    purpose: "page-builder",
    prompt: compactPrompt(context),
    abortSignal: signal,
    maxOutputTokens: Math.min(request.settings.maxOutputTokens, 16_000),
    onPartialText: async (accumulatedText) => {
      try {
        await preview.handle({ html: normalizeGeneratedHtml(accumulatedText) });
      } catch {
        // The first streamed tokens may only contain a fence or whitespace.
      }
    },
  });
  await preview.flush();

  const page = pageResult(generated.text, request.url, request.settings.minInternalLinks, request.settings.tailwindEnabled);
  const approvedBrief = compactBrief(context, page.html);
  await emit.metadata({
    title: page.meta.title,
    summary: page.meta.pageSummary,
    favicon: approvedBrief.identity.favicon,
  });
  await emit.phase("validating", 0.7);
  const compiled = await compilePage({
    request,
    executor,
    page,
    approvedBrief,
    usage: generated.usage,
    modelExchanges: [generated.exchange],
    signal,
    emit,
  });
  await emit.validation(compiled.issues);
  if (compiled.issues.some((issue) => issue.severity === "error")) {
    throw new UnsafeOutputError(compiled.issues);
  }
  await emit.phase("committing", 0.96);
  return { artifact: compiled.artifact, usage: generated.usage };
}
