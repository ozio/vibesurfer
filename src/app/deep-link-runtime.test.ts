import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  acceptedDeepLinkKey,
  createDeepLinkRuntime,
  type DeepLinkRuntimeDependencies,
} from "./deep-link-runtime";

describe("deep-link runtime", () => {
  let liveHandler: ((urls: string[]) => void) | undefined;
  let dependencies: DeepLinkRuntimeDependencies;
  let openBlankTab: ReturnType<typeof vi.fn<() => void>>;
  let unlisten: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openBlankTab = vi.fn<() => void>();
    unlisten = vi.fn();
    dependencies = {
      isTauri: vi.fn(() => true),
      onOpenUrl: vi.fn(async (handler) => {
        liveHandler = handler;
        return unlisten as UnlistenFn;
      }),
      getCurrent: vi.fn(async () => null),
      openBlankTab,
    };
  });

  it("subscribes before reading and opens a blank tab for a cold-start vibe URL", async () => {
    const order: string[] = [];
    dependencies.onOpenUrl = vi.fn(async (handler) => {
      order.push("listen");
      liveHandler = handler;
      return unlisten as UnlistenFn;
    });
    dependencies.getCurrent = vi.fn(async () => {
      order.push("current");
      return ["vibe://cold-start/path?ignored=yes#fragment"];
    });

    await createDeepLinkRuntime(dependencies).start();

    expect(order).toEqual(["listen", "current"]);
    expect(openBlankTab).toHaveBeenCalledTimes(1);
    expect(openBlankTab).toHaveBeenCalledWith();
  });

  it("opens a blank tab for every accepted live vibes invocation", async () => {
    await createDeepLinkRuntime(dependencies).start();

    liveHandler?.(["vibes://first.example/path", "vibe://second.example/ignored"]);

    expect(openBlankTab).toHaveBeenCalledTimes(2);
    expect(openBlankTab).toHaveBeenNthCalledWith(1);
    expect(openBlankTab).toHaveBeenNthCalledWith(2);
  });

  it("ignores malformed, unsafe, and unrelated URLs", async () => {
    dependencies.getCurrent = vi.fn(async () => [
      "https://example.com",
      "vibey://example.com",
      "vibe:without-slashes",
      " vibe://leading-space",
      "vibes://user:secret@example.com/private",
      `vibe://example.com/${"a".repeat(4_096)}`,
      "vibe://valid.example/path",
    ]);

    await createDeepLinkRuntime(dependencies).start();

    expect(openBlankTab).toHaveBeenCalledOnce();
  });

  it("deduplicates a live event repeated by getCurrent during bootstrap", async () => {
    dependencies.getCurrent = vi.fn(async () => {
      liveHandler?.(["vibe://same.example/path"]);
      return ["vibe://same.example/path"];
    });

    await createDeepLinkRuntime(dependencies).start();

    expect(openBlankTab).toHaveBeenCalledOnce();
  });

  it("still opens a new tab when the same URL is invoked again later", async () => {
    dependencies.getCurrent = vi.fn(async () => {
      liveHandler?.(["vibes://same.example/path"]);
      return ["vibes://same.example/path"];
    });
    await createDeepLinkRuntime(dependencies).start();

    liveHandler?.(["vibes://same.example/path"]);

    expect(openBlankTab).toHaveBeenCalledTimes(2);
  });

  it("does not load deep-link APIs outside Tauri", async () => {
    dependencies.isTauri = vi.fn(() => false);
    const runtime = createDeepLinkRuntime(dependencies);

    await runtime.start();
    await runtime.start();

    expect(dependencies.onOpenUrl).not.toHaveBeenCalled();
    expect(dependencies.getCurrent).not.toHaveBeenCalled();
    expect(openBlankTab).not.toHaveBeenCalled();
  });

  it("installs only one listener when start is called repeatedly", async () => {
    const runtime = createDeepLinkRuntime(dependencies);

    await Promise.all([runtime.start(), runtime.start()]);

    expect(dependencies.onOpenUrl).toHaveBeenCalledOnce();
    expect(dependencies.getCurrent).toHaveBeenCalledOnce();
  });
});

describe("acceptedDeepLinkKey", () => {
  it("accepts only exact vibe and vibes hierarchical schemes", () => {
    expect(acceptedDeepLinkKey("vibe://example.com/path")).toBe("vibe://example.com/path");
    expect(acceptedDeepLinkKey("VIBES://EXAMPLE.COM/path")).toBe("vibes://EXAMPLE.COM/path");
    expect(acceptedDeepLinkKey("vibe-extra://example.com")).toBeUndefined();
    expect(acceptedDeepLinkKey("vibes:example.com")).toBeUndefined();
  });
});
