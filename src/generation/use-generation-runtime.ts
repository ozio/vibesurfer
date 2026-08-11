import { useEffect } from "react";
import { isTauri } from "../lib/platform";
import { useBrowserStore } from "../store/browser-store";
import type { BrowserTab, PageArtifact } from "../types/browser";
import {
  getPersistedArtifact,
  listPersistedArtifacts,
  listPersistedSiteWorlds,
  listProviderConnections,
} from "./host-api";
import { GenerationCoordinator } from "./runtime";

const RECENT_ARTIFACT_LIMIT = 32;
const ARTIFACT_READ_CONCURRENCY = 8;

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
        state.hydrateSiteWorlds(siteWorlds);
        state.hydrateArtifacts(artifacts);
        connections.forEach(state.upsertProviderConnection);
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
}

async function loadSessionArtifacts(profileId: string, tabs: BrowserTab[]): Promise<PageArtifact[]> {
  const recent = await listPersistedArtifacts(profileId, RECENT_ARTIFACT_LIMIT);
  const artifacts = new Map(recent.map((artifact) => [artifact.id, artifact]));
  const missingIds = referencedArtifactIds(tabs).filter((id) => !artifacts.has(id));

  for (let index = 0; index < missingIds.length; index += ARTIFACT_READ_CONCURRENCY) {
    const loaded = await Promise.all(
      missingIds.slice(index, index + ARTIFACT_READ_CONCURRENCY).map((id) =>
        getPersistedArtifact(profileId, id).catch(() => undefined)),
    );
    for (const artifact of loaded) {
      if (artifact) artifacts.set(artifact.id, artifact);
    }
  }

  return [...artifacts.values()];
}

function referencedArtifactIds(tabs: BrowserTab[]): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    if (id) ids.add(id);
  };
  for (const tab of tabs) {
    add(tab.artifactId);
    add(tab.opener?.artifactId);
    for (const entry of tab.history) add(entry.artifactId);
  }
  return [...ids];
}
