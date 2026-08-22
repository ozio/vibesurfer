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
import { GENERATION_PROMPT_VERSION as PROMPT_VERSION } from "../domain.js";
import { extractHtmlDocumentMetadata } from "../html/metadata.js";
import type { PromptBundle } from "../prompt-builder.js";
import type { GenerateCommand } from "../protocol/types.js";
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

export const TURBO_MAX_OUTPUT_TOKENS = 4_096;
const TURBO_PROFILE_CONTEXT_CHARS = 600;

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
  const availableContracts = compactCapabilityContracts(context.request.settings, context.request.browserTheme);
  const selectedCapabilities: CapabilityId[] = ["semantic-navigation", "inline-page-css"];
  const selectedCapabilityContracts = Object.fromEntries(
    selectedCapabilities.flatMap((id) => availableContracts[id] ? [[id, availableContracts[id]]] : []),
  ) as Partial<Record<CapabilityId, string>>;
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
    imagery: [],
    selectedCapabilities,
    creativeRationale: "Compact mode lets a small local model focus its limited capacity on one useful HTML document.",
    implementationNotes: "The host completes metadata, favicon, routes, document repair, styling safety, and continuity without another model request.",
  };
  return { identity, direction, additions, selectedCapabilityContracts };
}

function compactPrompt(context: PipelineContext): PromptBundle {
  const { request } = context;
  const existingIdentity = request.context.siteWorld?.identity;
  const navigation = request.context.navigationIntent;
  const profileContext = compactText([
    request.worldPromptSnapshot.vibe,
    request.worldPromptSnapshot.prompt,
  ].filter(Boolean).join(" "), TURBO_PROFILE_CONTEXT_CHARS);
  const history = request.context.relevantHistory.at(-1);
  const system = [
    "Generate one useful offline webpage for the exact URL.",
    "Output only one complete HTML document: no JSON, Markdown fences, explanation, or text outside HTML.",
    "Use semantic HTML, accessible labels, responsive layout, and one inline <style> element.",
    "Use relative or same-origin links. Do not use scripts, frames, external assets, network APIs, animations, or fake interactive controls.",
    "Include real-looking useful content from model knowledge, but never claim live access and label time-sensitive facts honestly.",
  ].join(" ");
  const prompt = [
    `URL: ${compactText(request.url, 1_000)}`,
    `Theme: ${turboTheme(request.browserTheme)}`,
    profileContext ? `Profile: ${profileContext}` : "",
    existingIdentity ? `Keep site: ${JSON.stringify({
      name: compactText(existingIdentity.name, 120),
      purpose: compactText(existingIdentity.purpose, 240),
      locale: existingIdentity.locale,
      mood: compactText(existingIdentity.visualLanguage.mood, 100),
      colors: existingIdentity.visualLanguage.palette.slice(0, 5),
    })}` : "Recognizable hosts should look familiar; invent unknown hosts coherently.",
    `Task: ${JSON.stringify({
      kind: navigation.kind,
      text: compactText(navigation.anchorText || navigation.ariaLabel, 120),
      context: compactText(navigation.linkContext, 240),
      nearby: compactText(navigation.surroundingText, 160),
      fields: compactFormFields(navigation.formFields),
    })}`,
    history ? `Previous page: ${JSON.stringify({
      url: compactText(history.url, 300),
      title: compactText(history.title, 120),
      purpose: compactText(history.purpose, 240),
    })}` : "",
    `Include <title>, a meta description, and at least ${request.settings.minInternalLinks} useful internal links. Start with <!doctype html>. Stay under ${TURBO_MAX_OUTPUT_TOKENS} output tokens.`,
  ].filter(Boolean).join("\n");
  const fingerprint = createHash("sha256").update(system).update("\0").update(prompt).digest("hex");
  return { system, prompt, fingerprint, version: PROMPT_VERSION };
}

