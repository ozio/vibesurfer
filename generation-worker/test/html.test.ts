import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_INTENTS,
  MAX_IMAGE_RESOLUTION_CONCURRENCY,
  transformHtml,
} from "../src/html/transform.js";
import {
  compileTailwind,
  filterTailwindCandidates,
  MAX_TAILWIND_CANDIDATES,
  MAX_TAILWIND_CANDIDATE_LENGTH,
  sanitizeCompiledCss,
} from "../src/html/tailwind.js";
import { validateHtml } from "../src/html/validate.js";
import {
  MAX_EXTERNAL_IMAGE_BYTES,
  TagPlaceholderResolver,
} from "../src/images/resolver.js";
import { generationCommand } from "./helpers.js";

function links(): string {
  return Array.from({ length: 12 }, (_, index) => `<a href="/route-${index}">Route ${index}</a>`).join("");
}

describe("HTML compiler", () => {
  it("strips active content, resolves images, normalizes links, and compiles Tailwind", async () => {
    const settings = { ...generationCommand().settings, tailwindEnabled: true };
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
    expect(transformed.html).toContain("data:image/svg+xml;base64,");
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
    expect(result.source).toBe("local");
    expect(result.warning?.code).toBe("external-images-disabled");
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
    expect(result.source).toBe("local");
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
    expect(result.source).toBe("local");
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

    expect(result.source).toBe("local");
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
    expect(result.source).toBe("local");
    expect(result.warning?.code).toBe("image-resolution-failed");
  });
});
