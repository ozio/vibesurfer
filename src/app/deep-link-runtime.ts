import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "../lib/platform";
import { useBrowserStore } from "../store/browser-store";

const MAX_DEEP_LINK_LENGTH = 4_096;
const CUSTOM_SCHEME_PREFIX = /^vibes?:\/\//i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

type OpenUrlHandler = (urls: string[]) => void;

export interface DeepLinkRuntimeDependencies {
  isTauri: () => boolean;
  onOpenUrl: (handler: OpenUrlHandler) => Promise<UnlistenFn>;
  getCurrent: () => Promise<string[] | null>;
  openBlankTab: () => void;
}

export interface DeepLinkRuntime {
  start: () => Promise<void>;
  stop: () => void;
}

export function createDeepLinkRuntime(dependencies: DeepLinkRuntimeDependencies): DeepLinkRuntime {
  let startPromise: Promise<void> | undefined;
  let unlisten: UnlistenFn | undefined;
  let stopped = false;

  const start = () => {
    if (startPromise) return startPromise;
    if (!dependencies.isTauri()) {
      startPromise = Promise.resolve();
      return startPromise;
    }

    startPromise = installDeepLinkRuntime(dependencies, {
      isStopped: () => stopped,
      setUnlisten: (next) => {
        if (stopped) next();
        else unlisten = next;
      },
    });
    return startPromise;
  };

  return {
    start,
    stop: () => {
      stopped = true;
      unlisten?.();
      unlisten = undefined;
    },
  };
}

interface RuntimeLifecycle {
  isStopped: () => boolean;
  setUnlisten: (unlisten: UnlistenFn) => void;
}

async function installDeepLinkRuntime(
  dependencies: DeepLinkRuntimeDependencies,
  lifecycle: RuntimeLifecycle,
): Promise<void> {
  let bootstrapping = true;
  const liveUrlsDuringBootstrap = new Map<string, number>();

  const openLiveUrls = (urls: string[]) => {
    if (lifecycle.isStopped()) return;
    for (const rawUrl of urls) {
      const key = acceptedDeepLinkKey(rawUrl);
      if (!key) continue;
      if (bootstrapping) incrementCount(liveUrlsDuringBootstrap, key);
      dependencies.openBlankTab();
    }
  };

  try {
    const stopListening = await dependencies.onOpenUrl(openLiveUrls);
    lifecycle.setUnlisten(stopListening);
  } catch {
    // Cold-start handling can still work when event subscription is unavailable.
  }

  try {
    const currentUrls = await dependencies.getCurrent();
    if (!lifecycle.isStopped() && currentUrls) {
      for (const rawUrl of currentUrls) {
        const key = acceptedDeepLinkKey(rawUrl);
        if (!key || consumeCount(liveUrlsDuringBootstrap, key)) continue;
        dependencies.openBlankTab();
      }
    }
  } catch {
    // A deep-link integration failure must not prevent the browser UI from starting.
  } finally {
    bootstrapping = false;
    liveUrlsDuringBootstrap.clear();
  }
}

function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function consumeCount(counts: Map<string, number>, key: string) {
  const count = counts.get(key) ?? 0;
  if (count === 0) return false;
  if (count === 1) counts.delete(key);
  else counts.set(key, count - 1);
  return true;
}

export function acceptedDeepLinkKey(rawUrl: string): string | undefined {
  if (
    rawUrl.length === 0
    || rawUrl.length > MAX_DEEP_LINK_LENGTH
    || rawUrl !== rawUrl.trim()
    || CONTROL_CHARACTER.test(rawUrl)
    || !CUSTOM_SCHEME_PREFIX.test(rawUrl)
  ) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    if (
      (url.protocol !== "vibe:" && url.protocol !== "vibes:")
      || url.username
      || url.password
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

const appDeepLinkRuntime = createDeepLinkRuntime({
  isTauri,
  onOpenUrl,
  getCurrent,
  openBlankTab: () => {
    useBrowserStore.getState().addTab();
  },
});

export function startDeepLinkRuntime(): Promise<void> {
  return appDeepLinkRuntime.start();
}
