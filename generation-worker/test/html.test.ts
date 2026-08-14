import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_INTENTS,
  MAX_IMAGE_RESOLUTION_CONCURRENCY,
  transformHtml,
  transformPreviewHtml,
} from "../src/html/transform.js";
import {
  compileTailwind,
  filterTailwindCandidates,
  MAX_TAILWIND_CANDIDATES,
  MAX_TAILWIND_CANDIDATE_LENGTH,
  sanitizeCompiledCss,
} from "../src/html/tailwind.js";
import { validateHtml } from "../src/html/validate.js";
import { ICONIFY_WEB_COMPONENT_SCRIPT } from "../src/iconify/catalog.js";
import {
  MAX_EXTERNAL_IMAGE_BYTES,
  TagPlaceholderResolver,
} from "../src/images/resolver.js";
import { generationCommand } from "./helpers.js";

function links(): string {
  return Array.from({ length: 12 }, (_, index) => `<a href="/route-${index}">Route ${index}</a>`).join("");
}

describe("HTML compiler", () => {
  it("compiles only whitelisted Iconify names to inline SVG and supplies required attribution", async () => {
    const settings = {
      ...generationCommand().settings,
      tailwindEnabled: false,
      minInternalLinks: 0,
    };
    const transformed = await transformHtml({
      html: `<!doctype html><html><head><title>Cyber icons</title><script src="${ICONIFY_WEB_COMPONENT_SCRIPT}"></script></head><body>
        <button aria-label="Account"><iconify-icon icon="streamline-cyber:account" aria-hidden="true"></iconify-icon></button>
        <iconify-icon icon="streamline-cyber:user" aria-hidden="true"></iconify-icon>
        <iconify-icon icon="lucide:house" aria-hidden="true"></iconify-icon>
        <iconify-icon icon="streamline-cyber:not-a-real-icon" aria-hidden="true"></iconify-icon>
        <footer></footer>
      </body></html>`,
      url: "https://cyber.example/",
      title: "Cyber icons",
      settings,
      selectedIconSet: "streamline-cyber",
      artifactSeed: "iconify-cyber",
      signal: new AbortController().signal,
    });

    expect(transformed.html).not.toContain("code.iconify.design");
    expect(transformed.html.match(/<iconify-icon\b/g)).toHaveLength(2);
    expect(transformed.html).toContain('icon="streamline-cyber:account"');
    expect(transformed.html).not.toContain('icon="streamline-cyber:user"');
    expect(transformed.html).toContain("data-iconify-rendered");
    expect(transformed.html).toContain("<svg");
    expect(transformed.html).toContain("data-vibesurfer-iconify");
    expect(transformed.html).toContain("data-iconify-attribution");
    expect(transformed.html).toContain('rel="license noopener noreferrer"');
    expect(transformed.warnings).toContainEqual(expect.objectContaining({ code: "iconify-icon-rejected" }));
    expect(validateHtml(transformed.html, "https://cyber.example/", settings)).toEqual({ valid: true, issues: [] });
  });

  it("removes Iconify markup when no set was selected and rejects unlabeled icon-only controls", async () => {
    const settings = { ...generationCommand().settings, tailwindEnabled: false, minInternalLinks: 0 };
    const source = '<!doctype html><html><head><title>Icons</title></head><body><button><iconify-icon icon="lucide:house" aria-hidden="true"></iconify-icon></button></body></html>';
    const omitted = await transformHtml({
      html: source,
      url: "https://example.com/",
      title: "Icons",
      settings,
      selectedIconSet: null,
      artifactSeed: "iconify-none",
      signal: new AbortController().signal,
    });
    expect(omitted.html).not.toContain("iconify-icon");
    expect(omitted.warnings).toContainEqual(expect.objectContaining({ code: "iconify-not-selected" }));

    const compiled = await transformHtml({
      html: source,
      url: "https://example.com/",
      title: "Icons",
      settings,
      selectedIconSet: "lucide",
      artifactSeed: "iconify-a11y",
      signal: new AbortController().signal,
    });
    expect(validateHtml(compiled.html, "https://example.com/", settings).issues)
      .toContainEqual(expect.objectContaining({ code: "missing-icon-control-label" }));
  });

  it("strips active content, resolves images, normalizes links, and compiles Tailwind", async () => {
    const settings = {
      ...generationCommand().settings,
      tailwindEnabled: true,
      images: { mode: "tag-placeholder" as const, fetchExternal: true, safeContent: true },
    };
    const transformed = await transformHtml({
      html: `<!doctype html><html><head><title>Unsafe</title><meta http-equiv="refresh" content="0"><script>alert(1)</script></head><body onload="steal()"><iframe src="https://bad.test"></iframe><a href="javascript:steal()">Bad</a>${links()}<img src="https://tracker.test/x.jpg" data-vibe-image="mountain lake" alt="A lake"></body></html>`,
      url: "https://example.com/start",
      title: "Safe title",
      settings,
      artifactSeed: "artifact-1",
      signal: new AbortController().signal,
    });

    expect(transformed.html).not.toContain("<script");
    expect(transformed.html).not.toContain("<iframe");
    expect(transformed.html).not.toContain("onload=");
    expect(transformed.html).not.toContain("tracker.test");
    expect(transformed.html).toContain('href="#blocked"');
    expect(transformed.html).toContain("https://loremflickr.com/");
    expect(transformed.html).toContain('data-vibesurfer-styles="tailwind-4.3.3"');
    expect(validateHtml(transformed.html, "https://example.com/start", settings)).toEqual({ valid: true, issues: [] });
  });

  it("does not make an external image request when permission is off", async () => {
    let fetched = false;
    const resolver = new TagPlaceholderResolver({
      fetchExternal: false,
      safeContent: true,
      fetchImplementation: async () => {
        fetched = true;
        return new Response();
      },
    });
    const result = await resolver.resolve(
      { query: "forest", alt: "Forest", aspect: "16/9", index: 0, artifactSeed: "a" },
      new AbortController().signal,
    );
    expect(fetched).toBe(false);
    expect(result.source).toBe("tag-placeholder");
    expect(result.omitted).toBe(true);
    expect(result.warning?.code).toBe("external-images-disabled");

    const base = generationCommand().settings;
    const transformed = await transformHtml({
      html: '<!doctype html><html><head><title>Images</title></head><body><img data-vibe-image="forest" alt="Forest"></body></html>',
      url: "https://example.com/",
      title: "Images",
      settings: {
        ...base,
        images: { mode: "tag-placeholder", fetchExternal: false, safeContent: true },
      },
      artifactSeed: "no-fake-fallback",
      signal: new AbortController().signal,
      imageResolver: resolver,
    });
    expect(transformed.html).not.toContain("<img");
    expect(transformed.html).not.toContain("linearGradient");
    expect(transformed.warnings).toContainEqual(expect.objectContaining({ code: "external-images-disabled" }));
  });

  it("turns verbose image prose into distinct concrete LoremFlickr searches", async () => {
    const resolver = new TagPlaceholderResolver({
      fetchExternal: true,
      safeContent: true,
    });
    const signal = new AbortController().signal;
    const smartphone = await resolver.resolve(
      {
        query: "close-up of a smartphone and charger on a white table showing flash sale badge, e-commerce product photography",
        alt: "Smartphone and charger",
        aspect: "4/3",
        index: 0,
        artifactSeed: "catalog",
      },
      signal,
    );
    const speaker = await resolver.resolve(
      {
        query: "wireless-speaker,bluetooth-speaker",
        alt: "Wireless speaker",
        aspect: "4/3",
        index: 1,
        artifactSeed: "catalog",
      },
      signal,
    );

    const smartphoneUrl = new URL(smartphone.src);
    const speakerUrl = new URL(speaker.src);
    expect(smartphoneUrl.pathname).toBe("/480/360/smartphone,charger");
    expect(speakerUrl.pathname).toBe("/480/360/wireless-speaker,bluetooth-speaker");
    expect(smartphoneUrl.searchParams.get("lock")).toMatch(/^[1-9]\d*$/);
    expect(smartphoneUrl.searchParams.get("random")).toBe(smartphoneUrl.searchParams.get("lock"));
    expect(speakerUrl.searchParams.get("random")).toBe(speakerUrl.searchParams.get("lock"));
    expect(speaker.src).not.toBe(smartphone.src);
  });

  it("never contacts the imagined origin when it is the placeholder provider", async () => {
    let fetched = false;
    const resolver = new TagPlaceholderResolver({
      fetchExternal: true,
      safeContent: true,
      excludedOrigins: ["https://loremflickr.com"],
      fetchImplementation: async () => {
        fetched = true;
        return new Response();
      },
    });
    const result = await resolver.resolve(
      { query: "city", alt: "City", aspect: "16/9", index: 0, artifactSeed: "excluded" },
      new AbortController().signal,
    );

    expect(fetched).toBe(false);
    expect(result.source).toBe("tag-placeholder");
    expect(result.omitted).toBe(true);
    expect(result.warning?.code).toBe("image-provider-origin-excluded");
  });

  it("does not follow an allowlisted redirect into the imagined origin", async () => {
    const requested: string[] = [];
    const resolver = new TagPlaceholderResolver({
      fetchExternal: true,
      safeContent: true,
      excludedOrigins: ["https://live.staticflickr.com"],
      fetchImplementation: async (input) => {
        requested.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "https://live.staticflickr.com/1/excluded.jpg" },
        });
      },
    });
    const result = await resolver.resolve(
      { query: "forest", alt: "Forest", aspect: "16/9", index: 0, artifactSeed: "redirect" },
      new AbortController().signal,
    );

    expect(requested).toHaveLength(1);
    expect(result.source).toBe("tag-placeholder");
    expect(result.omitted).toBe(true);
    expect(result.warning?.code).toBe("image-provider-origin-excluded");
  });

  it("caps 200 image intents and resolves them with bounded fetch concurrency", async () => {
    let fetches = 0;
    let active = 0;
    let peak = 0;
    const resolver = new TagPlaceholderResolver({
      fetchExternal: true,
      safeContent: true,
      fetchImplementation: async () => {
        fetches += 1;
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 3));
        active -= 1;
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(bytes.byteLength),
          },
        });
      },
    });
    const settings = {
      ...generationCommand().settings,
      images: { mode: "tag-placeholder" as const, fetchExternal: true, safeContent: true },
    };
    const images = Array.from(
      { length: 200 },
      (_, index) => `<img data-vibe-image="item ${index}" alt="Item ${index}">`,
    ).join("");
    const transformed = await transformHtml({
      html: `<!doctype html><html><head><title>Many images</title></head><body>${images}</body></html>`,
      url: "https://example.com/gallery",
      title: "Many images",
      settings,
      artifactSeed: "many-images",
      signal: new AbortController().signal,
      imageResolver: resolver,
    });

    expect(fetches).toBe(MAX_IMAGE_INTENTS);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(MAX_IMAGE_RESOLUTION_CONCURRENCY);
    expect(transformed.html.match(/<img\b/g)).toHaveLength(MAX_IMAGE_INTENTS);
    expect(transformed.warnings).toContainEqual(expect.objectContaining({ code: "image-intents-capped" }));
  });

  it("keeps embedded LoremFlickr images inside the final artifact budget", async () => {
    const resolver = new TagPlaceholderResolver({
      fetchExternal: true,
      safeContent: true,
      fetchImplementation: async () => new Response(new Uint8Array(40_000), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "40000" },
      }),
    });
    const settings = {
      ...generationCommand().settings,
      maxArtifactBytes: 200_000,
      images: { mode: "tag-placeholder" as const, fetchExternal: true, safeContent: true },
    };
    const images = Array.from(
      { length: MAX_IMAGE_INTENTS },
      (_, index) => `<img data-vibe-image="thumbnail ${index}" alt="Thumbnail ${index}">`,
    ).join("");
    const transformed = await transformHtml({
      html: `<!doctype html><html><head><title>Budget</title></head><body>${images}</body></html>`,
      url: "https://example.com/feed",
      title: "Budget",
      settings,
      artifactSeed: "image-budget",
      signal: new AbortController().signal,
      imageResolver: resolver,
    });

    const retainedImages = transformed.html.match(/<img\b/g)?.length ?? 0;
    expect(Buffer.byteLength(transformed.html, "utf8")).toBeLessThan(settings.maxArtifactBytes);
    expect(retainedImages).toBeGreaterThan(0);
    expect(retainedImages).toBeLessThan(MAX_IMAGE_INTENTS);
    expect(transformed.warnings).toContainEqual(expect.objectContaining({ code: "image-artifact-budget" }));
  });

  it("aborts an oversized chunked image before materializing the full response", async () => {
    const totalChunks = 40;
    const chunkSize = Math.floor(MAX_EXTERNAL_IMAGE_BYTES / 4) + 1;
    let pulls = 0;
    let cancelled = false;
    let requestSignal: AbortSignal | null | undefined;
    const resolver = new TagPlaceholderResolver({
      fetchExternal: true,
      safeContent: true,
      fetchImplementation: async (_input, init) => {
        requestSignal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            if (pulls > totalChunks) {
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(chunkSize));
          },
          cancel() {
            cancelled = true;
          },
        }, { highWaterMark: 0 });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      },
    });
    const result = await resolver.resolve(
      { query: "oversized", alt: "Oversized", aspect: "16/9", index: 0, artifactSeed: "oversized" },
      new AbortController().signal,
    );

    expect(result.source).toBe("tag-placeholder");
    expect(result.omitted).toBe(true);
    expect(result.warning?.code).toBe("image-resolution-failed");
    expect(cancelled).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(pulls).toBeLessThan(totalChunks);
  });

  it("filters arbitrary Tailwind URLs and bounds model-supplied candidates", async () => {
    const attack = "bg-[url(https://attacker.test/pixel)]";
    const tooLong = "x".repeat(MAX_TAILWIND_CANDIDATE_LENGTH + 1);
    const candidates = [
      attack,
      "text-slate-950",
      tooLong,
      ...Array.from({ length: MAX_TAILWIND_CANDIDATES + 32 }, (_, index) => `safe-${index}`),
    ];
    const filtered = filterTailwindCandidates(candidates);

    expect(filtered.candidates).not.toContain(attack);
    expect(filtered.candidates).not.toContain(tooLong);
    expect(filtered.candidates.length).toBe(MAX_TAILWIND_CANDIDATES);
    expect(filtered).toMatchObject({ rejected: true, truncated: true });

    const compiled = await compileTailwind([attack, "text-slate-950"]);
    expect(compiled.usedFallback).toBe(false);
    expect(compiled.warning?.code).toBe("style-candidates-filtered");
    expect(compiled.css).not.toContain("attacker.test");
    expect(compiled.css).not.toMatch(/url\s*\(/i);
    expect(compiled.css).toContain(".text-slate-950");
  });

  it("compiles the full stock Tailwind theme without imposing an application theme", async () => {
    const compiled = await compileTailwind([
      "bg-red-600",
      "text-zinc-950",
      "font-serif",
      "font-[Arial,_Helvetica,_sans-serif]",
      "grid-cols-[240px_1fr]",
      "bg-[#ff0000]",
    ]);

    expect(compiled.usedFallback).toBe(false);
    expect(compiled.css).toContain(".bg-red-600");
    expect(compiled.css).toContain(".text-zinc-950");
    expect(compiled.css).toContain("font-family: Arial, Helvetica, sans-serif");
    expect(compiled.css).toContain("grid-template-columns: 240px 1fr");
    expect(compiled.css).not.toContain("--vs-");
    expect(compiled.css).not.toContain("1120px");
    expect(compiled.css).not.toContain("Inter");
  });

  it("repairs escaped formatting text and hides unresolved preview image alt text", async () => {
    const settings = { ...generationCommand().settings, tailwindEnabled: true };
    const preview = await transformPreviewHtml({
      html: '<!doctype html><html><head><title>Preview</title></head><body class="font-serif">\\n\\n<h1>Яндекс</h1>\\n<img data-vibe-image="city" alt="City thumbnail"></body></html>',
      url: "https://yandex.ru/",
      title: "Preview",
      settings,
    });

    expect(preview).not.toContain("\\n");
    expect(preview).toContain("<h1>Яндекс</h1>");
    expect(preview).toContain("img[data-vibe-image]:not([src]){visibility:hidden}");
    expect(preview).not.toContain("--vs-");
  });

  it("repairs escaped formatting inside authored CSS in previews and final artifacts", async () => {
    const settings = { ...generationCommand().settings, tailwindEnabled: false };
    const html = '<!doctype html><html><head><title>Cocktails</title><style>\\n:root { --bg: #f8fafc; }\\nbody { margin: 0; background: var(--bg); font-family: Manrope, Arial, sans-serif; }\\n.card { display: grid; grid-template-columns: 18rem 1fr; }\\n</style></head><body><main class="card">Cocktails</main></body></html>';
    const input = {
      html,
      url: "https://cocktails.ru/search?q=low+carb",
      title: "Cocktails",
      settings,
    };

    const preview = await transformPreviewHtml(input);
    const final = await transformHtml({
      ...input,
      artifactSeed: "cocktails-css-regression",
      signal: new AbortController().signal,
    });

    for (const document of [preview, final.html]) {
      expect(document).not.toContain("\\n");
      expect(document).toContain(":root { --bg: #f8fafc; }");
      expect(document).toContain("body { margin: 0; background: var(--bg)");
      expect(document).toContain(".card { display: grid; grid-template-columns: 18rem 1fr; }");
    }
  });

  it("repairs repeated JSON-style quote escaping before parsing attributes and links", async () => {
    const settings = {
      ...generationCommand().settings,
      tailwindEnabled: false,
      minInternalLinks: 0,
    };
    const html = String.raw`<!doctype html><html lang=\"ru\"><head><title>Wildberries</title><style>body{font-family:\"Tahoma\",sans-serif}</style></head><body><a class=\"skip-link\" href=\"/catalog/0/detail.aspx?cardId=845121\">Товар</a><form action=\"/catalog/0/search.aspx\"><input name=\"search\"></form></body></html>`;
    const input = {
      html,
      url: "https://wildberries.ru/catalog/0/search.aspx?search=sale",
      title: "Wildberries",
      settings,
    };

    const preview = await transformPreviewHtml(input);
    const final = await transformHtml({
      ...input,
      artifactSeed: "escaped-quotes-regression",
      signal: new AbortController().signal,
    });

    for (const document of [preview, final.html]) {
      expect(document).toContain('lang="ru"');
      expect(document).toContain('class="skip-link"');
      expect(document).toContain('href="https://wildberries.ru/catalog/0/detail.aspx?cardId=845121"');
      expect(document).toContain('action="https://wildberries.ru/catalog/0/search.aspx"');
      expect(document).toContain('font-family:"Tahoma",sans-serif');
      expect(document).not.toMatch(/\\&quot;|\/%22|\\%22/);
    }
    expect(final.warnings).toContainEqual(expect.objectContaining({ code: "escaped-html-quotes-repaired" }));
    expect(validateHtml(final.html, input.url, settings).valid).toBe(true);
  });

  it("repairs literal formatting escapes inside tag markup before parsing", async () => {
    const settings = {
      ...generationCommand().settings,
      tailwindEnabled: false,
      minInternalLinks: 0,
    };
    const malformed = String.raw`<!doctype html><html><head><title>Escaped tags</title></head><body><form action="/search"><input\n id="q" \n name="query" value="sale"><button\n type="submit" \n class="find">Find</button\n></input\n></form></body></html>`;
    const transformed = await transformHtml({
      html: malformed,
      url: "https://example.com/",
      title: "Escaped tags",
      settings,
      artifactSeed: "escaped-tag-formatting",
      signal: new AbortController().signal,
    });

    expect(transformed.html).toContain('<input id="q" name="query" value="sale">');
    expect(transformed.html).toContain('<button type="submit" class="find">Find</button>');
    expect(transformed.html).not.toContain("button\\n");
    expect(transformed.warnings).toContainEqual(expect.objectContaining({ code: "escaped-html-formatting-repaired" }));
  });

  it("rejects encoded quote remnants in navigation URLs", () => {
    const settings = {
      ...generationCommand().settings,
      tailwindEnabled: false,
      minInternalLinks: 0,
    };
    const html = String.raw`<!doctype html><html><head><title>Broken URL</title><meta name="viewport" content="width=device-width"></head><body><a href="https://wildberries.ru/%22/catalog/0/detail.aspx?cardId=845121\%22">Товар</a><a href="/search?q=%22sale%22">Quoted search</a></body></html>`;
    const validation = validateHtml(html, "https://wildberries.ru/", settings);

    expect(validation.valid).toBe(false);
    expect(validation.issues.filter((issue) => issue.code === "malformed-link-escaping")).toHaveLength(1);
  });

  it("keeps inline classic JavaScript only in opted-in final artifacts", async () => {
    const html = `<!doctype html><html><head><title>Interactive</title></head><body>
      <button id="toggle" onclick="steal()">Toggle</button>
      <script src="https://attacker.test/external.js"></script>
      <script type="module">window.moduleRan = true</script>
      <script data-model-attribute="removed">document.querySelector("#toggle").addEventListener("click", () => document.body.classList.toggle("open"));</script>
      ${links()}
    </body></html>`;
    const base = generationCommand().settings;
    const enabled = { ...base, allowGeneratedScripts: true };

    const preview = await transformPreviewHtml({
      html,
      url: "https://example.com/interactive",
      title: "Interactive",
      settings: enabled,
    });
    const disabledFinal = await transformHtml({
      html,
      url: "https://example.com/interactive",
      title: "Interactive",
      settings: base,
      artifactSeed: "scripts-disabled",
      signal: new AbortController().signal,
    });
    const enabledFinal = await transformHtml({
      html,
      url: "https://example.com/interactive",
      title: "Interactive",
      settings: enabled,
      artifactSeed: "scripts-enabled",
      signal: new AbortController().signal,
    });

    expect(preview).not.toContain("<script");
    expect(disabledFinal.html).not.toContain("<script");
    expect(enabledFinal.html).toContain('<script>document.querySelector("#toggle")');
    expect(enabledFinal.html).not.toContain("attacker.test");
    expect(enabledFinal.html).not.toContain("type=\"module\"");
    expect(enabledFinal.html).not.toContain("onclick=");
    expect(validateHtml(enabledFinal.html, "https://example.com/interactive", enabled).valid).toBe(true);
  });

  it("sanitizes imports and network-bearing functions from compiled CSS", () => {
    const sanitized = sanitizeCompiledCss(`
      @import url("https://attacker.test/import.css");
      .safe { color: red; background-image: url(https://attacker.test/pixel); }
      .legacy { width: expression(alert(1)); behavior: url(evil.htc); }
    `);

    expect(sanitized).toContain("color: red");
    expect(sanitized).not.toContain("attacker.test");
    expect(sanitized).not.toMatch(/@import\b/i);
    expect(sanitized).not.toMatch(/(?:url|expression)\s*\(/i);
    expect(sanitized).not.toMatch(/behavior\s*:/i);
  });

  it("rejects redirects from the placeholder service to private or untrusted hosts", async () => {
    const requested: string[] = [];
    const resolver = new TagPlaceholderResolver({
      fetchExternal: true,
      safeContent: true,
      fetchImplementation: async (input) => {
        requested.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:8080/private" },
        });
      },
    });
    const result = await resolver.resolve(
      { query: "forest", alt: "Forest", aspect: "16/9", index: 0, artifactSeed: "a" },
      new AbortController().signal,
    );
    expect(requested).toHaveLength(1);
    expect(result.source).toBe("tag-placeholder");
    expect(result.omitted).toBe(true);
    expect(result.warning?.code).toBe("image-resolution-failed");
  });
});
