// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// jsdom is the Vitest DOM runtime dependency, but it does not ship TypeScript declarations.
// @ts-expect-error -- runtime-only test harness import
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, test, vi } from "vitest";
import {
  ARTIFACT_BRIDGE_PROTOCOL,
  ARTIFACT_BRIDGE_VERSION,
  MAX_ARTIFACT_RENDER_BYTES,
} from "../../src/artifacts/bridge-protocol";
import { injectArtifactFrameRuntime } from "../../vite.config";

const identity = {
  artifactId: "artifact-runtime-fixture",
  nonce: "base64url_nonce-fixture",
};

describe("artifact frame runtime", () => {
  test("renders one sanitized payload over its private port and preserves virtual navigation", () => {
    const harness = createRuntimeHarness();

    try {
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      expect(bootstrap).toMatchObject({
        protocol: ARTIFACT_BRIDGE_PROTOCOL,
        version: ARTIFACT_BRIDGE_VERSION,
        type: "bootstrap-ready",
        ...identity,
      });
      expect(bootstrap.instanceId).toMatch(/^[A-Za-z0-9_-]{24}$/);

      const port = new FakeMessagePort();
      harness.window.dispatchEvent(new harness.window.MessageEvent("message", {
        data: {
          protocol: ARTIFACT_BRIDGE_PROTOCOL,
          version: ARTIFACT_BRIDGE_VERSION,
          type: "init",
          instanceId: bootstrap.instanceId,
          ...identity,
        },
        source: harness.window,
        ports: [port as unknown as MessagePort],
      }));

      expect(port.start).toHaveBeenCalledOnce();
      expect(port.messages).toContainEqual(expect.objectContaining({
        type: "ready-for-render",
        ...identity,
      }));

      port.dispatch(renderCommand({
        title: "Oversized",
        html: "x".repeat(MAX_ARTIFACT_RENDER_BYTES + 1),
      }));
      expect(port.messages).toContainEqual(expect.objectContaining({
        type: "runtime-error",
        message: "The artifact render payload was rejected.",
      }));
      expect(harness.document.querySelector("#safe-content")).toBeNull();

      port.dispatch(renderCommand({
        title: "Safe rendered title",
        html: hostileArtifactHtml,
      }));

      const { document } = harness;
      expect(document.title).toBe("Safe rendered title");
      expect(document.documentElement).toHaveAttribute("lang", "en");
      expect(document.documentElement).toHaveAttribute("dir", "ltr");
      expect(document.documentElement).toHaveClass("artifact-theme");
      expect(document.body).toHaveClass("artifact-body");
      expect(document.querySelector("#safe-content")).toHaveTextContent("Safe content");

      expect(document.querySelectorAll(
        "script, base, object, embed, iframe, frame, frameset, applet, portal, template, foreignObject, link",
      )).toHaveLength(0);
      expect(document.querySelectorAll('meta[http-equiv="refresh"]')).toHaveLength(0);
      expect(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
      expect(Array.from(document.querySelectorAll("*")).some((element) =>
        Array.from(element.attributes).some((attribute) => attribute.name.toLowerCase().startsWith("on")),
      )).toBe(false);

      const remoteImage = document.querySelector("#remote-image");
      expect(remoteImage).not.toHaveAttribute("src");
      expect(remoteImage).not.toHaveAttribute("srcset");
      expect(document.querySelector("#inline-image")).toHaveAttribute("src", "data:image/png;base64,AA==");
      expect(document.querySelector("#javascript-link")).not.toHaveAttribute("href");
      expect((harness.window as Window & { compromised?: boolean }).compromised).toBeUndefined();

      const styles = Array.from(document.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");
      expect(styles).toContain(".safe-card");
      expect(styles).not.toContain("@import");
      expect(styles).not.toContain("attacker.example");
      expect(document.documentElement.getAttribute("style")).not.toContain("attacker.example");
      expect(document.body.getAttribute("style")).not.toContain("attacker.example");

      expect(port.messages).toContainEqual(expect.objectContaining({
        type: "ready",
        title: "Safe rendered title",
        ...identity,
      }));

      const renderedBody = document.body.innerHTML;
      const readyCount = port.messages.filter((message) => message.type === "ready").length;
      port.dispatch(renderCommand({
        title: "Second render must be ignored",
        html: "<main id=second-render>Replaced</main>",
      }));
      expect(document.title).toBe("Safe rendered title");
      expect(document.body.innerHTML).toBe(renderedBody);
      expect(document.querySelector("#second-render")).toBeNull();
      expect(port.messages.filter((message) => message.type === "ready")).toHaveLength(readyCount);

      document.querySelector("#next-link")?.dispatchEvent(new harness.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }));
      expect(port.messages).toContainEqual(expect.objectContaining({
        type: "navigate",
        href: "https://safe.example/next?q=1",
        disposition: "current",
        linkText: "Next page",
        ...identity,
      }));
      expect(harness.jsdomErrors).toEqual([]);
    } finally {
      harness.close();
    }
  });
});

