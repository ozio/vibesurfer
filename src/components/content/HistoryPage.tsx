import { useEffect, useMemo, useState } from "react";
import {
  clearPersistedBrowsingHistory,
  deletePersistedBrowsingHistoryEntry,
  listPersistedBrowsingHistory,
} from "../../generation/host-api";
import { isTauri } from "../../lib/platform";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowsingHistoryEntry } from "../../types/browser";
import { HistorySurface } from "./HistorySurface";

export function HistoryPage() {
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const allEntries = useBrowserStore((state) => state.browsingHistory);
  const navigate = useBrowserStore((state) => state.navigate);
  const removeEntry = useBrowserStore((state) => state.removeBrowsingHistoryEntry);
  const clearHistory = useBrowserStore((state) => state.clearBrowsingHistory);
  const [persisted, setPersisted] = useState<BrowsingHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPersisted([]);
    setCursor(undefined);
    if (!isTauri()) return;
    void listPersistedBrowsingHistory(activeProfileId, 100).then((page) => {
      if (cancelled) return;
      setPersisted(page.items);
      setCursor(page.nextCursor);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeProfileId]);
  const entries = useMemo(() => {
    const byId = new Map(persisted.map((entry) => [entry.id, entry]));
    for (const entry of allEntries) {
      if (entry.profileId !== activeProfileId) continue;
      const current = byId.get(entry.id);
      if (!current || entry.updatedAt >= current.updatedAt) byId.set(entry.id, entry);
    }
    return [...byId.values()].sort((left, right) => right.openedAt.localeCompare(left.openedAt));
  }, [activeProfileId, allEntries, persisted]);

  return (
    <HistorySurface
      entries={entries}
      onOpenEntry={(entry) => navigate(activeTabId, entry.url)}
      onDeleteEntry={(entry) => {
        removeEntry(entry.id);
        setPersisted((current) => current.filter((candidate) => candidate.id !== entry.id));
        void deletePersistedBrowsingHistoryEntry(activeProfileId, entry.id).catch(() => undefined);
      }}
      onClearHistory={() => {
        clearHistory(activeProfileId);
        setPersisted([]);
        setCursor(undefined);
        void clearPersistedBrowsingHistory(activeProfileId).catch(() => undefined);
      }}
      hasMore={Boolean(cursor)}
      loadingMore={loadingMore}
      onLoadMore={() => {
        if (!cursor || loadingMore) return;
        setLoadingMore(true);
        void listPersistedBrowsingHistory(activeProfileId, 100, cursor).then((page) => {
          setPersisted((current) => [...current, ...page.items]);
          setCursor(page.nextCursor);
        }).catch(() => undefined).finally(() => setLoadingMore(false));
      }}
    />
  );
}
