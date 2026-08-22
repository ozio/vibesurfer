import { createHash } from "node:crypto";

import {
  ExistingSiteDirectorResultSchema,
  DynamicRegionResultSchema,
  NewSiteDirectorResultSchema,
  PageResultSchema,
  type ApprovedPageBrief,
  type FaviconDescriptor,
  type PageResult,
  type SiteIdentity,
  type SiteWorldPatch,
} from "../domain.js";
import { ICONIFY_WEB_COMPONENT_SCRIPT, iconifyPack, type IconSet } from "../iconify/catalog.js";
import type { PromptStage } from "../prompt-builder.js";
import {
  createModelExchange,
  type GeneratedText,
  type GeneratedObject,
  type GenerateTextRequest,
  type GenerateObjectRequest,
  type ModelExecutor,
} from "./executor.js";

function hashInt(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function requestedUrl(prompt: string): URL {
  const match = prompt.match(/<requested_url>([^<]+)<\/requested_url>/)
    ?? prompt.match(/^URL:\s*(https?:\/\/\S+)/m);
  try {
    return new URL(match?.[1] ?? "https://example.test/");
  } catch {
    return new URL("https://example.test/");
  }
}

function approvedBrief(prompt: string): ApprovedPageBrief | undefined {
  const match = prompt.match(/<approved_page_brief>\s*([\s\S]*?)\s*<\/approved_page_brief>/);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]) as ApprovedPageBrief;
  } catch {
    return undefined;
  }
}

function approvedIdentity(prompt: string): SiteIdentity | undefined {
  return approvedBrief(prompt)?.identity;
}

