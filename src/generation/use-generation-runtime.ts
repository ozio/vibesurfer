import { useEffect } from "react";
import { modelCatalog } from "../data/catalog";
import { isTauri } from "../lib/platform";
import { useBrowserStore } from "../store/browser-store";
import type { BrowserTab, PageArtifact, ProviderConnection } from "../types/browser";
import {
  getPersistedArtifactsByIds,
  getPersistedArtifact,
  listPersistedBrowsingHistory,
  listPersistedSiteWorlds,
  listProviderConnections,
  upsertPersistedBrowsingHistory,
} from "./host-api";
import { GenerationCoordinator } from "./runtime";

export function useGenerationRuntime(): void {
  useEffect(() => {
    const coordinator = new GenerationCoordinator();
    const unsubscribe = useBrowserStore.subscribe((state) => coordinator.sync(state));
    coordinator.sync(useBrowserStore.getState());
    return () => {
      unsubscribe();
      coordinator.dispose();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let loadRevision = 0;
    const loadProfileRuntime = async (profileId: string) => {
      const revision = ++loadRevision;
      const restoredTabs = useBrowserStore.getState().tabs;
      try {
        const [artifacts, siteWorlds, connections] = await Promise.all([
          loadSessionArtifacts(profileId, restoredTabs),
          listPersistedSiteWorlds(profileId),
          listProviderConnections(profileId),
        ]);
        if (revision !== loadRevision || useBrowserStore.getState().activeProfileId !== profileId) return;
        const state = useBrowserStore.getState();
        state.hydrateArtifacts(artifacts);
        state.hydrateSiteWorlds(siteWorlds);
        hydrateProviderConnections(profileId, connections);
      } catch {
        // Settings exposes runtime diagnostics. Session startup remains usable
        // even when the desktop persistence layer is temporarily unavailable.
      }
    };
    void loadProfileRuntime(useBrowserStore.getState().activeProfileId);
    const unsubscribe = useBrowserStore.subscribe((state, previous) => {
      if (state.activeProfileId !== previous.activeProfileId) {
        void loadProfileRuntime(state.activeProfileId);
      }
    });
    return () => {
      loadRevision += 1;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const loading = new Set<string>();
    let disposed = false;
    const loadMissing = (state = useBrowserStore.getState()) => {
      const ids = referencedArtifactIds(state.tabs)
        .filter((id) => !state.artifacts[id] && !loading.has(id));
      for (const id of ids) {
        loading.add(id);
        void getPersistedArtifact(state.activeProfileId, id)
          .then((artifact) => {
            if (!disposed && artifact && useBrowserStore.getState().activeProfileId === state.activeProfileId) {
              useBrowserStore.getState().hydrateArtifacts([artifact]);
            }
          })
          .catch(() => undefined)
          .finally(() => loading.delete(id));
      }
    };
    const unsubscribe = useBrowserStore.subscribe((state, previous) => {
      // Initial/profile hydration batches current and fallback artifacts above.
      // This path is only for references introduced by later tab mutations.
      if (state.tabs !== previous.tabs && state.activeProfileId === previous.activeProfileId) loadMissing(state);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let flushTimer: number | undefined;
    const sentRevisions = new Map<string, string>();

    const importLegacy = async () => {
      const pending = useBrowserStore.getState().pendingHistoryMigration;
      for (let index = 0; index < pending.length; index += 500) {
        await upsertPersistedBrowsingHistory(pending.slice(index, index + 500));
      }
      if (!disposed && pending.length > 0) useBrowserStore.getState().finishBrowsingHistoryMigration();
    };
    const hydrateProfile = async (profileId: string) => {
      const page = await listPersistedBrowsingHistory(profileId, 100);
      if (!disposed && useBrowserStore.getState().activeProfileId === profileId) {
        useBrowserStore.getState().hydrateBrowsingHistory(page.items);
        for (const entry of page.items) sentRevisions.set(entry.id, entry.updatedAt);
      }
    };
    const flush = async () => {
      flushTimer = undefined;
      const entries = latestHistoryPerProfile(useBrowserStore.getState().browsingHistory)
        .filter((entry) => sentRevisions.get(entry.id) !== entry.updatedAt);
      if (entries.length === 0) return;
      await upsertPersistedBrowsingHistory(entries);
      for (const entry of entries) sentRevisions.set(entry.id, entry.updatedAt);
    };
    const scheduleFlush = () => {
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => void flush().catch(() => undefined), 80);
    };

    void importLegacy()
      .then(() => hydrateProfile(useBrowserStore.getState().activeProfileId))
      .catch(() => undefined);
    const unsubscribe = useBrowserStore.subscribe((state, previous) => {
      if (state.activeProfileId !== previous.activeProfileId) {
        void hydrateProfile(state.activeProfileId).catch(() => undefined);
      }
      if (state.browsingHistory !== previous.browsingHistory) scheduleFlush();
    });
    return () => {
      disposed = true;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      unsubscribe();
    };
  }, []);
}

function latestHistoryPerProfile(entries: ReturnType<typeof useBrowserStore.getState>["browsingHistory"]) {
  const counts = new Map<string, number>();
  return entries.filter((entry) => {
    const count = counts.get(entry.profileId) ?? 0;
    if (count >= 100) return false;
    counts.set(entry.profileId, count + 1);
    return true;
  });
}

async function loadSessionArtifacts(profileId: string, tabs: BrowserTab[]): Promise<PageArtifact[]> {
  return getPersistedArtifactsByIds(profileId, referencedArtifactIds(tabs));
}

function referencedArtifactIds(tabs: BrowserTab[]): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    if (id) ids.add(id);
  };
  for (const tab of tabs) {
    add(tab.artifactId);
    add(tab.fallbackArtifactId);
  }
  return [...ids];
}

function hydrateProviderConnections(profileId: string, connections: ProviderConnection[]) {
  const state = useBrowserStore.getState();
  const providerConnections = [
    ...state.providerConnections.filter((connection) => connection.profileId !== profileId),
    ...connections,
  ];
  const selectedModelAvailable = modelCatalog(providerConnections, profileId)
    .some((model) => model.id === state.activeModelId && model.available);
  useBrowserStore.setState({
    providerConnections,
    activeModelId: state.activeProfileId === profileId && !selectedModelAvailable
      ? "mock:preview"
      : state.activeModelId,
  });
}
