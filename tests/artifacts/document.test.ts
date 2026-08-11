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
        <a id="credentials" href="https://user:secret@safe.example/private">Private</a>
        <img id="remote-image" src="https://attacker.example/pixel.png" srcset="https://attacker.example/2x.png 2x">
        <img id="inline-image" src="data:image/png;base64,AA==">
        <form id="search" action="/search" target="_top"><input name="q"></form>
      </body></html>`,
    });
    const document = parse(result.payload.html);

    expect(document.querySelector("#relative")?.getAttribute("href")).toBe("https://safe.example/news");
    expect(document.querySelector("#hash")?.getAttribute("href")).toBe("#details");
    expect(document.querySelector("#credentials")?.hasAttribute("href")).toBe(false);
    expect(document.querySelector("#remote-image")?.hasAttribute("src")).toBe(false);
    expect(document.querySelector("#remote-image")?.hasAttribute("srcset")).toBe(false);
    expect(document.querySelector("#inline-image")?.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(document.querySelector("#search")?.getAttribute("action")).toBe("https://safe.example/search");
    expect(document.querySelector("#search")?.hasAttribute("target")).toBe(false);
    expect(document.querySelector("style")?.textContent).not.toContain("@import");
    expect(document.querySelector("style")?.textContent).not.toContain("attacker.example");
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
    expect(innerScriptSources).toBe(`script-src '${computedHash}'`);
    expect(outerScriptSources).toContain(`'${computedHash}'`);
    expect(outerScriptSources).not.toMatch(/'unsafe-inline'|\bdata:|\bblob:/);
    expect(document.querySelectorAll("script[src], link[href], iframe, object, embed")).toHaveLength(0);
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