function abortError(): Error {
  return new DOMException("The generation was cancelled.", "AbortError");
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw abortError();
  }
  if (milliseconds <= 0) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function titleCaseHost(hostname: string): string {
  return hostname
    .replace(/^www\./, "")
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function palette(seed: number): [string, string, string, string] {
  const choices: Array<[string, string, string, string]> = [
    ["#0f172a", "#2563eb", "#f8fafc", "#f59e0b"],
    ["#172554", "#7c3aed", "#faf5ff", "#14b8a6"],
    ["#3f1d0b", "#ea580c", "#fff7ed", "#0f766e"],
    ["#052e16", "#16a34a", "#f0fdf4", "#0284c7"],
  ];
  return choices[seed % choices.length] ?? choices[0]!;
}

function makeSitePatch(url: URL, seed: number): SiteWorldPatch {
  const name = titleCaseHost(url.hostname) || "Imagined Web";
  const [ink, accent, paper, secondary] = palette(seed);
  const routes = [
    ["/", "Home", "Primary overview"],
    ["/discover", "Discover", "Curated discoveries"],
    ["/latest", "Latest", "Recent updates"],
    ["/topics", "Topics", "Subject directory"],
    ["/stories", "Stories", "Long-form stories"],
    ["/guides", "Guides", "Practical guides"],
    ["/community", "Community", "Community activity"],
    ["/events", "Events", "Upcoming events"],
    ["/collections", "Collections", "Saved collections"],
    ["/newsletter", "Newsletter", "Email digest"],
    ["/about", "About", "Organization background"],
    ["/help", "Help", "Help center"],
    ["/search", "Search", "Site search"],
    ["/account", "Account", "Account area"],
    ["/contact", "Contact", "Contact information"],
  ] as const;
  return {
    name,
    purpose: `A coherent fictional information service inspired only by the URL ${url.origin}.`,
    audience: "Curious people looking for clear, current-looking information and useful paths onward.",
    visualLanguage: {
      palette: [ink, accent, paper, secondary],
      typography: "A crisp humanist sans serif with a restrained editorial display face",
      density: "comfortable",
      radius: "rounded",
      mood: "confident, useful, contemporary",
    },
    establishedFacts: [
      `${name} is presented as an independent fictional service.`,
      "The experience favors clarity, accessibility, and discoverable navigation.",
    ],
    routeHints: routes.map(([path, label, purpose]) => ({ path, label, purpose })),
  };
}

function makeFavicon(site: SiteWorldPatch, seed: number): FaviconDescriptor {
  return {
    kind: "glyph",
    glyph: site.name.trim().slice(0, 1).toUpperCase() || "V",
    foreground: site.visualLanguage.palette[2] ?? "#ffffff",
    background: site.visualLanguage.palette[1] ?? "#2563eb",
    shape: seed % 2 === 0 ? "rounded-square" : "circle",
  };
}

function makeIdentity(url: URL, seed: number): SiteIdentity {
  const sitePatch = makeSitePatch(url, seed);
  const [ink, accent, paper] = palette(seed);
  if (url.hostname === "bububu.com" || url.hostname === "www.bububu.com") {
    const paletteRoles = {
      background: "#090612",
      surface: "#191225",
      text: "#f7f1ff",
      mutedText: "#b5a4c6",
      accent: "#bdff59",
      accentText: "#111606",
      border: "#49345f",
    };
    return {
      classification: "original",
      locale: "en-US",
      era: "near-future field science",
      name: "Bububu Exomonster Signal Index",
      purpose: "A live search index for migratory monsters detected in deep-space radio noise.",
      audience: "Night-shift xenozoologists, radio amateurs, and orbital field crews",
      visualLanguage: {
        palette: Object.values(paletteRoles).slice(0, 6),
        typography: "Cousine field notes with Anton specimen headers",
        density: "compact",
        radius: "subtle",
        mood: "nocturnal, curious, instrument-like",
      },
      establishedFacts: ["Bububu triangulates nonhuman migrations from public observatory signals."],
      routeHints: [
        ["/", "Signal search", "Search recent detections"],
        ["/species", "Species index", "Browse confirmed exomonsters"],
        ["/signals", "Live signals", "Inspect incoming radio traces"],
        ["/map", "Migration map", "Track current migration corridors"],
        ["/observatories", "Observatories", "Browse participating listening stations"],
        ["/field-notes", "Field notes", "Read recent xenozoologist reports"],
        ["/corridors", "Signal corridors", "Compare long-range movement patterns"],
        ["/alerts", "Detection alerts", "Review high-confidence encounters"],
        ["/specimens", "Specimen records", "Inspect recovered trace evidence"],
        ["/calendar", "Migration calendar", "See predicted seasonal crossings"],
        ["/submit", "Submit a signal", "Send an amateur observatory report"],
        ["/about", "About Bububu", "Meet the distributed index collective"],
      ].map(([path, label, purpose]) => ({ path: path!, label: label!, purpose: purpose! })),
      palette: paletteRoles,
      fonts: { body: "Cousine", heading: "Anton", mono: "Noto Sans Mono Variable" },
      layoutSystem: "Asymmetric specimen index with a persistent signal rail",
      favicon: { kind: "glyph", glyph: "β", foreground: "#090612", background: "#bdff59", shape: "rounded-square" },
    };
  }
  const recognizableHosts = ["google.com", "wikipedia.org", "youtube.com"];
  return {
    ...sitePatch,
    classification: recognizableHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      ? "recognizable"
      : "original",
    locale: "en-US",
    era: "contemporary",
    palette: {
      background: paper,
      surface: "#ffffff",
      text: ink,
      mutedText: "#64748b",
      accent,
      accentText: "#ffffff",
      border: "#cbd5e1",
    },
    fonts: { body: "Arimo Variable", heading: "Source Sans 3 Variable", mono: "Cousine" },
    layoutSystem: "A responsive editorial shell with a dense link directory",
    favicon: makeFavicon(sitePatch, seed),
  };
}

function makeDirectorResult(url: URL, seed: number, prompt: string): unknown {
  const availableCapabilities = (() => {
    const match = prompt.match(/<capability_catalog>\s*([\s\S]*?)\s*<\/capability_catalog>/);
    if (!match?.[1]) return ["semantic-navigation", "favicon-glyph", "inline-page-css"];
    try {
      const catalog = JSON.parse(match[1]) as { capabilities?: Record<string, string> };
      return Object.keys(catalog.capabilities ?? {});
    } catch {
      return ["semantic-navigation", "favicon-glyph", "inline-page-css"];
    }
  })();
  const identityFromContext = (() => {
    const match = prompt.match(/<navigation_context>\s*([\s\S]*?)\s*<\/navigation_context>/);
    if (!match?.[1]) return undefined;
    try {
      const context = JSON.parse(match[1]) as { siteWorld?: { identity?: SiteIdentity } };
      return context.siteWorld?.identity;
    } catch {
      return undefined;
    }
  })();
  const identity = identityFromContext ?? makeIdentity(url, seed);
  const iconSet: IconSet | null = (() => {
    const hostname = url.hostname.replace(/^www\./, "");
    if (["google.com", "wikipedia.org", "youtube.com"].includes(hostname)) return null;
    if (hostname === "bububu.com") return "streamline-cyber";
    return "lucide";
  })();
  const liveInterface = /(?:chat|cart|wishlist|search|feed|live|status|auction|market|shop|store|message|inbox|track)/i
    .test(`${url.hostname}${url.pathname}${url.search}`);
  const direction = {
    siteClassification: identity.classification,
    locale: identity.locale,
    era: identity.era,
    palette: identity.palette,
    fonts: identity.fonts,
    favicon: identity.favicon,
    density: identity.visualLanguage.density,
    layout: identity.layoutSystem,
    composition: ["Primary navigation", "Page-specific lead", "Dense useful content", "Onward route directory"],
    sections: [
      { id: "hero", heading: "A useful starting point", goal: "Explain the page immediately", layout: "split editorial hero" },
      { id: "highlights", heading: "Highlights", goal: "Surface the strongest destinations", layout: "responsive card grid" },
      { id: "briefing", heading: "Today at a glance", goal: "Add plausible information density", layout: "two-column briefing" },
      { id: "explore", heading: "Explore more", goal: "Provide rich onward navigation", layout: "link directory" },
    ],
    iconSet,
    imagery: ["coastal-city", "community-studio"],
    selectedCapabilities: (liveInterface && availableCapabilities.includes("dynamic-regions")
      ? ["dynamic-regions", ...availableCapabilities.filter((id) => id !== "dynamic-regions")]
      : availableCapabilities.filter((id) => id !== "dynamic-regions")).slice(0, 16),
    creativeRationale: `A concrete service for ${url.hostname}, with an identity tied to the hostname rather than a generic landing page.`,
    implementationNotes: "Keep the route hierarchy visible and render the approved visual system exactly.",
  };
  const additions = { facts: [`The requested route is ${url.pathname}.`], routes: identity.routeHints.slice(0, 15) };
  return identityFromContext
    ? ExistingSiteDirectorResultSchema.parse({ direction, additions })
    : NewSiteDirectorResultSchema.parse({ identity, direction, additions });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function makeHtml(url: URL, site: SiteWorldPatch, title: string, prompt: string): string {
  const tailwind = prompt.includes("Use Tailwind CSS");
  const imagesOff = prompt.includes("Do not rely on photography");
  const iconSet = approvedBrief(prompt)?.direction.iconSet ?? null;
  const selectedIcon = iconSet
    ? iconifyPack(iconSet).semanticMap.home ?? iconifyPack(iconSet).flavor[0] ?? iconifyPack(iconSet).names[0]
    : undefined;
  const iconScript = selectedIcon
    ? `<script src="${ICONIFY_WEB_COMPONENT_SCRIPT}"></script>`
    : "";
  const iconMarkup = selectedIcon
    ? `<iconify-icon icon="${iconSet}:${selectedIcon}" aria-hidden="true"></iconify-icon> `
    : "";
  const nav = site.routeHints
    .slice(0, 15)
    .map((route) => `<a href="${escapeHtml(route.path)}" class="text-sm font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500">${escapeHtml(route.label)}</a>`)
    .join("\n");
  const cards = site.routeHints
    .slice(1, 7)
    .map(
      (route, index) => `<article class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-wide text-blue-600">0${index + 1}</p>
        <h2 class="mt-2 text-xl font-bold text-slate-900">${escapeHtml(route.label)}</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">${escapeHtml(route.purpose)} with related context and useful details.</p>
        <a class="mt-4 inline-flex font-semibold text-blue-700 hover:underline" href="${escapeHtml(route.path)}">Explore ${escapeHtml(route.label)}</a>
      </article>`,
    )
    .join("\n");
  const style = tailwind
    ? ""
    : `<style>
      :root{color-scheme:light;--ink:#0f172a;--accent:#2563eb;--paper:#f8fafc}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:var(--paper);color:var(--ink)}a{color:inherit}.shell{width:min(1120px,calc(100% - 2rem));margin:auto}.nav{display:flex;gap:1rem;flex-wrap:wrap;padding:1.25rem 0}.hero{padding:5rem 0 3rem}.hero h1{font-size:clamp(2.5rem,8vw,5.5rem);line-height:.95;margin:0;max-width:12ch}.hero p{font-size:1.15rem;line-height:1.7;max-width:65ch}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;padding:2rem 0 5rem}.grid article{background:white;border:1px solid #dbe3ef;border-radius:1rem;padding:1.25rem}.directory{display:flex;gap:.75rem;flex-wrap:wrap;padding:2rem 0}a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}@media(max-width:760px){.grid{grid-template-columns:1fr}.hero{padding-top:3rem}}
    </style>`;
  const bodyClass = tailwind ? "min-h-screen bg-slate-50 text-slate-950 antialiased" : "";
  const shellClass = tailwind ? "mx-auto w-full max-w-6xl px-4 sm:px-6" : "shell";
  const navClass = tailwind ? "flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-slate-200 py-5" : "nav";
  const heroClass = tailwind ? "grid gap-8 py-16 lg:grid-cols-2 lg:items-end" : "hero";
  const gridClass = tailwind ? "grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-3" : "grid";
  const image = imagesOff
    ? ""
    : `<img data-vibe-image="coastal city, morning light, editorial" data-vibe-aspect="16/9" alt="An imagined city in soft morning light" class="aspect-video w-full rounded-2xl object-cover">`;
  const dynamicEnabled = approvedBrief(prompt)?.direction.selectedCapabilities.includes("dynamic-regions") === true;
  const commerce = /(?:cart|wishlist|market|shop|store|auction)/i.test(`${url.hostname}${url.pathname}`);
  const dynamicMarkup = !dynamicEnabled ? "" : commerce
    ? `<section class="${shellClass}" aria-labelledby="live-cart-title">
        <h2 id="live-cart-title">Live cart</h2>
        <p><strong data-vibe-bind="cart.count">0</strong> items · <span data-vibe-bind="cart.total">0</span></p>
        <form data-vibe-action="state:cart.add">
          <input type="hidden" name="productId" value="sku-204">
          <input type="hidden" name="quantity" value="1">
          <input type="hidden" name="unitPriceMinor" value="1499">
          <input type="hidden" name="currency" value="USD">
          <button type="submit">Add field guide to cart</button>
        </form>
      </section>`
    : `<section class="${shellClass}" aria-labelledby="live-region-title">
        <h2 id="live-region-title">Live updates</h2>
        <div data-vibe-region="live-thread" data-vibe-refresh="60" aria-live="polite"><p>The thread is ready for its next update.</p></div>
        <form data-vibe-action="model:thread.send" data-vibe-target="live-thread">
          <label>Message <input name="message" required></label>
          <button type="submit">Send</button>
        </form>
      </section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="A page for ${escapeHtml(url.href)}">
  ${iconScript}
  ${style}
</head>
<body class="${bodyClass}">
  <header class="${shellClass}">
    <nav aria-label="Primary" class="${navClass}">${nav}</nav>
  </header>
  <main>
    <section class="${shellClass} ${heroClass}">
      <div>
        <p class="text-sm font-bold uppercase tracking-wide text-blue-700">${iconMarkup}${escapeHtml(url.hostname)}</p>
        <h1 class="mt-4 max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">${escapeHtml(title)}</h1>
        <p class="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Browse the latest highlights, collections, and useful routes from across the site.</p>
      </div>
      ${image}
    </section>
    <section aria-labelledby="highlights" class="${shellClass}">
      <h2 id="highlights" class="text-3xl font-bold">Highlights</h2>
      <div class="${gridClass}">${cards}</div>
    </section>
    <section class="${shellClass} directory" aria-labelledby="explore-more">
      <h2 id="explore-more" class="w-full text-2xl font-bold">Explore more</h2>
      ${nav}
    </section>
    ${dynamicMarkup}
  </main>
  <footer class="${shellClass} border-t border-slate-200 py-8 text-sm text-slate-500">${escapeHtml(title)}</footer>
</body>
</html>`;
}

function makePageResult(url: URL, seed: number, prompt: string): PageResult {
  const sitePatch = approvedIdentity(prompt) ?? makeSitePatch(url, seed);
  const suffix = url.pathname === "/" ? "" : ` — ${url.pathname.split("/").filter(Boolean).join(" ")}`;
  const title = `${sitePatch.name}${suffix}`;
  return PageResultSchema.parse({
    meta: {
      title,
      description: `A destination page for ${url.href}.`,
      pageSummary: `An editorial landing page for ${title} with highlights and a dense set of internally consistent routes.`,
    },
    html: makeHtml(url, sitePatch, title, prompt),
  });
}

export class DeterministicMockExecutor implements ModelExecutor {
  readonly actualProviderKind = "mock" as const;
  readonly providerId: string;
  readonly modelId: string;
  readonly generationMode: "directed" | "compact";
  readonly calls: Array<PromptStage | "region-builder"> = [];
  readonly #seed: string;
  readonly #latencyMs: number;

  constructor(options: { providerId: string; modelId: string; seed: string; latencyMs?: number; generationMode?: "directed" | "compact" }) {
    this.providerId = options.providerId;
    this.modelId = options.modelId;
    this.generationMode = options.generationMode ?? "directed";
    this.#seed = options.seed;
    this.#latencyMs = options.latencyMs ?? 0;
  }

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    const startedAt = new Date();
    this.calls.push(request.purpose);
    await abortableDelay(this.#latencyMs, request.abortSignal);
    if (request.abortSignal.aborted) {
      throw abortError();
    }

    const url = requestedUrl(request.prompt.prompt);
    const seed = hashInt(`${this.#seed}:${url.href}`);
    let candidate: unknown;
    switch (request.purpose) {
      case "page-director":
        candidate = makeDirectorResult(url, seed, request.prompt.prompt);
        break;
      case "page-builder":
        candidate = makePageResult(url, seed, request.prompt.prompt);
        break;
      case "region-builder": {
        const targets = [...request.prompt.prompt.matchAll(/"targets":\s*\[([^\]]+)\]/g)]
          .flatMap((match) => [...(match[1] ?? "").matchAll(/"([A-Za-z][A-Za-z0-9_.-]{0,63})"/g)])
          .map((match) => match[1]!)
          .slice(0, 16);
        candidate = DynamicRegionResultSchema.parse({
          patches: [...new Set(targets)].map((regionId) => ({
            regionId,
            html: `<div role="status"><strong>Updated</strong><p>Fresh deterministic content for ${escapeHtml(regionId)}.</p></div>`,
          })),
          announcement: "Live content updated.",
        });
        break;
      }
    }

    const output = request.schema.parse(candidate);
    if (request.onPartial && request.purpose === "page-builder") {
      const page = candidate as PageResult;
      await request.onPartial({ meta: { title: page.meta.title } });
      await request.onPartial(page);
    }

    const inputTokens = Math.ceil((request.prompt.system.length + request.prompt.prompt.length) / 4);
    const outputTokens = Math.ceil(JSON.stringify(output).length / 4);
    const usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      requests: 1,
    };
    const completedAt = new Date();
    return {
      output,
      usage,
      exchange: createModelExchange({
        request,
        providerId: this.providerId,
        modelId: this.modelId,
        actualProviderKind: this.actualProviderKind,
        startedAt,
        completedAt,
        response: JSON.stringify(output, null, 2),
        usage,
      }),
    };
  }

  async generateText(request: GenerateTextRequest): Promise<GeneratedText> {
    const startedAt = new Date();
    this.calls.push(request.purpose);
    await abortableDelay(this.#latencyMs, request.abortSignal);
    if (request.abortSignal.aborted) throw abortError();

    const url = requestedUrl(request.prompt.prompt);
    const seed = hashInt(`${this.#seed}:${url.href}`);
    const page = makePageResult(url, seed, request.prompt.prompt);
    const text = page.html;
    await request.onPartialText?.(text);
    const inputTokens = Math.ceil((request.prompt.system.length + request.prompt.prompt.length) / 4);
    const outputTokens = Math.ceil(text.length / 4);
    const usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, requests: 1 };
    const completedAt = new Date();
    return {
      text,
      usage,
      exchange: createModelExchange({
        request,
        providerId: this.providerId,
        modelId: this.modelId,
        actualProviderKind: this.actualProviderKind,
        startedAt,
        completedAt,
        response: text,
        usage,
      }),
    };
  }
}
