import { describe, expect, it } from "vitest";

import { compileDynamicFragment } from "../src/html/dynamic-fragment.js";
import { transformHtml } from "../src/html/transform.js";
import { parseTolerantJson, validateDynamicResult } from "../src/pipelines/dynamic.js";
import { generationCommand } from "./helpers.js";

const signal = new AbortController().signal;

describe("dynamic region compiler", () => {
  it("builds a trusted manifest, canonicalizes actions, and clamps refresh intervals", async () => {
    const settings = { ...generationCommand().settings, dynamicMode: "active" as const, minInternalLinks: 0 };
    const result = await transformHtml({
      html: `<!doctype html><title>Shop</title><body>
        <span data-vibe-bind="cart.count">0</span>
        <form data-vibe-action="state:cart.setQuantity"><input name="productId" value="sku-1"><input name="quantity" value="2"></form>
        <section data-vibe-region="cart-panel" data-vibe-refresh="2">Initial cart</section>
        <form data-vibe-action="model:cart.explain" data-vibe-target="cart-panel"><input name="question"></form>
      </body>`,
      url: "https://shop.example/cart",
      title: "Shop",
      settings,
      selectedCapabilities: ["dynamic-regions"],
      artifactSeed: "dynamic-valid",
      signal,
    });

    expect(result.dynamicManifest).toEqual({
      version: 1,
      regions: [{ id: "cart-panel", refreshSeconds: 60 }],
      actions: [
        { action: "state:cart.setQuantity", execution: "state", targets: [] },
        { action: "model:cart.explain", execution: "model", targets: ["cart-panel"] },
      ],
      bindings: ["cart.count"],
      localTabs: false,
    });
    expect(result.html).toContain('data-vibe-refresh="60"');
  });

  it("removes duplicate regions, unknown targets, bindings, and unnamespaced actions", async () => {
    const settings = { ...generationCommand().settings, dynamicMode: "active" as const, minInternalLinks: 0 };
    const result = await transformHtml({
      html: `<!doctype html><title>Invalid</title><body>
        <section data-vibe-region="thread">One</section><section data-vibe-region="thread">Two</section>
        <button data-vibe-action="refresh" data-vibe-target="missing">No</button>
        <button data-vibe-action="model:update" data-vibe-target="missing">No target</button>
        <span data-vibe-bind="identity.secret">No</span><span data-vibe-refresh="30" data-vibe-target="thread">Stray</span>
      </body>`,
      url: "https://chat.example/",
      title: "Invalid",
      settings,
      selectedCapabilities: ["dynamic-regions"],
      artifactSeed: "dynamic-invalid",
      signal,
    });
    expect(result.dynamicManifest?.regions).toEqual([{ id: "thread" }]);
    expect(result.dynamicManifest?.actions).toEqual([]);
    expect(result.dynamicManifest?.bindings).toEqual([]);
    expect(result.html).not.toContain("data-vibe-refresh");
    expect(result.html).not.toContain("data-vibe-target");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dynamic-region-invalid" }),
      expect.objectContaining({ code: "dynamic-action-invalid" }),
      expect.objectContaining({ code: "dynamic-binding-invalid" }),
    ]));
  });

  it("disables host dynamics in off mode but preserves local tab markers", async () => {
    const settings = { ...generationCommand().settings, dynamicMode: "off" as const, minInternalLinks: 0 };
    const result = await transformHtml({
      html: '<!doctype html><title>Tabs</title><body><div data-vibe-tabs><button role="tab" aria-controls="one">One</button><section id="one" role="tabpanel" data-vibe-region="live" data-vibe-refresh="60">Panel</section></div></body>',
      url: "https://example.com/tabs",
      title: "Tabs",
      settings,
      selectedCapabilities: [],
      artifactSeed: "dynamic-off",
      signal,
    });
    expect(result.dynamicManifest).toEqual({ version: 1, regions: [], actions: [], bindings: [], localTabs: true });
    expect(result.html).toContain("data-vibe-tabs");
    expect(result.html).not.toContain("data-vibe-region");
    expect(result.html).not.toContain("data-vibe-refresh");
  });
});

describe("region builder output", () => {
  it("extracts compact JSON and sanitizes fragments without minting authority", () => {
    const parsed = parseTolerantJson('```json\n{"patches":[{"regionId":"thread","html":"<p>Hi</p>"}]}\n```');
    expect(parsed.patches[0]?.html).toBe("<p>Hi</p>");
    const result = validateDynamicResult({
      patches: [{ regionId: "thread", html: '<style>bad</style><script>bad()</script><p style="color:red" data-vibe-action="model:evil"><a href="https://evil.example/">Safe text</a></p>' }],
    }, { url: "https://chat.example/", action: { action: "model:send", trigger: "action", targets: ["thread"], fields: {} } });
    expect(result.patches[0]?.html).toContain("Safe text");
    expect(result.patches[0]?.html).not.toMatch(/script|style=|data-vibe-action|evil\.example/);
    expect(() => validateDynamicResult({ patches: [{ regionId: "other", html: "<p>No</p>" }] }, {
      url: "https://chat.example/",
      action: { action: "model:send", trigger: "action", targets: ["thread"], fields: {} },
    })).toThrow("undeclared region");
  });

  it("rejects document-level fragment content and caps HTML", () => {
    expect(compileDynamicFragment("<html><head><style>x</style></head><body><p>Allowed</p></body></html>", "https://example.com/"))
      .toBe("<p>Allowed</p>");
    expect(() => compileDynamicFragment("x".repeat(64 * 1024 + 1), "https://example.com/"))
      .toThrow("64 KiB");
  });
});
