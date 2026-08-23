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
  test("renders progressive sanitized payloads over its private port and preserves virtual navigation", () => {
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
      expect(harness.window.location.hash).toBe("");

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
      expect(document.documentElement).toHaveAttribute("data-vibesurfer-browser-theme", "ie-classic");
      expect(document.body).toHaveClass("artifact-body");
      expect(document.querySelector("#safe-content")).toHaveTextContent("Safe content");

      expect(document.querySelectorAll(
        "script, base, object, embed, iframe, frame, frameset, applet, portal, template, foreignObject",
      )).toHaveLength(0);
      const runtimeStylesheet = document.querySelector<HTMLLinkElement>("link[data-vibesurfer-artifact-runtime]");
      expect(document.querySelectorAll("link[href]")).toHaveLength(1);
      expect(runtimeStylesheet).toHaveAttribute("href", "/src/artifacts/artifact-base.css");
      expect(document.querySelector('link[href*="attacker.example"]')).toBeNull();
      expect(document.querySelectorAll('meta[http-equiv="refresh"]')).toHaveLength(0);
      expect(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
      expect(Array.from(document.querySelectorAll("*")).some((element) =>
        Array.from(element.attributes).some((attribute) => attribute.name.toLowerCase().startsWith("on")),
      )).toBe(false);

      const remoteImage = document.querySelector("#remote-image");
      expect(remoteImage).not.toHaveAttribute("src");
      expect(remoteImage).not.toHaveAttribute("srcset");
      expect(document.querySelector("#loremflickr-image")).toHaveAttribute("src", "https://loremflickr.com/640/480/city?lock=1");
      expect(document.querySelector("#native-image")).toHaveAttribute("src", "vibeasset://localhost/image/aHR0cHM");
      expect(document.querySelector("#inline-image")).toHaveAttribute("src", "data:image/png;base64,AA==");
      expect(document.querySelector("#javascript-link")).not.toHaveAttribute("href");
      expect(document.querySelector("iconify-icon[data-iconify-rendered] svg path")).not.toBeNull();
      expect(document.querySelector("#icon-license")).toHaveAttribute("rel", "license noopener noreferrer");
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
      expect(port.messages.filter((message) => message.type === "link-hover")).toHaveLength(0);

      document.body.dispatchEvent(new harness.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: ",",
        metaKey: true,
      }));
      expect(port.messages).toContainEqual(expect.objectContaining({
        type: "browser-command",
        command: "open-settings",
        ...identity,
      }));

      const readyCount = port.messages.filter((message) => message.type === "ready").length;
      document.documentElement.scrollTop = 170;
      port.dispatch(renderCommand({
        title: "Streaming update",
        html: '<main id="second-render">Replaced <a id="next-link" href="/next?q=1">Next page</a></main>',
      }));
      expect(document.title).toBe("Streaming update");
      expect(document.querySelector("#second-render")).toHaveTextContent("Replaced");
      expect(document.documentElement.scrollTop).toBe(170);
      expect(port.messages.filter((message) => message.type === "ready")).toHaveLength(readyCount);

      document.querySelector("#next-link")?.dispatchEvent(new harness.window.MouseEvent("pointerover", {
        bubbles: true,
      }));
      expect(port.messages).toContainEqual(expect.objectContaining({
        type: "link-hover",
        href: "https://safe.example/next?q=1",
        ...identity,
      }));

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

  test("executes opted-in inline scripts only after the final render arrives", () => {
    const harness = createRuntimeHarness();

    try {
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
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

      const interactiveHtml = `<main><button id="interactive-button">Toggle</button></main>
        <script>window.generatedScriptRuns = (window.generatedScriptRuns || 0) + 1; document.querySelector("#interactive-button").addEventListener("click", () => { document.body.dataset.clicked = "yes"; });</script>`;
      port.dispatch(renderCommand({
        title: "Passive preview",
        html: interactiveHtml,
        executeScripts: false,
        renderMode: "preview",
      }));
      expect((harness.window as Window & { generatedScriptRuns?: number }).generatedScriptRuns).toBeUndefined();
      expect(harness.document.querySelectorAll("script:not([data-vibesurfer-frame-runtime])")).toHaveLength(0);

      port.dispatch(renderCommand({
        title: "Interactive final",
        html: interactiveHtml,
        executeScripts: true,
      }));
      expect((harness.window as Window & { generatedScriptRuns?: number }).generatedScriptRuns).toBe(1);
      harness.document.querySelector<HTMLButtonElement>("#interactive-button")?.click();
      expect(harness.document.body.dataset.clicked).toBe("yes");
      expect(harness.document.querySelectorAll("script:not([data-vibesurfer-frame-runtime])")).toHaveLength(0);
    } finally {
      harness.close();
    }
  });

  test("morphs streamed deltas while preserving node identity, focus, form state, scroll and one-shot motion", () => {
    const harness = createRuntimeHarness();
    try {
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      const port = new FakeMessagePort();
      const animate = vi.fn();
      Object.defineProperty(harness.window.Element.prototype, "animate", { configurable: true, value: animate });
      harness.window.dispatchEvent(new harness.window.MessageEvent("message", { data: { protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "init", instanceId: bootstrap.instanceId, ...identity }, source: harness.window, ports: [port as unknown as MessagePort] }));
      port.dispatch(renderCommand({ title: "Preview one", renderMode: "preview", html: '<main id="stable"><input id="query" value="model"><p id="copy" data-vibe-motion="reveal">First tokens</p></main>' }));
      const input = harness.document.querySelector<HTMLInputElement>("#query")!;
      input.focus();
      input.value = "visitor text";
      harness.document.documentElement.scrollTop = 140;
      expect(animate).toHaveBeenCalledOnce();

      port.dispatch(renderCommand({ title: "Preview two", renderMode: "preview", html: '<main id="stable"><input id="query" value="new model value"><p id="copy" data-vibe-motion="reveal">More tokens</p><aside id="new-node">Delta</aside></main>' }));
      expect(harness.document.querySelector("#query")).toBe(input);
      expect(harness.document.activeElement).toBe(input);
      expect(input.value).toBe("visitor text");
      expect(harness.document.querySelector("#copy")).toHaveTextContent("More tokens");
      expect(harness.document.querySelector("#new-node")).toHaveTextContent("Delta");
      expect(harness.document.documentElement.scrollTop).toBe(140);
      expect(animate).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });

  test("runs trusted slideshow, widget, speech, and sound capabilities without generated scripts", () => {
    const harness = createRuntimeHarness();

    try {
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      const port = new FakeMessagePort();
      const spoken: string[] = [];
      Object.defineProperty(harness.window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: class {
          text: string;
          lang = "";
          constructor(text: string) { this.text = text; }
        },
      });
      Object.defineProperty(harness.window, "speechSynthesis", {
        configurable: true,
        value: { cancel: vi.fn(), speak: vi.fn((utterance: { text: string }) => spoken.push(utterance.text)) },
      });
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

      const capabilityHtml = `<main>
        <section data-vibe-slideshow><article>First scene</article><article>Second scene</article><button id="next" data-vibe-next>Next</button></section>
        <div id="progress" data-vibe-widget="progress" data-value="62" data-max="100">62%</div>
        <article id="story">A bounded spoken story.</article><button id="speak" data-vibe-speak="#story">Read aloud</button>
      </main>`;
      port.dispatch(renderCommand({ title: "Capabilities", html: capabilityHtml, executeScripts: false }));

      expect(harness.document.querySelector("[data-vibe-slideshow] article:nth-of-type(1)")).not.toHaveAttribute("hidden");
      expect(harness.document.querySelector("[data-vibe-slideshow] article:nth-of-type(2)")).toHaveAttribute("hidden");
      expect(harness.document.querySelector("#progress")).toHaveAttribute("role", "progressbar");
      expect(harness.document.querySelector("#progress")).toHaveAttribute("aria-valuenow", "62");

      harness.document.querySelector<HTMLButtonElement>("#next")?.click();
      expect(harness.document.querySelector("[data-vibe-slideshow]")).toHaveAttribute("data-vibe-slide-index", "1");
      harness.document.querySelector<HTMLButtonElement>("#speak")?.click();
      expect(spoken).toEqual(["A bounded spoken story."]);

      port.dispatch(renderCommand({ title: "Capabilities again", html: capabilityHtml, executeScripts: false }));
      expect(harness.document.querySelector("[data-vibe-slideshow]")).toHaveAttribute("data-vibe-slide-index", "1");
      harness.document.querySelector<HTMLButtonElement>("#next")?.click();
      expect(harness.document.querySelector("[data-vibe-slideshow]")).toHaveAttribute("data-vibe-slide-index", "0");
      expect(harness.document.querySelectorAll("script:not([data-vibesurfer-frame-runtime])")).toHaveLength(0);
    } finally {
      harness.close();
    }
  });

  test("enhances carousel and poll, then drives pseudo-video only from the host media timeline", () => {
    const harness = createRuntimeHarness();
    try {
      Object.defineProperty(harness.window.navigator, "userActivation", { configurable: true, value: { isActive: true, hasBeenActive: true } });
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
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

      port.dispatch(renderCommand({
        title: "Interactive capabilities",
        executeScripts: false,
        html: `<main>
          <section id="carousel" data-vibe-carousel><article>One</article><article>Two</article><button id="carousel-next" data-vibe-next>Next</button></section>
          <section id="poll" data-vibe-widget="poll"><button id="vote-a" data-vibe-vote="A">A</button><button data-vibe-vote="B">B</button></section>
          <vibe-video id="video" data-pacing="fast" data-aspect-ratio="9:16">
            <figure data-vibe-scene data-kind="image" data-transition="crossfade" data-motion="ken-burns-in" data-duration-ms="2000" data-music-track="ambient-glass"><figcaption>First scene</figcaption><p data-vibe-narration>Measured narration.</p></figure>
            <figure data-vibe-scene data-kind="credits" data-transition="dip-black" data-motion="credits-roll" data-music-track="credits-drift"><figcaption>Second scene</figcaption></figure>
            <p data-vibe-video-caption aria-live="polite"></p>
            <div data-vibe-video-controls>
              <button id="video-toggle" type="button" data-vibe-video-action="toggle"><span data-vibe-video-visible-when="not-playing">Play</span><span data-vibe-video-visible-when="playing" hidden>Pause</span></button>
              <button type="button" data-vibe-video-action="stop">Stop</button>
              <input type="range" data-vibe-video-seek value="0">
              <output data-vibe-video-time="combined">0:00 / --:--</output>
              <button id="video-mute" type="button" data-vibe-video-action="mute"><span data-vibe-video-visible-when="unmuted">Mute</span><span data-vibe-video-visible-when="muted" hidden>Unmute</span></button>
              <input id="video-volume" type="range" data-vibe-video-volume value="1">
              <button type="button" data-vibe-video-action="skip-music" data-vibe-video-visible-when="waiting" hidden>Play without music</button>
            </div>
          </vibe-video>
        </main>`,
      }));

      const carousel = harness.document.querySelector<HTMLElement>("#carousel")!;
      const scrollBy = vi.fn();
      Object.defineProperty(carousel, "scrollBy", { configurable: true, value: scrollBy });
      harness.document.querySelector<HTMLButtonElement>("#carousel-next")!.click();
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));

      harness.document.querySelector<HTMLButtonElement>("#vote-a")!.click();
      expect(harness.document.querySelector("#poll")).toHaveAttribute("data-vibe-selection", "A");
      expect(harness.document.querySelector("#vote-a")).toHaveAttribute("aria-pressed", "true");

      const video = harness.document.querySelector("#video")!;
      expect(video).toHaveAttribute("data-aspect-ratio", "9:16");
      expect((video as HTMLElement).style.getPropertyValue("--vibe-video-aspect-ratio")).toBe("9 / 16");
      expect((video as HTMLElement).style.getPropertyPriority("--vibe-video-aspect-ratio")).toBe("important");
      expect(harness.window.customElements.get("vibe-video")).toBeDefined();
      expect(typeof (video as HTMLElement & { play(): Promise<void> }).play).toBe("function");
      const mediaEvents: string[] = [];
      for (const name of ["loadstart", "durationchange", "ready", "play", "pause", "timeupdate", "scenechange", "waiting", "volumechange", "ended", "error"]) {
        video.addEventListener(name, () => mediaEvents.push(name));
      }
      expect(video.querySelector("[data-vibe-video-controls]")).not.toBeNull();
      expect(video.querySelector('[data-vibe-video-time="combined"]')).toHaveTextContent("0:00 / --:--");
      expect(video.querySelector("[data-vibe-video-status], [data-vibe-video-transcript]")).toBeNull();
      expect(video.querySelector('[data-vibe-video-action="fullscreen"]')).toBeNull();
      expect(video.querySelector('[data-vibe-scene]:nth-of-type(1)')).not.toHaveAttribute("hidden");
      expect(video.querySelector('[data-vibe-scene]:nth-of-type(2)')).toHaveAttribute("hidden");
      const play = video.querySelector<HTMLButtonElement>("#video-toggle")!;
      const authoredToggleText = play.textContent;
      play.click();
      expect(harness.document.activeElement).toBe(play);
      expect(mediaEvents).toContain("loadstart");
      const prepare = port.messages.find((message) => message.type === "media-prepare")!;
      expect(prepare.plan).toMatchObject({
        videoId: "video",
        aspectRatio: "9:16",
        pacing: "fast",
        scenes: [
          { kind: "image", transition: "crossfade", motion: "ken-burns-in", narration: { text: "Measured narration." }, musicTrack: "ambient-glass" },
          { kind: "credits", transition: "dip-black", motion: "credits-roll", musicTrack: "credits-drift" },
        ],
      });
      expect(play).toHaveAttribute("aria-pressed", "false");
      port.dispatch({ protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "media-timeline", ...identity, requestId: prepare.requestId, timeline: { videoId: "video", durationMs: 8_000, warnings: [], scenes: [{ id: prepare.plan.scenes[0].id, startMs: 0, durationMs: 4_500, narrationDurationMs: 3_500 }, { id: prepare.plan.scenes[1].id, startMs: 4_500, durationMs: 3_500, narrationDurationMs: 0 }] } });
      expect(mediaEvents).toEqual(expect.arrayContaining(["durationchange", "ready"]));
      expect(port.messages).toContainEqual(expect.objectContaining({ type: "media-command", videoId: "video", action: "play" }));
      port.dispatch({ protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "media-state", ...identity, state: { videoId: "video", status: "playing", currentTimeMs: 0, durationMs: 8_000, paused: false, muted: false, volume: 1, activeSceneIndex: 0 } });
      expect(mediaEvents).toContain("play");
      expect(play).toHaveAttribute("aria-pressed", "true");
      expect(play.textContent).toBe(authoredToggleText);
      expect(play.querySelector('[data-vibe-video-visible-when="playing"]')).not.toHaveAttribute("hidden");
      expect(play.querySelector('[data-vibe-video-visible-when="not-playing"]')).toHaveAttribute("hidden");
      expect(video.querySelector<HTMLInputElement>("[data-vibe-video-seek]")).toHaveAttribute("max", "8000");
      expect(video.querySelector<HTMLInputElement>("[data-vibe-video-seek]")).toHaveAttribute("aria-valuemax", "8000");
      expect(video.querySelector('[data-vibe-video-time="combined"]')).toHaveTextContent("0:00 / 0:08");
      expect(video.querySelector("[data-vibe-video-caption]")).toHaveTextContent("Measured narration.");
      expect(video.querySelector("[data-vibe-video-transcript]")).toBeNull();
      expect((video as HTMLElement & { duration: number; paused: boolean; readyState: number }).duration).toBe(8);
      expect((video as HTMLElement & { duration: number; paused: boolean; readyState: number }).paused).toBe(false);
      expect((video as HTMLElement & { duration: number; paused: boolean; readyState: number }).readyState).toBe(4);
      const volumeControl = video.querySelector<HTMLInputElement>("#video-volume")!;
      volumeControl.value = "0.2";
      volumeControl.dispatchEvent(new harness.window.Event("input", { bubbles: true }));
      expect(port.messages.at(-1)).toEqual(expect.objectContaining({ type: "media-command", videoId: "video", action: "set-volume", volume: 0.2 }));
      expect(volumeControl).toHaveValue("0.2");
      (video as HTMLElement & { volume: number }).volume = 0.4;
      (video as HTMLElement & { muted: boolean }).muted = true;
      expect(port.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "media-command", videoId: "video", action: "set-volume", volume: 0.4 }),
        expect.objectContaining({ type: "media-command", videoId: "video", action: "set-muted", muted: true }),
      ]));
      port.dispatch({ protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "media-state", ...identity, state: { videoId: "video", status: "playing", currentTimeMs: 1_000, durationMs: 8_000, paused: false, muted: true, volume: 0.4, activeSceneIndex: 0 } });
      expect(mediaEvents).toContain("volumechange");
      expect(video).toHaveAttribute("data-vibe-video-muted", "true");
      expect(video.querySelector("#video-mute")).toHaveAttribute("aria-pressed", "true");
      (video as HTMLElement & { fastSeek(seconds: number): void }).fastSeek(6);
      (video as HTMLElement & { fastSeek(seconds: number): void }).fastSeek(6);
      expect(port.messages).toContainEqual(expect.objectContaining({ type: "media-command", videoId: "video", action: "seek", currentTimeMs: 6000 }));
      expect(port.messages.filter((message) => message.type === "media-command" && message.action === "seek" && message.currentTimeMs === 6000)).toHaveLength(2);
      expect(video.querySelector('[data-vibe-scene]:nth-of-type(2)')).not.toHaveAttribute("hidden");
      play.click();
      expect(port.messages).toContainEqual(expect.objectContaining({ type: "media-command", videoId: "video", action: "pause" }));
      port.dispatch({ protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "media-state", ...identity, state: { videoId: "video", status: "paused", currentTimeMs: 6_000, durationMs: 8_000, paused: true, muted: false, volume: 1, activeSceneIndex: 1 } });
      expect(mediaEvents).toContain("pause");
      expect(play).toHaveAttribute("aria-pressed", "false");
      port.dispatch({ protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "media-state", ...identity, state: { videoId: "video", status: "waiting", currentTimeMs: 6_000, durationMs: 8_000, paused: true, muted: false, volume: 1, activeSceneIndex: 1, progress: { completed: 0, total: 1, label: "Preparing music" } } });
      expect(mediaEvents).toContain("waiting");
      expect(video.querySelector('[data-vibe-video-action="skip-music"]')).not.toHaveAttribute("hidden");
      port.dispatch({ protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "media-state", ...identity, state: { videoId: "video", status: "ended", currentTimeMs: 8_000, durationMs: 8_000, paused: true, muted: false, volume: 1, activeSceneIndex: 1 } });
      expect(mediaEvents).toContain("ended");
      void (video as HTMLElement & { play(): Promise<void> }).play();
      expect(port.messages.slice(-2)).toEqual([
        expect.objectContaining({ type: "media-command", action: "seek", currentTimeMs: 0 }),
        expect.objectContaining({ type: "media-command", action: "play" }),
      ]);
      (video as HTMLElement & { stop(): void }).stop();
      expect(port.messages.at(-1)).toEqual(expect.objectContaining({ type: "media-command", action: "stop" }));
      expect(video.querySelector('[data-vibe-video-time="combined"]')).toHaveTextContent("0:00 / 0:08");
      expect(video.querySelector('[data-vibe-scene]:nth-of-type(1)')).not.toHaveAttribute("hidden");
      expect(harness.jsdomErrors).toEqual([]);
    } finally {
      harness.close();
    }
  });

  test("drives WAAPI scene effects only by timeline time without replaying a finished reveal", () => {
    const harness = createRuntimeHarness();
    try {
      Object.defineProperty(harness.window.navigator, "userActivation", { configurable: true, value: { isActive: true, hasBeenActive: true } });
      const animations: Array<{ currentTime: number | null; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> = [];
      const animate = vi.fn(() => {
        const animation = { currentTime: null, pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
        animations.push(animation);
        return animation as unknown as Animation;
      });
      Object.defineProperty(harness.window.Element.prototype, "animate", { configurable: true, value: animate });
      Object.defineProperty(harness.window, "requestAnimationFrame", { configurable: true, value: vi.fn(() => 1) });
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      const port = new FakeMessagePort();
      harness.window.dispatchEvent(new harness.window.MessageEvent("message", { data: { protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "init", instanceId: bootstrap.instanceId, ...identity }, source: harness.window, ports: [port as unknown as MessagePort] }));
      port.dispatch(renderCommand({
        title: "Timeline-owned animation",
        html: '<vibe-video id="stable-animation" data-aspect-ratio="16:9"><section data-vibe-scene data-kind="text" data-transition="crossfade" data-motion="stagger"><h1 data-vibe-layer>One reveal</h1><p data-vibe-layer>Never restart.</p></section><div data-vibe-video-controls><button type="button" data-vibe-video-action="toggle">Play</button></div></vibe-video>',
      }));
      const video = harness.document.querySelector<HTMLElement>("#stable-animation")!;
      video.querySelector<HTMLButtonElement>('[data-vibe-video-action="toggle"]')!.click();
      const prepare = port.messages.find((message) => message.type === "media-prepare")!;
      port.dispatch({ ...envelopeForRuntime(), type: "media-timeline", requestId: prepare.requestId, timeline: { videoId: "stable-animation", durationMs: 4_000, warnings: [], scenes: [{ id: prepare.plan.scenes[0].id, startMs: 0, durationMs: 4_000, narrationDurationMs: 0 }] } });
      const created = animate.mock.calls.length;
      port.dispatch({ ...envelopeForRuntime(), type: "media-state", state: { videoId: "stable-animation", status: "playing", currentTimeMs: 900, durationMs: 4_000, paused: false, muted: false, volume: 1, activeSceneIndex: 0 } });
      port.dispatch({ ...envelopeForRuntime(), type: "media-state", state: { videoId: "stable-animation", status: "playing", currentTimeMs: 1_100, durationMs: 4_000, paused: false, muted: false, volume: 1, activeSceneIndex: 0 } });
      expect(animate).toHaveBeenCalledTimes(created);
      expect(animations).not.toHaveLength(0);
      expect(animations.every((animation) => animation.pause.mock.calls.length > 0)).toBe(true);
      expect(animations.every((animation) => animation.play.mock.calls.length === 0)).toBe(true);
      expect(animations.every((animation) => Number(animation.currentTime) >= 1_100 && Number(animation.currentTime) < 1_150)).toBe(true);
      expect(harness.jsdomErrors).toEqual([]);
    } finally {
      harness.close();
    }
  });

  test("upgrades old model-authored YouTube chrome in place without adding a second player UI", () => {
    const harness = createRuntimeHarness();
    try {
      Object.defineProperty(harness.window.navigator, "userActivation", { configurable: true, value: { isActive: true, hasBeenActive: true } });
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      const port = new FakeMessagePort();
      harness.window.dispatchEvent(new harness.window.MessageEvent("message", { data: { protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "init", instanceId: bootstrap.instanceId, ...identity }, source: harness.window, ports: [port as unknown as MessagePort] }));
      port.dispatch(renderCommand({
        title: "Saved YouTube artifact",
        html: `<vibe-video id="youtube-video" data-aspect-ratio="16:9">
          <section data-vibe-scene data-kind="text" data-transition="cut" data-motion="still"><h1>Opening bell</h1></section>
          <div class="player-controls"><button id="old-play" type="button" data-vibe-video-action="play">▶</button><div class="progress" aria-hidden="true"><span></span></div><span class="time">2:31 / 6:42</span><button type="button" data-vibe-video-action="mute">🔊</button><button type="button" data-vibe-video-action="fullscreen">Fullscreen</button></div>
        </vibe-video>`,
      }));

      const video = harness.document.querySelector<HTMLElement>("#youtube-video")!;
      expect(video.querySelectorAll("[data-vibe-video-controls]")).toHaveLength(1);
      expect(video.querySelector("[data-vibe-video-status], [data-vibe-video-caption], [data-vibe-video-transcript]")).toBeNull();
      expect(video.querySelector('[data-vibe-video-action="fullscreen"]')).toBeNull();
      expect(video.querySelector("#old-play")).toHaveAttribute("data-vibe-video-action", "toggle");
      expect(video.querySelector(".time")).toHaveAttribute("data-vibe-video-time", "combined");
      expect(video.querySelector(".time")).toHaveTextContent("0:00 / --:--");
      expect(video.querySelector(".progress")).toHaveAttribute("data-vibe-video-seek");
      expect(video.querySelector(".progress")).toHaveAttribute("role", "slider");
      expect(video.querySelector(".progress")).not.toHaveAttribute("aria-hidden");

      video.querySelector<HTMLButtonElement>("#old-play")!.click();
      const prepare = port.messages.find((message) => message.type === "media-prepare")!;
      port.dispatch({ ...envelopeForRuntime(), type: "media-timeline", requestId: prepare.requestId, timeline: { videoId: "youtube-video", durationMs: 12_000, warnings: [], scenes: [{ id: prepare.plan.scenes[0].id, startMs: 0, durationMs: 12_000, narrationDurationMs: 0 }] } });
      port.dispatch({ ...envelopeForRuntime(), type: "media-state", state: { videoId: "youtube-video", status: "playing", currentTimeMs: 3_000, durationMs: 12_000, paused: false, muted: false, volume: 1, activeSceneIndex: 0 } });
      expect(video.querySelector(".time")).toHaveTextContent("0:03 / 0:12");
      expect(video.querySelector<HTMLElement>(".progress > span")?.style.inlineSize).toBe("25%");
      expect(harness.jsdomErrors).toEqual([]);
    } finally {
      harness.close();
    }
  });

  test("keeps pseudo-video seekable while reduced motion disables every transition animation", () => {
    const harness = createRuntimeHarness();
    try {
      Object.defineProperty(harness.window.navigator, "userActivation", { configurable: true, value: { isActive: true, hasBeenActive: true } });
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      const port = new FakeMessagePort();
      const animate = vi.fn();
      Object.defineProperty(harness.window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true })) });
      Object.defineProperty(harness.window.Element.prototype, "animate", { configurable: true, value: animate });
      harness.window.dispatchEvent(new harness.window.MessageEvent("message", { data: { protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "init", instanceId: bootstrap.instanceId, ...identity }, source: harness.window, ports: [port as unknown as MessagePort] }));
      port.dispatch(renderCommand({
        title: "Reduced media motion",
        html: '<vibe-video id="reduced"><section data-vibe-scene data-kind="title" data-transition="zoom" data-motion="stagger"><h1 data-vibe-layer>One</h1></section><section data-vibe-scene data-kind="credits" data-transition="wipe" data-motion="credits-roll"><p data-vibe-layer>Two</p></section><div data-vibe-video-controls><button type="button" data-vibe-video-action="toggle">Play</button><input type="range" data-vibe-video-seek value="0"></div></vibe-video>',
      }));
      const video = harness.document.querySelector<HTMLElement>("#reduced")!;
      video.querySelector<HTMLButtonElement>('[data-vibe-video-action="toggle"]')!.click();
      const prepare = port.messages.find((message) => message.type === "media-prepare")!;
      port.dispatch({ ...envelopeForRuntime(), type: "media-timeline", requestId: prepare.requestId, timeline: { videoId: "reduced", durationMs: 10_000, warnings: [], scenes: [{ id: prepare.plan.scenes[0].id, startMs: 0, durationMs: 4_000, narrationDurationMs: 0 }, { id: prepare.plan.scenes[1].id, startMs: 4_000, durationMs: 6_000, narrationDurationMs: 0 }] } });
      port.dispatch({ ...envelopeForRuntime(), type: "media-state", state: { videoId: "reduced", status: "paused", currentTimeMs: 7_000, durationMs: 10_000, paused: true, muted: false, volume: 1, activeSceneIndex: 1 } });
      expect(video.querySelector('[data-vibe-scene]:nth-of-type(2)')).not.toHaveAttribute("hidden");
      expect(video.querySelector<HTMLInputElement>("[data-vibe-video-seek]")).toHaveValue("7000");
      expect(animate).not.toHaveBeenCalled();
      expect(harness.jsdomErrors).toEqual([]);
    } finally {
      harness.close();
    }
  });

  test("normalizes legacy pseudo-video cues and mood presets without regenerating the artifact", () => {
    const harness = createRuntimeHarness();
    try {
      Object.defineProperty(harness.window.navigator, "userActivation", { configurable: true, value: { isActive: true, hasBeenActive: true } });
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      const port = new FakeMessagePort();
      harness.window.dispatchEvent(new harness.window.MessageEvent("message", { data: { protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "init", instanceId: bootstrap.instanceId, ...identity }, source: harness.window, ports: [port as unknown as MessagePort] }));
      port.dispatch(renderCommand({
        title: "Legacy video",
        html: `<section id="legacy-video" data-vibe-pseudo-video><figure data-vibe-video-scene data-duration-ms="2500" data-music-preset="melancholy"><figcaption>Archive</figcaption><p data-vibe-narration data-at-ms="200">First cue.</p><p data-vibe-narration data-at-ms="1200" data-pause-after-ms="900">Second cue.</p><i data-vibe-music data-preset="calm-documentary"></i></figure></section>`,
      }));
      const legacy = harness.document.querySelector<HTMLElement>("#legacy-video")!;
      expect(legacy).toHaveAttribute("data-vibe-legacy");
      expect(legacy).toHaveAttribute("data-aspect-ratio", "16:9");
      expect(legacy.querySelectorAll("[data-vibe-narration]")).toHaveLength(1);
      expect(legacy.querySelector("[data-vibe-narration]")).toHaveTextContent("First cue. Second cue.");
      expect(legacy.querySelector("[data-at-ms], [data-pause-after-ms], [data-vibe-music]")).toBeNull();
      expect(legacy.querySelector("[data-vibe-video-controls], [data-vibe-video-status], [data-vibe-video-transcript]")).toBeNull();
      void (legacy as HTMLElement & { play(): Promise<void> }).play();
      const prepare = port.messages.find((message) => message.type === "media-prepare")!;
      expect(prepare.plan).toMatchObject({
        scenes: [{ desiredDurationMs: 2_500, narration: { text: "First cue. Second cue." }, musicTrack: "documentary-pulse" }],
      });
      expect(harness.jsdomErrors).toEqual([]);
    } finally {
      harness.close();
    }
  });

  test("keeps local tabs available and applies only revisioned host-authorized region patches", () => {
    const harness = createRuntimeHarness();
    try {
      const bootstrap = harness.parentMessages[0] as BootstrapMessage;
      const port = new FakeMessagePort();
      harness.window.dispatchEvent(new harness.window.MessageEvent("message", {
        data: { protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, type: "init", instanceId: bootstrap.instanceId, ...identity },
        source: harness.window,
        ports: [port as unknown as MessagePort],
      }));
      const dynamicManifest = {
        version: 1 as const,
        regions: [{ id: "thread", refreshSeconds: 60 }],
        actions: [{ action: "model:chat.send", execution: "model" as const, targets: ["thread"] }],
        bindings: ["cart.count"],
        localTabs: true,
      };
      port.dispatch(renderCommand({
        title: "Reactive",
        dynamicManifest,
        html: `<main>
          <div data-vibe-tabs><button id="tab-one" role="tab" aria-controls="panel-one">One</button><button id="tab-two" role="tab" aria-controls="panel-two">Two</button><section id="panel-one" role="tabpanel">First</section><section id="panel-two" role="tabpanel">Second</section></div>
          <span data-vibe-bind="cart.count">0</span>
          <section data-vibe-region="thread">Old thread</section>
          <form id="chat" data-vibe-action="model:chat.send" data-vibe-target="thread"><input name="message" value="Hello"><button>Send</button></form>
        </main>`,
      }));

      expect(harness.document.querySelector("#panel-one")).not.toHaveAttribute("hidden");
      expect(harness.document.querySelector("#panel-two")).toHaveAttribute("hidden");
      harness.document.querySelector<HTMLButtonElement>("#tab-two")?.click();
      expect(harness.document.querySelector("#panel-one")).toHaveAttribute("hidden");
      expect(harness.document.querySelector("#panel-two")).not.toHaveAttribute("hidden");

      // Generated scripts and synthetic DOM events cannot cause host work.
      harness.document.querySelector<HTMLFormElement>("#chat")?.requestSubmit();
      expect(port.messages.some((message) => message.type === "dynamic-action")).toBe(false);

      port.dispatch({
        ...envelopeForRuntime(),
        type: "state-sync",
        sessionRevision: 1,
        bindings: { "cart.count": "3" },
        snapshots: [{ regionId: "thread", html: "<p>Restored</p>", revision: 1 }],
      });
      expect(harness.document.querySelector('[data-vibe-bind="cart.count"]')).toHaveTextContent("3");
      expect(harness.document.querySelector('[data-vibe-region="thread"]')).toHaveTextContent("Restored");

      port.dispatch({
        ...envelopeForRuntime(),
        type: "dynamic-patch",
        requestId: "host-job-1",
        sessionRevision: 2,
        patches: [{
          regionId: "thread",
          revision: 2,
          html: '<script>window.compromised=true</script><style>bad</style><p style="color:red" data-vibe-action="model:evil">Fresh</p>',
        }],
      });
      const thread = harness.document.querySelector('[data-vibe-region="thread"]');
      expect(thread).toHaveTextContent("Fresh");
      expect(thread?.querySelector("script, style, [style], [data-vibe-action]")).toBeNull();
      port.dispatch({
        ...envelopeForRuntime(),
        type: "dynamic-patch",
        requestId: "host-job-stale",
        sessionRevision: 2,
        patches: [{ regionId: "thread", revision: 1, html: "<p>Stale</p>" }],
      });
      expect(thread).toHaveTextContent("Fresh");
      expect((harness.window as Window & { compromised?: boolean }).compromised).toBeUndefined();
    } finally {
      harness.close();
    }
  });
});

