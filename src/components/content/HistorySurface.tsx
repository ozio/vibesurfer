import { AlertTriangle, Clock3, History, RotateCcw, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { BrowsingHistoryEntry } from "../../types/browser";
import { Badge } from "../ui/Feedback";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { EmptyState } from "../ui/Feedback";
import { Favicon } from "../ui/Favicon";
import { IconButton } from "../ui/IconButton";
import { ListRow } from "../ui/Surfaces";

export interface HistorySurfaceProps {
  entries: BrowsingHistoryEntry[];
  now?: string;
  onOpenEntry: (entry: BrowsingHistoryEntry) => void;
  onDeleteEntry: (entry: BrowsingHistoryEntry) => void;
  onClearHistory: () => void;
}

export function HistorySurface({
  entries,
  now,
  onOpenEntry,
  onDeleteEntry,
  onClearHistory,
}: HistorySurfaceProps) {
  const groups = useMemo(() => groupByDay(entries), [entries]);
  const versions = useMemo(() => versionNumbers(entries), [entries]);
  const referenceNow = now ?? new Date().toISOString();

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
            trigger={<Button className="history-page__clear" size="small" leadingIcon={<Trash2 aria-hidden="true" />}>Clear history</Button>}
            title="Clear browsing history?"
            description="This removes browsing history for the current profile. Generated pages remain cached."
            confirmLabel="Clear history"
            destructive
            onConfirm={onClearHistory}
          />
        )}
      </header>

      {groups.length === 0 ? (
        <EmptyState
          className="history-empty"
          icon={<Clock3 />}
          title="No paths recorded yet"
          description="Pages you open in this profile will appear here."
        />
      ) : groups.map(([day, dayEntries]) => (
        <section className="history-day" key={day}>
          <h2>{formatDay(day, referenceNow)}</h2>
          <div className="history-list">
            {dayEntries.map((entry) => (
              <HistoryEntryRow
                key={entry.id}
                entry={entry}
                version={versions.get(entry.id) ?? 1}
                onOpen={() => onOpenEntry(entry)}
                onDelete={() => onDeleteEntry(entry)}
              />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

export interface HistoryEntryRowProps {
  entry: BrowsingHistoryEntry;
  version?: number;
  onOpen: () => void;
  onDelete: () => void;
}

export function HistoryEntryRow({ entry, version = 1, onOpen, onDelete }: HistoryEntryRowProps) {
  return (
    <article className={`history-entry history-entry--${entry.status}`}>
      <ListRow
        className="history-entry__open"
        title={entry.title}
        description={entry.url}
        leading={(
          <span className="history-entry__favicon">
            <Favicon source={entry.favicon} title={entry.title} generated seed={entry.url} />
          </span>
        )}
        trailing={(
          <span className="history-entry__meta">
            <time dateTime={entry.openedAt}>{formatTime(entry.openedAt)}</time>
            <HistoryStatus entry={entry} />
            {version > 1 && <em>version {version}</em>}
          </span>
        )}
        onClick={onOpen}
      />
      <IconButton
        className="history-entry__delete"
        size="small"
        variant="ghost"
        label={`Delete ${entry.title} from history`}
        tooltipSide="left"
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
      </IconButton>
    </article>
  );
}

function HistoryStatus({ entry }: { entry: BrowsingHistoryEntry }) {
  if (entry.status === "error") {
    return <Badge className="history-status" variant="danger"><AlertTriangle aria-hidden="true" /> Error{entry.errorMessage ? ` · ${entry.errorMessage}` : ""}</Badge>;
  }
  if (entry.status === "loading") {
    return <Badge className="history-status" variant="warning"><RotateCcw aria-hidden="true" /> Loading</Badge>;
  }
  return <Badge className="history-status" variant={entry.status === "cached" ? "neutral" : "success"}>{entry.status === "cached" ? "Cached" : "Generated"}</Badge>;
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

function formatDay(day: string, now: string): string {
  const reference = new Date(now);
  const today = localDay(reference.toISOString());
  const yesterday = localDay(new Date(reference.getTime() - 86_400_000).toISOString());
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
