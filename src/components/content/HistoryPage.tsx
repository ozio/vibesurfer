import { useMemo } from "react";
import { useBrowserStore } from "../../store/browser-store";
import { HistorySurface } from "./HistorySurface";

export function HistoryPage() {
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const allEntries = useBrowserStore((state) => state.browsingHistory);
  const navigate = useBrowserStore((state) => state.navigate);
  const removeEntry = useBrowserStore((state) => state.removeBrowsingHistoryEntry);
  const clearHistory = useBrowserStore((state) => state.clearBrowsingHistory);
  const entries = useMemo(
    () => allEntries.filter((entry) => entry.profileId === activeProfileId),
    [activeProfileId, allEntries],
  );

  return (
    <HistorySurface
      entries={entries}
      onOpenEntry={(entry) => navigate(activeTabId, entry.url)}
      onDeleteEntry={(entry) => removeEntry(entry.id)}
      onClearHistory={() => clearHistory(activeProfileId)}
    />
  );
}
