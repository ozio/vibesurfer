// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import {
  ARTIFACT_BRIDGE_PROTOCOL,
  ARTIFACT_BRIDGE_VERSION,
} from "../../src/artifacts/bridge-protocol";
import { PageSurface } from "../../src/components/content/PageSurface";
import { DEFAULT_GENERATION_SETTINGS, useBrowserStore } from "../../src/store/browser-store";
import type { BrowserTab, GenerationJob, PageArtifact } from "../../src/types/browser";

const memoryStorage = new Map<string, string>();
useBrowserStore.persist.setOptions({
  storage: createJSONStorage(() => ({
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key) => {
      memoryStorage.delete(key);
    },
  })),
});

describe("generated PageSurface", () => {
  beforeEach(() => {
    memoryStorage.clear();
    useBrowserStore.setState({ artifacts: {}, generationJobs: {} });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("keeps the new-tab page visible until the first streamed HTML arrives", () => {
    const job = generationJob({ status: "running", phase: "compiling-styles" });
    useBrowserStore.setState({ generationJobs: { [job.id]: job } });

    render(<PageSurface tab={generatedTab({ generationJobId: job.id, loadState: "loading" })} />);

    expect(document.querySelector(".new-tab-page")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Fixture page")).not.toBeInTheDocument();
  });

  test("renders a useful terminal error state", () => {
    const job = generationJob({
      status: "failed",
      phase: "failed",
      error: { code: "malformed-output", message: "The model returned malformed HTML", retryable: true },
    });
    useBrowserStore.setState({ generationJobs: { [job.id]: job } });

    render(<PageSurface tab={generatedTab({ generationJobId: job.id, loadState: "error" })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("This page could not be generated");
    expect(screen.getByRole("alert")).toHaveTextContent("The model returned malformed HTML");
  });

  test("arms the private handshake before load and keeps load idempotent", () => {
    const channels = installFakeMessageChannels();
    const postMessage = vi.fn();
    const frameWindow = { postMessage };
    installFrameWindow(frameWindow);
    const artifact = {
      ...pageArtifact(),
      allowGeneratedScripts: true,
      html: '<main><h1>Safe page</h1><a href="javascript:alert(1)">Bad route</a><button id="toggle">Toggle</button><script>document.querySelector("#toggle").hidden = true;</script></main>',
    };
    const job = generationJob({ status: "completed", phase: "completed", artifactId: artifact.id });
    useBrowserStore.setState({
      artifacts: { [artifact.id]: artifact },
      generationJobs: { [job.id]: job },
    });

    render(<PageSurface tab={generatedTab({ artifactId: artifact.id, generationJobId: job.id })} />);
    const frame = screen.getByTitle("Fixture page") as HTMLIFrameElement;

    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-popups");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(frame).toHaveClass("artifact-frame--connecting");
    expect(frame.src).toContain("/artifact-frame.html#");
    expect(frame.src).not.toContain("pageUrl=");

    const identity = bridgeIdentity(frame);
    act(() => announceBootstrap(frameWindow, identity));
    const channel = channels[0]!;
    const init = postMessage.mock.calls[0]?.[0] as { artifactId: string; nonce: string };
    act(() => emitFrameEvent(channel.port1, identity, { type: "ready-for-render" }));
    expect(channel.port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "render",
      pageUrl: artifact.url,
      title: artifact.title,
      html: expect.not.stringContaining("javascript:alert"),
      executeScripts: true,
    }));
    expect(channel.port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      html: expect.stringContaining("<script>"),
    }));
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledOnce();
    expect(channel.port1.close).not.toHaveBeenCalled();
    act(() => {
      channel.port1.onmessage?.({
        data: {
          protocol: ARTIFACT_BRIDGE_PROTOCOL,
          version: ARTIFACT_BRIDGE_VERSION,
          type: "ready",
          artifactId: init.artifactId,
          nonce: init.nonce,
          title: artifact.title,
        },
      } as MessageEvent<unknown>);
    });

    expect(frame).toHaveClass("artifact-frame--ready");
    expect(screen.queryByText("Opening the page")).not.toBeInTheDocument();
  });

  test("keeps the same iframe document when only the current virtual hash changes", () => {
    const artifact = pageArtifact();
    const job = generationJob({ status: "completed", phase: "completed", artifactId: artifact.id });
    useBrowserStore.setState({
      artifacts: { [artifact.id]: artifact },
      generationJobs: { [job.id]: job },
    });
    const tab = generatedTab({ artifactId: artifact.id, generationJobId: job.id });
    const { rerender } = render(<PageSurface tab={tab} />);
    const firstFrame = screen.getByTitle("Fixture page") as HTMLIFrameElement;
    const firstDocument = firstFrame.src;

    rerender(<PageSurface tab={{
      ...tab,
      location: "https://example.test/#details",
      virtualLocation: { ...tab.virtualLocation!, url: "https://example.test/#details", hash: "#details" },
    }} />);

    const hashFrame = screen.getByTitle("Fixture page") as HTMLIFrameElement;
    expect(hashFrame).toBe(firstFrame);
    expect(hashFrame.src).toBe(firstDocument);
  });

  test("routes current and background hash events without generating a new artifact", () => {
    const channels = installFakeMessageChannels();
    const frameWindow = { postMessage: vi.fn() };
    installFrameWindow(frameWindow);
    const artifact = pageArtifact();
    const job = generationJob({ status: "completed", phase: "completed", artifactId: artifact.id });
    const tab = generatedTab({ artifactId: artifact.id, generationJobId: job.id, favicon: "🧭" });
    useBrowserStore.setState({
      tabs: [tab],
      activeTabId: tab.id,
      artifacts: { [artifact.id]: artifact },
      generationJobs: { [job.id]: job },
    });

    render(<PageSurface tab={tab} />);
    const frame = screen.getByTitle("Fixture page") as HTMLIFrameElement;
    const identity = bridgeIdentity(frame);
    act(() => announceBootstrap(frameWindow, identity));
    const channel = channels[0]!;
    act(() => emitFrameEvent(channel.port1, identity, { type: "ready-for-render" }));
    act(() => emitFrameEvent(channel.port1, identity, { type: "ready", title: artifact.title }));

    act(() => emitFrameEvent(channel.port1, identity, {
      type: "hash-change",
      href: "https://example.test/#details",
      hash: "#details",
    }));
    let state = useBrowserStore.getState();
    expect(state.tabs[0]?.location).toBe("https://example.test/#details");
    expect(state.tabs[0]?.artifactId).toBe(artifact.id);

    act(() => emitFrameEvent(channel.port1, identity, {
      type: "navigate",
      href: "https://example.test/#about",
      disposition: "background-tab",
      linkText: "About",
    }));
    state = useBrowserStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(tab.id);
    expect(state.tabs[1]).toMatchObject({
      location: "https://example.test/#about",
      artifactId: artifact.id,
      title: artifact.title,
      favicon: "🧭",
    });
    expect(Object.keys(state.generationJobs)).toEqual([job.id]);
  });

  test("opens general settings when the private frame bridge receives Cmd+comma", () => {
    const channels = installFakeMessageChannels();
    const frameWindow = { postMessage: vi.fn() };
    installFrameWindow(frameWindow);
    const artifact = pageArtifact();
    const job = generationJob({ status: "completed", phase: "completed", artifactId: artifact.id });
    const tab = generatedTab({ artifactId: artifact.id, generationJobId: job.id });
    useBrowserStore.setState({
      tabs: [tab],
      activeTabId: tab.id,
      artifacts: { [artifact.id]: artifact },
      generationJobs: { [job.id]: job },
    });

    render(<PageSurface tab={tab} />);
    const frame = screen.getByTitle("Fixture page") as HTMLIFrameElement;
    const identity = bridgeIdentity(frame);
    act(() => announceBootstrap(frameWindow, identity));
    act(() => emitFrameEvent(channels[0]!.port1, identity, { type: "ready-for-render" }));
    act(() => emitFrameEvent(channels[0]!.port1, identity, { type: "ready", title: artifact.title }));
    act(() => emitFrameEvent(channels[0]!.port1, identity, {
      type: "browser-command",
      command: "open-settings",
    }));

    const state = useBrowserStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.find((item) => item.id === state.activeTabId)).toMatchObject({
      kind: "settings",
      location: "vibe://settings/general",
    });
  });

  test("updates one iframe as streamed HTML grows and swaps in the final artifact", () => {
    const channels = installFakeMessageChannels();
    const frameWindow = { postMessage: vi.fn() };
    installFrameWindow(frameWindow);
    const job = generationJob({
      status: "running",
      phase: "generating",
      provisionalTitle: "Streaming page",
      previewHtml: "<main id=first-preview>First streamed fragment</main>",
      previewRevision: 1,
    });
    const tab = generatedTab({ generationJobId: job.id, loadState: "loading" });
    useBrowserStore.setState({ generationJobs: { [job.id]: job } });

    const { rerender } = render(<PageSurface tab={tab} />);
    const frame = screen.getByTitle("Streaming page") as HTMLIFrameElement;
    const identity = bridgeIdentity(frame);
    act(() => announceBootstrap(frameWindow, identity, "runtime-instance-stream"));
    const channel = channels[0]!;
    act(() => emitFrameEvent(channel.port1, identity, { type: "ready-for-render" }));
    expect(channel.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "render",
      html: expect.stringContaining("First streamed fragment"),
    }));
    act(() => emitFrameEvent(channel.port1, identity, { type: "ready", title: "Streaming page" }));
    expect(useBrowserStore.getState().generationJobs[job.id]?.status).toBe("running");

    const nextJob = {
      ...job,
      previewHtml: "<main id=second-preview>First streamed fragment plus more HTML</main>",
      previewRevision: 2,
    };
    act(() => useBrowserStore.setState({ generationJobs: { [job.id]: nextJob } }));
    const updatedFrame = screen.getByTitle("Streaming page") as HTMLIFrameElement;
    expect(updatedFrame).toBe(frame);
    expect(channel.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "render",
      html: expect.stringContaining("plus more HTML"),
    }));

    const artifact = {
      ...pageArtifact(),
      id: "artifact-stream-final",
      title: "Final streamed page",
      html: "<main id=final-page>Complete HTML</main>",
      generationJobId: job.id,
    };
    const completedJob = {
      ...nextJob,
      status: "completed" as const,
      phase: "completed" as const,
      artifactId: artifact.id,
    };
    const completedTab = { ...tab, artifactId: artifact.id, title: artifact.title, loadState: "idle" as const };
    act(() => useBrowserStore.setState({
      artifacts: { [artifact.id]: artifact },
      generationJobs: { [job.id]: completedJob },
    }));
    rerender(<PageSurface tab={completedTab} />);

    const finalFrame = screen.getByTitle("Final streamed page") as HTMLIFrameElement;
    expect(finalFrame).toBe(frame);
    expect(channels).toHaveLength(1);
    expect(channel.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "render",
      title: "Final streamed page",
      html: expect.stringContaining("Complete HTML"),
    }));
  });

  test("keeps the current artifact until the first streamed HTML arrives", () => {
    const channels = installFakeMessageChannels();
    const frameWindow = { postMessage: vi.fn() };
    installFrameWindow(frameWindow);
    const firstArtifact = pageArtifact();
    const firstJob = generationJob({ status: "completed", phase: "completed", artifactId: firstArtifact.id });
    const firstTab = generatedTab({ artifactId: firstArtifact.id, generationJobId: firstJob.id });
    useBrowserStore.setState({
      artifacts: { [firstArtifact.id]: firstArtifact },
      generationJobs: { [firstJob.id]: firstJob },
    });

    const { rerender } = render(<PageSurface tab={firstTab} />);
    const firstFrame = screen.getByTitle("Fixture page") as HTMLIFrameElement;
    const firstIdentity = bridgeIdentity(firstFrame);
    act(() => announceBootstrap(frameWindow, firstIdentity, "runtime-instance-first"));
    act(() => emitFrameEvent(channels[0]!.port1, firstIdentity, { type: "ready-for-render" }));
    act(() => emitFrameEvent(channels[0]!.port1, firstIdentity, { type: "ready", title: firstArtifact.title }));

    const secondJob = generationJob({
      id: "job-second",
      status: "running",
      phase: "generating",
      requestedUrl: "https://example.test/second",
      normalizedUrl: "https://example.test/second",
    });
    const navigatingTab = generatedTab({
      artifactId: undefined,
      fallbackArtifactId: firstArtifact.id,
      generationJobId: secondJob.id,
      location: "https://example.test/second",
    });
    act(() => useBrowserStore.setState({ generationJobs: { [firstJob.id]: firstJob, [secondJob.id]: secondJob } }));
    rerender(<PageSurface tab={navigatingTab} />);
    expect(screen.getByTitle("Fixture page")).toBe(firstFrame);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const streamingSecondJob = {
      ...secondJob,
      provisionalTitle: "Second fixture page",
      previewHtml: "<main id=second-preview>Second streamed page</main>",
      previewRevision: 1,
    };
    act(() => useBrowserStore.setState({
      generationJobs: { [firstJob.id]: firstJob, [secondJob.id]: streamingSecondJob },
    }));
    rerender(<PageSurface tab={navigatingTab} />);

    const secondFrame = screen.getByTitle("Second fixture page") as HTMLIFrameElement;
    expect(secondFrame).not.toBe(firstFrame);
    const secondIdentity = bridgeIdentity(secondFrame);
    act(() => announceBootstrap(frameWindow, secondIdentity, "runtime-instance-second"));
    expect(channels).toHaveLength(2);
    act(() => emitFrameEvent(channels[1]!.port1, secondIdentity, { type: "ready-for-render" }));
    expect(channels[1]!.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "render",
      html: expect.stringContaining("Second streamed page"),
    }));
    act(() => emitFrameEvent(channels[1]!.port1, secondIdentity, { type: "ready", title: "Second fixture page" }));

    const secondArtifact: PageArtifact = {
      ...firstArtifact,
      id: "artifact-second",
      url: "https://example.test/second",
      title: "Second fixture page",
      generationJobId: secondJob.id,
    };
    const completedSecondJob = { ...streamingSecondJob, status: "completed" as const, phase: "completed" as const, artifactId: secondArtifact.id };
    const secondTab = { ...navigatingTab, artifactId: secondArtifact.id, title: secondArtifact.title };
    act(() => useBrowserStore.setState({
      artifacts: { [firstArtifact.id]: firstArtifact, [secondArtifact.id]: secondArtifact },
      generationJobs: { [firstJob.id]: firstJob, [secondJob.id]: completedSecondJob },
    }));
    rerender(<PageSurface tab={secondTab} />);

    const finalFrame = screen.getByTitle("Second fixture page") as HTMLIFrameElement;
    expect(finalFrame).toBe(secondFrame);
    expect(channels).toHaveLength(2);
    expect(channels[1]!.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "render",
      title: secondArtifact.title,
    }));
    expect(finalFrame).toHaveClass("artifact-frame--ready");

    act(() => announceBootstrap(frameWindow, firstIdentity, "runtime-instance-first-replayed"));
    expect(channels).toHaveLength(2);
  });

  test("keeps legacy live-web tabs network-inert", () => {
    render(<PageSurface tab={{
      ...generatedTab(),
      kind: "remote",
      artifactId: undefined,
      generationJobId: undefined,
      title: "example.test",
    }} />);

    expect(screen.queryByTitle("example.test")).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: "Open live site externally" })).toBeInTheDocument();
  });
});

