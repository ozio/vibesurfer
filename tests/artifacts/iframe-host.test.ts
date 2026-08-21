// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ARTIFACT_BRIDGE_PROTOCOL,
  ARTIFACT_BRIDGE_VERSION,
  createBootstrapReady,
} from "../../src/artifacts/bridge-protocol";
import { connectArtifactFrame } from "../../src/artifacts/iframe-host";

const identity = { artifactId: "artifact-race", nonce: "nonce-race" };
const render = { revision: 1, renderMode: "final" as const, pageUrl: "https://example.test/", title: "Fixture", html: "<main>Fixture</main>" };
const firstInstance = "runtime-instance-0001";
const secondInstance = "runtime-instance-0002";

describe("artifact frame host bootstrap", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("waits for a delayed runtime announcement before transferring the private port", () => {
    const channels = installFakeMessageChannel();
    const iframe = document.createElement("iframe");
    const frameWindow = { postMessage: vi.fn() };
    Object.defineProperty(iframe, "contentWindow", { value: frameWindow, configurable: true });
    const onEvent = vi.fn();

    const connection = connectArtifactFrame({ iframe, ...identity, render, onEvent });
    expect(frameWindow.postMessage).not.toHaveBeenCalled();

    announce(frameWindow, createBootstrapReady(identity, firstInstance));
    const channel = channels[0]!;
    expect(frameWindow.postMessage).toHaveBeenCalledOnce();
    expect(frameWindow.postMessage.mock.calls[0]?.[0]).toMatchObject({ type: "init", instanceId: firstInstance, ...identity });
    expect(frameWindow.postMessage.mock.calls[0]?.[2]).toEqual([channel.port2]);

    channel.port1.onmessage?.({ data: readyForRenderEvent() } as MessageEvent<unknown>);
    expect(channel.port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "render",
      ...identity,
      ...render,
    }));

    channel.port1.onmessage?.({
      data: {
        protocol: ARTIFACT_BRIDGE_PROTOCOL,
        version: ARTIFACT_BRIDGE_VERSION,
        type: "ready",
        ...identity,
        title: "Race recovered",
      },
    } as MessageEvent<unknown>);
    expect(connection.isReady()).toBe(true);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "ready", title: "Race recovered" }));

    const nextRender = { ...render, revision: 2, title: "Streaming update", html: "<main>More HTML</main>" };
    connection.updateRender(nextRender);
    expect(channel.port1.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "render",
      ...identity,
      ...nextRender,
    }));
    connection.disconnect();
  });

  test("ignores stale, spoofed, and repeated bootstrap announcements", () => {
    const channels = installFakeMessageChannel();
    const iframe = document.createElement("iframe");
    const frameWindow = { postMessage: vi.fn() };
    Object.defineProperty(iframe, "contentWindow", { value: frameWindow, configurable: true });
    const connection = connectArtifactFrame({ iframe, ...identity, render, onEvent: vi.fn() });

    announce({}, createBootstrapReady(identity, firstInstance));
    announce(frameWindow, createBootstrapReady({ ...identity, nonce: "stale" }, firstInstance));
    expect(frameWindow.postMessage).not.toHaveBeenCalled();

    announce(frameWindow, createBootstrapReady(identity, firstInstance));
    announce(frameWindow, createBootstrapReady(identity, firstInstance));
    expect(frameWindow.postMessage).toHaveBeenCalledOnce();
    expect(channels).toHaveLength(1);
    connection.disconnect();
  });

  test("accepts bootstrap only from the iframe's current committed window", () => {
    const channels = installFakeMessageChannel();
    const iframe = document.createElement("iframe");
    const initialWindow = { postMessage: vi.fn() };
    const committedWindow = { postMessage: vi.fn() };
    let currentWindow = initialWindow;
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => currentWindow,
    });
    const connection = connectArtifactFrame({ iframe, ...identity, render, onEvent: vi.fn() });

    currentWindow = committedWindow;
    announce(initialWindow, createBootstrapReady(identity, firstInstance));
    expect(channels).toHaveLength(0);

    announce(committedWindow, createBootstrapReady(identity, firstInstance));
    expect(channels).toHaveLength(1);
    expect(initialWindow.postMessage).not.toHaveBeenCalled();
    expect(committedWindow.postMessage).toHaveBeenCalledOnce();
    connection.disconnect();
  });

  test("replaces a stale private channel when the same frame starts a new runtime instance", () => {
    const channels = installFakeMessageChannel();
    const iframe = document.createElement("iframe");
    const frameWindow = { postMessage: vi.fn() };
    Object.defineProperty(iframe, "contentWindow", { value: frameWindow, configurable: true });
    const onEvent = vi.fn();
    const onRuntimeRestart = vi.fn();
    const connection = connectArtifactFrame({ iframe, ...identity, render, onEvent, onRuntimeRestart });

    announce(frameWindow, createBootstrapReady(identity, firstInstance));
    const firstChannel = channels[0]!;
    firstChannel.port1.onmessage?.({ data: readyForRenderEvent() } as MessageEvent<unknown>);
    firstChannel.port1.onmessage?.({ data: readyEvent("First runtime") } as MessageEvent<unknown>);
    expect(connection.isReady()).toBe(true);
    const staleHandler = firstChannel.port1.onmessage;

    announce(frameWindow, createBootstrapReady(identity, secondInstance));
    expect(channels).toHaveLength(2);
    expect(firstChannel.port1.close).toHaveBeenCalledOnce();
    expect(connection.isReady()).toBe(false);
    expect(onRuntimeRestart).toHaveBeenCalledOnce();
    expect(frameWindow.postMessage.mock.calls[1]?.[0]).toMatchObject({
      type: "init",
      instanceId: secondInstance,
    });

    staleHandler?.({
      data: {
        ...readyEvent("Stale runtime"),
        type: "navigate",
        href: "https://attacker.invalid/",
        disposition: "current",
      },
    } as MessageEvent<unknown>);
    expect(onEvent).toHaveBeenCalledTimes(1);

    const secondChannel = channels[1]!;
    secondChannel.port1.onmessage?.({ data: readyForRenderEvent() } as MessageEvent<unknown>);
    secondChannel.port1.onmessage?.({ data: readyEvent("Second runtime") } as MessageEvent<unknown>);
    expect(connection.isReady()).toBe(true);
    expect(onEvent).toHaveBeenCalledTimes(2);
    announce(frameWindow, createBootstrapReady(identity, secondInstance));
    announce(frameWindow, createBootstrapReady(identity, firstInstance));
    expect(channels).toHaveLength(2);
    connection.disconnect();
  });
});

function announce(source: object, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", {
    data,
    source: source as unknown as Window,
  }));
}

function installFakeMessageChannel() {
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

class FakeMessagePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  start = vi.fn();
  close = vi.fn();
  postMessage = vi.fn();
}

function readyEvent(title: string) {
  return {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    type: "ready",
    ...identity,
    title,
  };
}

function readyForRenderEvent() {
  return {
    protocol: ARTIFACT_BRIDGE_PROTOCOL,
    version: ARTIFACT_BRIDGE_VERSION,
    type: "ready-for-render",
    ...identity,
  };
}