const hostileArtifactHtml = `<!doctype html>
<html lang="en" dir="ltr" class="artifact-theme" data-vibesurfer-browser-theme="ie-classic" style="color: rgb(12, 34, 56); background: url(https://attacker.example/root.png)">
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
      <img id="loremflickr-image" src="https://loremflickr.com/640/480/city?lock=1">
      <img id="native-image" src="vibeasset://localhost/image/aHR0cHM">
      <img id="inline-image" src="data:image/png;base64,AA==">
      <iconify-icon icon="streamline-cyber:account" aria-hidden="true" data-iconify-rendered><svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"></path></svg></iconify-icon>
      <a id="icon-license" href="https://example.com/license" rel="license">Icon license</a>
    </main>
  </body>
</html>`;

let renderRevision = 0;
function renderCommand(patch: { title: string; html: string; executeScripts?: boolean; renderMode?: "preview" | "final"; dynamicManifest?: Record<string, unknown> }) {
  return {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    type: "render",
    ...identity,
    pageUrl: "https://safe.example/base/index.html",
    revision: ++renderRevision,
    renderMode: "final",
    ...patch,
  };
}

function envelopeForRuntime() {
  return { protocol: ARTIFACT_BRIDGE_PROTOCOL, version: ARTIFACT_BRIDGE_VERSION, ...identity };
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
