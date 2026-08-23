// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import {
  compileGeneratedArtifactDocument,
  encodeBridgeNonce,
} from "../../src/artifacts/document";
import frameRuntimeSource from "../../src/artifacts/frame-runtime.js?raw";
import {
  artifactFrameRuntimeHash,
  injectArtifactFrameRuntime,
} from "../../vite.config";

const nonce = "0123456789abcdef01234567";

describe("generated artifact document compiler", () => {
  test("sets the host-selected browser theme and replaces an artifact-authored value", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "theme-fixture",
      url: "https://safe.example/",
      title: "Themed",
      nonce,
      browserTheme: "ie-classic",
      html: '<html data-vibesurfer-browser-theme="cyberpunk"><body><input type="checkbox"></body></html>',
    });

    expect(parse(result.payload.html).documentElement.getAttribute("data-vibesurfer-browser-theme"))
      .toBe("ie-classic");
  });

  test("removes active content and emits only passive sanitized markup", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "security-fixture",
      url: "https://safe.example/root",
      title: "Safe title",
      nonce,
      html: `<!doctype html>
        <html><head>
          <base href="https://attacker.example/">
          <meta http-equiv="refresh" content="0;url=https://attacker.example">
          <meta http-equiv="Content-Security-Policy" content="default-src *">
          <link rel="stylesheet" href="https://attacker.example/styles.css">
          <script src="https://attacker.example/code.js"></script>
          <script>window.compromised = true</script>
        </head><body onload="window.compromised = true">
          <iframe src="https://attacker.example"></iframe>
          <object data="https://attacker.example"></object>
          <embed src="https://attacker.example/plugin">
          <template><script>window.compromised = true</script></template>
          <a id="bad" href="javascript:alert(1)" onclick="alert(1)">Bad</a>
        </body></html>`,
    });
    const document = parse(result.payload.html);

    expect(document.querySelectorAll("script, base, iframe, object, embed, template, link")).toHaveLength(0);
    expect(document.querySelectorAll('meta[http-equiv]')).toHaveLength(0);
    expect(document.body.hasAttribute("onload")).toBe(false);
    expect(document.querySelector("#bad")?.hasAttribute("href")).toBe(false);
    expect(document.querySelector("#bad")?.hasAttribute("onclick")).toBe(false);
    expect(result.payload).toMatchObject({ pageUrl: "https://safe.example/root", title: "Safe title" });
    expect(result.warnings).toContainEqual({ code: "removed-element", count: 7 });
  });

  test("normalizes safe routes and removes network-bearing resources and CSS", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "url-fixture",
      url: "https://safe.example/products/current?view=grid",
      title: "Catalog",
      nonce,
      html: `<html><head><style>
        @import url("https://attacker.example/theme.css");
        .remote { background: url(https://attacker.example/pixel); }
        .inline { background: url(data:image/png;base64,AA==); }
      </style></head><body>
        <a id="relative" href="../news">News</a>
        <a id="hash" href="#details">Details</a>
        <a id="quoted-search" href="/search?q=%22sale%22">Quoted search</a>
        <a id="credentials" href="https://user:secret@safe.example/private">Private</a>
        <img id="remote-image" src="https://attacker.example/pixel.png" srcset="https://attacker.example/2x.png 2x">
        <img id="loremflickr-image" src="https://loremflickr.com/640/480/city?lock=1">
        <img id="inline-image" src="data:image/png;base64,AA==">
        <form id="search" action="/search" target="_top"><input name="q"></form>
      </body></html>`,
    });
    const document = parse(result.payload.html);

    expect(document.querySelector("#relative")?.getAttribute("href")).toBe("https://safe.example/news");
    expect(document.querySelector("#hash")?.getAttribute("href")).toBe("#details");
    expect(document.querySelector("#quoted-search")?.getAttribute("href")).toBe("https://safe.example/search?q=%22sale%22");
    expect(document.querySelector("#credentials")?.hasAttribute("href")).toBe(false);
    expect(document.querySelector("#remote-image")?.hasAttribute("src")).toBe(false);
    expect(document.querySelector("#remote-image")?.hasAttribute("srcset")).toBe(false);
    expect(document.querySelector("#loremflickr-image")?.getAttribute("src")).toBe("https://loremflickr.com/640/480/city?lock=1");
    expect(document.querySelector("#inline-image")?.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(document.querySelector("#search")?.getAttribute("action")).toBe("https://safe.example/search");
    expect(document.querySelector("#search")?.hasAttribute("target")).toBe(false);
    expect(document.querySelector("style")?.textContent).not.toContain("@import");
    expect(document.querySelector("style")?.textContent).not.toContain("attacker.example");
  });

  test("routes allowlisted desktop images through the native cache protocol", () => {
    window.__TAURI_INTERNALS__ = {} as typeof window.__TAURI_INTERNALS__;
    try {
      const source = "https://loremflickr.com/640/480/city?lock=1";
      const result = compileGeneratedArtifactDocument({
        artifactId: "native-image-fixture",
        url: "https://safe.example/",
        title: "Native image",
        nonce,
        html: `<img id="cached" src="${source}">`,
      });
      const value = parse(result.payload.html).querySelector("#cached")?.getAttribute("src") ?? "";
      expect(value).toMatch(/^vibeasset:\/\/localhost\/image\/[A-Za-z0-9_-]+$/);
      const encoded = value.split("/").at(-1)!.replace(/-/g, "+").replace(/_/g, "/");
      expect(atob(encoded)).toBe(source);
      expect(result.warnings).toContainEqual({ code: "rewrote-url", count: 1 });
    } finally {
      delete window.__TAURI_INTERNALS__;
    }
  });

  test("keeps compiled Iconify SVG markup and license relationship tokens", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "iconify-fixture",
      url: "https://safe.example/",
      title: "Iconify",
      nonce,
      html: `<html><body>
        <iconify-icon icon="streamline-cyber:account" aria-hidden="true" data-iconify-rendered>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1 1h22v22H1z"></path></svg>
        </iconify-icon>
        <small data-iconify-attribution>Icons by <a href="https://example.com/license" rel="license">Example</a></small>
      </body></html>`,
    });
    const document = parse(result.payload.html);

    expect(document.querySelector("iconify-icon[data-iconify-rendered] svg path")).not.toBeNull();
    expect(document.querySelector("[data-iconify-attribution] a")?.getAttribute("rel")).toBe("license noopener noreferrer");
  });

  test("repairs escaped formatting in persisted artifact CSS before rendering", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "escaped-css-fixture",
      url: "https://cocktails.ru/search?q=low+carb",
      title: "Cocktails",
      nonce,
      html: '<html><head><style>\\n:root { --bg: #f8fafc; }\\nbody { margin: 0; background: var(--bg); }\\n</style></head><body>\\n<main class="results">Cocktails</main>\\n</body></html>',
    });
    const document = parse(result.payload.html);
    const style = document.querySelector("style")?.textContent ?? "";

    expect(result.payload.html).not.toContain("\\n");
    expect(style).toContain("\n:root { --bg: #f8fafc; }\n");
    expect(style).toContain("body { margin: 0; background: var(--bg); }");
    expect(document.body.textContent).toContain("\nCocktails\n");
  });

  test("repairs escaped formatting inside persisted tag markup before parsing", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "escaped-tag-fixture",
      url: "https://wildberries.ru/search",
      title: "Escaped tags",
      nonce,
      html: String.raw`<form action="/search"><input\n id="q" \n name="query"><button\n type="submit">Найти</button\n></input\n></form>`,
    });
    const document = parse(result.payload.html);

    expect(document.querySelector("input")?.getAttribute("name")).toBe("query");
    expect(document.querySelector("button")?.textContent).toBe("Найти");
    expect(result.payload.html).not.toContain("button\\n");
  });

  test("repairs legacy attributes and URLs serialized after escaped model quotes", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "escaped-attributes-fixture",
      url: "https://wildberries.ru/catalog/0/search.aspx?search=sale",
      title: "Wildberries",
      nonce,
      html: String.raw`<html lang="\&quot;ru\&quot;"><head><style>body{font-family:\"Tahoma\",sans-serif}</style><meta name="\&quot;viewport\&quot;" content="\&quot;width=device-width," initial-scale="1\&quot;"></head><body><div class="\&quot;container" top-row\"=""><nav aria-label="\&quot;Профиль" и="" заказы\"=""><a id="item" href="https://wildberries.ru/%22/catalog/0/detail.aspx?cardId=845121\%22">Товар</a></nav></div></body></html>`,
    });
    const document = parse(result.payload.html);

    expect(document.documentElement.lang).toBe("ru");
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content"))
      .toBe("width=device-width, initial-scale=1");
    expect(document.querySelector("div")?.className).toBe("container top-row");
    expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe("Профиль и заказы");
    expect(document.querySelector("#item")?.getAttribute("href"))
      .toBe("https://wildberries.ru/catalog/0/detail.aspx?cardId=845121");
    expect(document.querySelector("style")?.textContent).toContain('font-family:"Tahoma",sans-serif');
    expect(result.payload.html).not.toMatch(/\\&quot;|\/%22|\\%22/);
    expect(result.warnings).toContainEqual({ code: "rewrote-url", count: 1 });
  });

  test("repairs a trailing encoded quote only when it resolves to the current page", () => {
    const result = compileGeneratedArtifactDocument({
      artifactId: "trailing-self-link-quote",
      url: "https://wildberries.ru/catalog/0/detail.aspx?cardId=845121",
      title: "Wildberries",
      nonce,
      html: `<a id="self" href="https://wildberries.ru/catalog/0/detail.aspx?cardId=845121%22">Self</a>
        <a id="quoted-search" href="/search?q=%22sale%22">Quoted search</a>`,
    });
    const document = parse(result.payload.html);

    expect(document.querySelector("#self")?.getAttribute("href"))
      .toBe("https://wildberries.ru/catalog/0/detail.aspx?cardId=845121");
    expect(document.querySelector("#quoted-search")?.getAttribute("href"))
      .toBe("https://wildberries.ru/search?q=%22sale%22");
  });

  test("preserves only inline classic scripts for explicitly opted-in artifacts", () => {
    const html = `<html><head><title>Interactive</title></head><body>
      <button id="toggle" onclick="window.bad=true">Toggle</button>
      <script src="https://attacker.example/external.js"></script>
      <script type="module">window.moduleRan=true</script>
      <script data-model="remove-me">document.body.dataset.interactive = "true";</script>
    </body></html>`;
    const disabled = compileGeneratedArtifactDocument({
      artifactId: "scripts-disabled",
      url: "https://safe.example/",
      title: "Disabled",
      nonce,
      html,
    });
    const enabled = compileGeneratedArtifactDocument({
      artifactId: "scripts-enabled",
      url: "https://safe.example/",
      title: "Enabled",
      nonce,
      html,
      allowGeneratedScripts: true,
    });
    const enabledDocument = parse(enabled.payload.html);

    expect(disabled.payload.executeScripts).toBe(false);
    expect(parse(disabled.payload.html).querySelectorAll("script")).toHaveLength(0);
    expect(enabled.payload.executeScripts).toBe(true);
    expect(enabledDocument.querySelectorAll("script")).toHaveLength(1);
    expect(enabledDocument.querySelector("script")?.hasAttribute("data-model")).toBe(false);
    expect(enabledDocument.querySelector("script")?.textContent).toContain("dataset.interactive");
    expect(enabledDocument.querySelector("#toggle")?.hasAttribute("onclick")).toBe(false);
    expect(enabled.payload.html).not.toContain("attacker.example");
  });

  test("uses base64url for hostile nonce bytes and for generated identities", () => {
    expect(encodeBridgeNonce(Uint8Array.from([0xfb, 0xff, 0xff]))).toBe("-___");
    const result = compileGeneratedArtifactDocument({
      artifactId: "nonce-fixture",
      url: "https://safe.example/",
      title: "Nonce fixture",
      html: "<main>Content</main>",
    });
    expect(result.nonce).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  test("pins the self-contained shell runtime bytes in both CSP layers", () => {
    const shellTemplate = readFileSync(resolve(process.cwd(), "artifact-frame.html"), "utf8");
    const shell = injectArtifactFrameRuntime(shellTemplate);
    const document = parse(shell);
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script"));
    const runtimeBytes = scripts[0]?.textContent ?? "";
    const computedHash = `sha256-${createHash("sha256").update(runtimeBytes, "utf8").digest("base64")}`;
    const innerCsp = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content ?? "";
    const innerScriptSources = scriptSources(innerCsp);
    const outerScriptSources = scriptSources(tauriConfig.app.security.csp);

    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.hasAttribute("src")).toBe(false);
    expect(runtimeBytes).toBe(frameRuntimeSource);
    expect(frameRuntimeSource.toLowerCase()).not.toContain("</script");
    expect(computedHash).toBe(artifactFrameRuntimeHash);
    expect(innerScriptSources).toBe(`script-src '${computedHash}' 'nonce-dmliaWVzdXJmZXItYXJ0aWZhY3Q'`);
    expect(outerScriptSources).toContain(`'${computedHash}'`);
    expect(outerScriptSources).not.toMatch(/'unsafe-inline'|\bdata:|\bblob:/);
    expect(document.querySelectorAll("script[src], iframe, object, embed")).toHaveLength(0);
    const runtimeStylesheet = document.querySelector<HTMLLinkElement>("link[data-vibesurfer-artifact-runtime]");
    expect(document.querySelectorAll("link[href]")).toHaveLength(1);
    expect(runtimeStylesheet?.getAttribute("rel")).toBe("stylesheet");
    expect(runtimeStylesheet?.getAttribute("href")).toBe("/src/artifacts/artifact-base.css");
  });

  test("rejects an oversized bridge identity instead of truncating the handshake contract", () => {
    expect(() => compileGeneratedArtifactDocument({
      artifactId: "a".repeat(513),
      url: "https://safe.example/",
      title: "Identity fixture",
      nonce,
      html: "<main>Content</main>",
    })).toThrow("Artifact identity is invalid");
  });
});

function parse(value: string) {
  return new DOMParser().parseFromString(value, "text/html");
}

function scriptSources(csp: string) {
  return csp.split(";").map((directive) => directive.trim()).find((directive) => directive.startsWith("script-src ")) ?? "";
}