const hostileArtifactHtml = `<!doctype html>
<html lang="en" dir="ltr" class="artifact-theme" style="color: rgb(12, 34, 56); background: url(https://attacker.example/root.png)">
  <head>
    <title>Untrusted title</title>
    <meta http-equiv="refresh" content="0;url=https://attacker.example/refresh">
    <meta http-equiv="Content-Security-Policy" content="default-src *">
    <link rel="stylesheet" href="https://attacker.example/theme.css">
    <style>
      @import url("https://attacker.example/import.css");
      .safe-card { color: rgb(1, 2, 3); }
      .remote-css { background: url(https://attacker.example/pixel.png); }
    </style>
  </head>
  <body class="artifact-body" onload="window.compromised=true" style="margin: 0; background: url(https://attacker.example/body.png)">
    <script>window.compromised=true</script>
    <base href="https://attacker.example/">
    <iframe src="https://attacker.example/frame"></iframe>
    <object data="https://attacker.example/object"></object>
    <embed src="https://attacker.example/embed">
    <template><img src=x onerror="window.compromised=true"></template>
    <svg onload="window.compromised=true"><foreignObject><script>window.compromised=true</script></foreignObject></svg>
    <main id="safe-content" class="safe-card">
      <article>
        <p>Safe content</p>
        <a id="next-link" href="/next?q=1" onclick="window.compromised=true">Next page</a>
      </article>
      <a id="javascript-link" href="javascript:window.compromised=true">Unsafe route</a>
      <img id="remote-image" src="https://attacker.example/image.png" srcset="https://attacker.example/2x.png 2x" onerror="window.compromised=true">
      <img id="inline-image" src="data:image/png;base64,AA==">
    </main>
  </body>
</html>`;

function renderCommand(patch: { title: string; html: string }) {
  return {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    type: "render",
    ...identity,
    pageUrl: "https://safe.example/base/index.html",
    ...patch,
  };
}

function createRuntimeHarness() {
  const parentMessages: unknown[] = [];
  const jsdomErrors: unknown[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: unknown) => jsdomErrors.push(error));
  const shellTemplate = readFileSync(resolve(process.cwd(), "artifact-frame.html"), "utf8");
  const shell = injectArtifactFrameRuntime(shellTemplate);
  const fragment = new URLSearchParams(identity).toString();
  const dom = new JSDOM(shell, {
    url: `http://vibesurfer.test/artifact-frame.html#${fragment}`,
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(frameWindow: Window & typeof globalThis) {
      frameWindow.postMessage = ((message: unknown) => {
        parentMessages.push(message);
      }) as typeof frameWindow.postMessage;
    },
  });

  return {
    window: dom.window,
    document: dom.window.document,
    parentMessages,
    jsdomErrors,
    close: () => dom.window.close(),
  };
}

class FakeMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly messages: Array<Record<string, unknown>> = [];
  readonly start = vi.fn();
  readonly close = vi.fn();
  readonly postMessage = vi.fn((message: Record<string, unknown>) => {
    this.messages.push(message);
  });

  dispatch(data: unknown) {
    this.onmessage?.({ data });
  }
}

interface BootstrapMessage {
  protocol: typeof ARTIFACT_BRIDGE_PROTOCOL;
  version: typeof ARTIFACT_BRIDGE_VERSION;
  type: "bootstrap-ready";
  instanceId: string;
  artifactId: string;
  nonce: string;
}