function generatedTab(patch: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: "tab-fixture",
    title: "Fixture page",
    location: "https://example.test/",
    kind: "generated",
    virtualLocation: {
      url: "https://example.test/",
      origin: "https://example.test",
      pathname: "/",
      search: "",
      hash: "",
    },
    loadState: "idle",
    reloadKey: 0,
    history: [{
      id: "history-fixture",
      location: "https://example.test/",
      title: "Fixture page",
      kind: "generated",
    }],
    historyIndex: 0,
    generatedWith: "codex:auto",
    ...patch,
  };
}

function generationJob(patch: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-fixture",
    profileId: "personal",
    tabId: "tab-fixture",
    requestedUrl: "https://example.test/",
    normalizedUrl: "https://example.test/",
    modelId: "codex:auto",
    browserTheme: "native",
    worldPromptSnapshot: { revision: 1, prompt: "" },
    generationSettingsSnapshot: structuredClone(DEFAULT_GENERATION_SETTINGS),
    status: "queued",
    phase: "queued",
    navigationIntent: {
      trigger: "address-bar",
      disposition: "current",
      requestedUrl: "https://example.test/",
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...patch,
  };
}

function pageArtifact(): PageArtifact {
  return {
    id: "artifact-fixture",
    url: "https://example.test/",
    title: "Fixture page",
    html: '<main><h1>Safe page</h1><a href="javascript:alert(1)">Bad route</a></main>',
    summary: "Fixture",
    siteWorldId: "site-fixture",
    generationJobId: "job-fixture",
    modelId: "codex:auto",
    promptVersion: 1,
    settingsFingerprint: "fixture",
    createdAt: "2026-08-12T00:00:00.000Z",
    warnings: [],
  };
}

