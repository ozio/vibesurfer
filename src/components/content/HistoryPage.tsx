import { AlertTriangle, Clock3, History, RotateCcw, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowsingHistoryEntry } from "../../types/browser";
import { ConfirmDialog } from "../ui/Dialog";
import { Favicon } from "../ui/Favicon";

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
  const groups = useMemo(() => groupByDay(entries), [entries]);
  const versions = useMemo(() => versionNumbers(entries), [entries]);

  return (
    <main className="history-page">
      <header className="history-page__header">
        <div>
          <span className="history-page__eyebrow"><History aria-hidden="true" /> Profile archive</span>
          <h1>History</h1>
          <p>Every visit is recorded. Cached openings and deliberate regenerations remain separate entries.</p>
        </div>
        {entries.length > 0 && (
          <ConfirmDialog
            trigger={(
              <button className="history-page__clear" type="button">
                <Trash2 aria-hidden="true" /> Clear history
              </button>
            )}
            title="Clear browsing history?"
            description="This removes browsing history for the current profile. Generated pages remain cached."
            confirmLabel="Clear history"
            destructive
            onConfirm={() => clearHistory(activeProfileId)}
          />
        )}
      </header>

      {groups.length === 0 ? (
        <section className="history-empty">
          <Clock3 aria-hidden="true" />
          <h2>No paths recorded yet</h2>
          <p>Pages you open in this profile will appear here.</p>
        </section>
      ) : groups.map(([day, dayEntries]) => (
        <section className="history-day" key={day}>
          <h2>{formatDay(day)}</h2>
          <div className="history-list">
            {dayEntries.map((entry) => (
              <article className={`history-entry history-entry--${entry.status}`} key={entry.id}>
                <button className="history-entry__open" type="button" onClick={() => navigate(activeTabId, entry.url)}>
                  <span className="history-entry__favicon">
                    <Favicon source={entry.favicon} title={entry.title} generated seed={entry.url} />
                  </span>
                  <span className="history-entry__copy">
                    <strong>{entry.title}</strong>
                    <small>{entry.url}</small>
                  </span>
                  <span className="history-entry__meta">
                    <time dateTime={entry.openedAt}>{formatTime(entry.openedAt)}</time>
                    <Status entry={entry} />
                    {(versions.get(entry.id) ?? 1) > 1 && <em>version {versions.get(entry.id)}</em>}
                  </span>
                </button>
                <button className="history-entry__delete" type="button" aria-label={`Delete ${entry.title} from history`} onClick={() => removeEntry(entry.id)}>
                  <Trash2 aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function Status({ entry }: { entry: BrowsingHistoryEntry }) {
  if (entry.status === "error") return <span className="history-status"><AlertTriangle aria-hidden="true" /> Error{entry.errorMessage ? ` · ${entry.errorMessage}` : ""}</span>;
  if (entry.status === "loading") return <span className="history-status"><RotateCcw aria-hidden="true" /> Loading</span>;
  return <span className="history-status">{entry.status === "cached" ? "Cached" : "Generated"}</span>;
}

function groupByDay(entries: BrowsingHistoryEntry[]): Array<[string, BrowsingHistoryEntry[]]> {
  const sorted = [...entries].sort((left, right) => right.openedAt.localeCompare(left.openedAt));
  const groups = new Map<string, BrowsingHistoryEntry[]>();
  for (const entry of sorted) {
    const day = localDay(entry.openedAt);
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }
  return [...groups.entries()];
}

function versionNumbers(entries: BrowsingHistoryEntry[]): Map<string, number> {
  const artifactsByUrl = new Map<string, Map<string, number>>();
  const versions = new Map<string, number>();
  for (const entry of [...entries].sort((left, right) => left.openedAt.localeCompare(right.openedAt))) {
    const key = cacheKey(entry.url);
    const known = artifactsByUrl.get(key) ?? new Map<string, number>();
    artifactsByUrl.set(key, known);
    if (!entry.artifactId) {
      versions.set(entry.id, known.size + 1);
      continue;
    }
    const version = known.get(entry.artifactId) ?? known.size + 1;
    known.set(entry.artifactId, version);
    versions.set(entry.id, version);
  }
  return versions;
}

function localDay(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDay(day: string): string {
  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 86_400_000).toISOString());
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date(`${day}T12:00:00`));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function cacheKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}