function compactText(value: string | undefined, limit: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function compactFormFields(fields: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fields) return undefined;
  const entries = Object.entries(fields).slice(0, 6).map(([key, value]) => [
    compactText(key, 60),
    compactText(value, 120),
  ]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function turboTheme(theme: PipelineContext["request"]["browserTheme"]): string {
  switch (theme) {
    case "sedative": return "calm, low-stimulation editorial web";
    case "ie-classic": return "compact 1997-2003 web with simple controls";
    case "cyberpunk": return "dense dark near-future network interface";
    default: return "site-appropriate, clear, and practical";
  }
}

function turboRequest(request: GenerateCommand): GenerateCommand {
  return {
    ...request,
    settings: {
      ...request.settings,
      tailwindEnabled: false,
      allowGeneratedScripts: false,
      motionEnabled: false,
      dynamicMode: "off",
      capabilities: {
        iconsEnabled: false,
        audioSpeechEnabled: false,
        externalMediaEnabled: false,
        experimentalEnabled: false,
        enabled: {},
      },
      images: { mode: "off", fetchExternal: false, safeContent: true },
      maxOutputTokens: Math.min(request.settings.maxOutputTokens, TURBO_MAX_OUTPUT_TOKENS),
    },
  };
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
  const description = extractHtmlDocumentMetadata(html).description
    ?? `Offline generated page for ${requestUrl}`;
  const visible = textContent(html);
  const summary = (visible.slice(0, 997) || description).slice(0, 1_000);
  return { meta: { pageSummary: summary }, html };
}

export async function runCompactPipeline(context: PipelineContext): Promise<PipelineResult> {
  const turboContext = { ...context, request: turboRequest(context.request) };
  const { request, executor, signal, emit } = turboContext;
  if (!executor.generateText) {
    throw new Error("The selected provider does not support compact text generation.");
  }

  await emit.phase("preparing-context", 0.08);
  const initialBrief = compactBrief(turboContext, "");
  await emit.metadata({ favicon: initialBrief.identity.favicon });
  await emit.phase("generating", 0.2);
  const preview = createProgressivePagePreview({ request, emit, approvedBrief: initialBrief });
  const prompt = compactPrompt(turboContext);
  const maxOutputTokens = request.settings.maxOutputTokens;
  const startedAt = new Date().toISOString();
  await emit.stage?.({ stage: "page-builder", status: "running", startedAt, payload: { systemPrompt: prompt.system, prompt: prompt.prompt, maxOutputTokens } });
  await emit.progress?.({ stage: "builder", stageIndex: 1, stageCount: 1, currentOutputTokens: 0, maxOutputTokens, approximate: true, percent: 5 });
  const generated = await executor.generateText({
    purpose: "page-builder",
    prompt,
    abortSignal: signal,
    maxOutputTokens,
    maxRetries: 0,
    stopSequences: ["</html>"],
    onPartialText: async (accumulatedText) => {
      try {
        await preview.handle({ html: normalizeGeneratedHtml(accumulatedText) });
      } catch {
        // The first streamed tokens may only contain a fence or whitespace.
      }
      const currentOutputTokens = Math.ceil(accumulatedText.length / 4);
      await emit.progress?.({ stage: "builder", stageIndex: 1, stageCount: 1, currentOutputTokens, maxOutputTokens, approximate: true, percent: Math.min(84, Math.max(5, Math.round(5 + Math.min(1, currentOutputTokens / maxOutputTokens) * 80))) });
    },
  });
  await preview.flush();
  await emit.stage?.({ stage: "page-builder", status: "completed", startedAt: generated.exchange.startedAt, completedAt: generated.exchange.completedAt, payload: generated.exchange as unknown as Record<string, unknown> });
  await emit.progress?.({ stage: "builder", stageIndex: 1, stageCount: 1, currentOutputTokens: generated.usage.outputTokens, maxOutputTokens, approximate: false, percent: 85 });

  const page = pageResult(generated.text, request.url, request.settings.minInternalLinks, request.settings.tailwindEnabled);
  const approvedBrief = compactBrief(turboContext, page.html);
  const documentMetadata = extractHtmlDocumentMetadata(page.html);
  await emit.metadata({
    title: documentMetadata.title ?? approvedBrief.identity.name,
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