function installFakeMessageChannels() {
  const channels: Array<{ port1: FakeMessagePort; port2: FakeMessagePort }> = [];
  class FakeMessageChannel {
    readonly port1 = new FakeMessagePort();
    readonly port2 = new FakeMessagePort();

    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal("MessageChannel", FakeMessageChannel);
  return channels;
}

function installFrameWindow(frameWindow: { postMessage: ReturnType<typeof vi.fn> }) {
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
    .mockReturnValue(frameWindow as unknown as Window);
}

class FakeMessagePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  start = vi.fn();
  close = vi.fn();
  postMessage = vi.fn();
}

function bridgeIdentity(frame: HTMLIFrameElement) {
  const config = new URL(frame.src).hash.slice(1);
  const parameters = new URLSearchParams(config);
  return {
    artifactId: parameters.get("artifactId") ?? "",
    nonce: parameters.get("nonce") ?? "",
  };
}

function announceBootstrap(
  source: object,
  identity: { artifactId: string; nonce: string },
  instanceId = "runtime-instance-page-surface",
) {
  window.dispatchEvent(new MessageEvent("message", {
    data: {
      protocol: ARTIFACT_BRIDGE_PROTOCOL,
      version: ARTIFACT_BRIDGE_VERSION,
      type: "bootstrap-ready",
      instanceId,
      ...identity,
    },
    source: source as unknown as Window,
  }));
}

function emitFrameEvent(
  port: FakeMessagePort,
  identity: { artifactId: string; nonce: string },
  event: Record<string, unknown>,
) {
  port.onmessage?.({
    data: {
      protocol: ARTIFACT_BRIDGE_PROTOCOL,
      version: ARTIFACT_BRIDGE_VERSION,
      ...event,
      ...identity,
    },
  } as MessageEvent<unknown>);
}
