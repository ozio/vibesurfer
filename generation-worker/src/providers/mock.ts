import { createHash } from "node:crypto";

import {
  PagePlanSchema,
  PageResultSchema,
  SiteArchitectureSchema,
  type FaviconDescriptor,
  type PagePlan,
  type PageResult,
  type SiteArchitecture,
  type SiteWorldPatch,
} from "../domain.js";
import type { PromptStage } from "../prompt-builder.js";
import {
  type GeneratedObject,
  type GenerateObjectRequest,
  type ModelExecutor,
} from "./executor.js";

function hashInt(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function requestedUrl(prompt: string): URL {
  const match = prompt.match(/<requested_url>([^<]+)<\/requested_url>/);
  try {
    return new URL(match?.[1] ?? "https://example.test/");
  } catch {
    return new URL("https://example.test/");
  }
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

function makeArchitecture(url: URL, seed: number): SiteArchitecture {
  const sitePatch = makeSitePatch(url, seed);
  return SiteArchitectureSchema.parse({
    sitePatch,
    favicon: makeFavicon(sitePatch, seed),
    designRationale: "The calm editorial shell and dense route map make the invented service feel established while keeping navigation legible.",
  });
}

function makePlan(url: URL, seed: number): PagePlan {
  const site = makeSitePatch(url, seed);
  return PagePlanSchema.parse({
    pagePurpose: `Orient visitors to the fictional ${site.name} experience at ${url.pathname}.`,
    title: url.pathname === "/" ? site.name : `${site.name} — ${url.pathname.split("/").filter(Boolean).join(" ")}`,
    sections: [
      { id: "hero", heading: "A useful starting point", goal: "Explain the page immediately", layout: "split editorial hero" },
      { id: "highlights", heading: "Highlights", goal: "Surface the strongest destinations", layout: "responsive card grid" },
      { id: "briefing", heading: "Today at a glance", goal: "Add plausible information density", layout: "two-column briefing" },
      { id: "explore", heading: "Explore more", goal: "Provide rich onward navigation", layout: "link directory" },
    ],
    internalLinks: site.routeHints.slice(0, 15),
    imageIntents: ["modern city at dawn, editorial", "people collaborating in a bright studio"],
    consistencyNotes: ["Reuse the site palette", "Keep navigation labels stable", "Use concise, factual-sounding copy"],
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function makeHtml(url: URL, site: SiteWorldPatch, title: string, prompt: string): string {
  const tailwind = prompt.includes("Use Tailwind CSS");
  const imagesOff = prompt.includes("Do not rely on photography");
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
        <p class="mt-2 text-sm leading-6 text-slate-600">${escapeHtml(route.purpose)} with context invented for this generated page.</p>
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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="A fictional generated page for ${escapeHtml(url.href)}">
  ${style}
</head>
<body class="${bodyClass}">
  <header class="${shellClass}">
    <nav aria-label="Primary" class="${navClass}">${nav}</nav>
  </header>
  <main>
    <section class="${shellClass} ${heroClass}">
      <div>
        <p class="text-sm font-bold uppercase tracking-wide text-blue-700">Generated destination</p>
        <h1 class="mt-4 max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">${escapeHtml(title)}</h1>
        <p class="mt-6 max-w-2xl text-lg leading-8 text-slate-600">A coherent, entirely imagined page shaped by the address <strong>${escapeHtml(url.href)}</strong>. Pick any route to generate the next part of this world.</p>
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
  </main>
  <footer class="${shellClass} border-t border-slate-200 py-8 text-sm text-slate-500">This is a fictional VibeSurfer page, not the live website.</footer>
</body>
</html>`;
}

function makePageResult(url: URL, seed: number, prompt: string): PageResult {
  const sitePatch = makeSitePatch(url, seed);
  const suffix = url.pathname === "/" ? "" : ` — ${url.pathname.split("/").filter(Boolean).join(" ")}`;
  const title = `${sitePatch.name}${suffix}`;
  return PageResultSchema.parse({
    meta: {
      title,
      description: `A fictional generated destination for ${url.href}.`,
      pageSummary: `An editorial landing page for ${title} with highlights and a dense set of internally consistent routes.`,
      favicon: makeFavicon(sitePatch, seed),
      sitePatch,
    },
    html: makeHtml(url, sitePatch, title, prompt),
  });
}

export class DeterministicMockExecutor implements ModelExecutor {
  readonly actualProviderKind = "mock" as const;
  readonly providerId: string;
  readonly modelId: string;
  readonly calls: PromptStage[] = [];
  readonly #seed: string;
  readonly #latencyMs: number;

  constructor(options: { providerId: string; modelId: string; seed: string; latencyMs?: number }) {
    this.providerId = options.providerId;
    this.modelId = options.modelId;
    this.#seed = options.seed;
    this.#latencyMs = options.latencyMs ?? 0;
  }

  async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GeneratedObject<T>> {
    this.calls.push(request.purpose);
    await abortableDelay(this.#latencyMs, request.abortSignal);
    if (request.abortSignal.aborted) {
      throw abortError();
    }

    const url = requestedUrl(request.prompt.prompt);
    const seed = hashInt(`${this.#seed}:${url.href}`);
    let candidate: unknown;
    switch (request.purpose) {
      case "site-architect":
        candidate = makeArchitecture(url, seed);
        break;
      case "page-planner":
        candidate = makePlan(url, seed);
        break;
      case "quick-page":
      case "page-builder":
      case "page-repair":
        candidate = makePageResult(url, seed, request.prompt.prompt);
        break;
    }

    const output = request.schema.parse(candidate);
    if (request.onPartial && (request.purpose === "quick-page" || request.purpose === "page-builder" || request.purpose === "page-repair")) {
      const page = candidate as PageResult;
      await request.onPartial({ meta: { title: page.meta.title, favicon: page.meta.favicon } });
      await request.onPartial(page);
    }

    const inputTokens = Math.ceil((request.prompt.system.length + request.prompt.prompt.length) / 4);
    const outputTokens = Math.ceil(JSON.stringify(output).length / 4);
    return {
      output,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        requests: 1,
      },
    };
  }
}
