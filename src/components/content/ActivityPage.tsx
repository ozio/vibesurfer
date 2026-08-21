import { Activity, AlertTriangle, CheckCircle2, Clock3, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getPersistedGenerationActivity,
  listPersistedGenerationJobs,
  type GenerationActivityDetail,
  type GenerationJobRecord,
} from "../../generation/host-api";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab, GenerationJob, ModelExchange } from "../../types/browser";

type ActivityFilter = "all" | "current" | "failed" | "completed";

export function ActivityPage({ tab }: { tab: BrowserTab }) {
  const profileId = useBrowserStore((state) => state.activeProfileId);
  const memoryJobs = useBrowserStore((state) => state.generationJobs);
  const artifacts = useBrowserStore((state) => state.artifacts);
  const [persisted, setPersisted] = useState<GenerationJobRecord[]>([]);
  const [detail, setDetail] = useState<GenerationActivityDetail>();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const requestedJobId = useMemo(() => activityJobId(tab.location), [tab.location]);
  const [selectedId, setSelectedId] = useState<string | undefined>(requestedJobId);

  useEffect(() => setSelectedId(requestedJobId), [requestedJobId]);
  useEffect(() => {
    let cancelled = false;
    void listPersistedGenerationJobs(profileId, 50, 0).then((records) => {
      if (cancelled) return;
      setPersisted(records);
      setOffset(records.length);
      setHasMore(records.length === 50);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [profileId]);

  const jobs = useMemo(() => mergeJobs(profileId, memoryJobs, persisted), [memoryJobs, persisted, profileId]);
  const selectedMemory = selectedId ? memoryJobs[selectedId] : undefined;
  useEffect(() => {
    if (!selectedId && jobs[0]) setSelectedId(jobs[0].id);
  }, [jobs, selectedId]);
  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => void getPersistedGenerationActivity(profileId, selectedId).then((next) => {
      if (!cancelled) setDetail(next);
    }).catch(() => { if (!cancelled) setDetail(undefined); }), selectedMemory && isCurrent(selectedMemory.status) ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [profileId, selectedId, selectedMemory?.updatedAt, selectedMemory?.status]);

  const visible = jobs.filter((job) => matchesFilter(job.status, filter));
  const selectedArtifact = selectedId
    ? Object.values(artifacts).find((artifact) => artifact.generationJobId === selectedId)
    : undefined;
  const exchanges = selectedArtifact?.modelExchanges ?? [];

  return (
    <main className="activity-page">
      <header className="activity-page__header">
        <div><span><Activity aria-hidden="true" /> Local diagnostics</span><h1>Generation activity</h1><p>Live progress, exact local request records and previous loads for this profile.</p></div>
        <div className="activity-filters" aria-label="Activity filters">
          {(["all", "current", "failed", "completed"] as ActivityFilter[]).map((value) => (
            <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value}</button>
          ))}
        </div>
      </header>
      <div className="activity-layout">
        <section className="activity-list" aria-label="Generation jobs">
          {visible.map((job) => (
            <button key={job.id} type="button" className={selectedId === job.id ? "is-active" : ""} onClick={() => setSelectedId(job.id)}>
              <StatusIcon status={job.status} />
              <span><strong>{jobTitle(job)}</strong><small>{jobUrl(job)}</small></span>
              <span><time dateTime={job.createdAt}>{formatTimestamp(job.createdAt)}</time><em>{displayStatus(job.status)}</em></span>
            </button>
          ))}
          {visible.length === 0 && <p className="activity-empty">No jobs match this filter.</p>}
          {hasMore && (
            <button className="activity-load-more" type="button" onClick={() => {
              void listPersistedGenerationJobs(profileId, 50, offset).then((records) => {
                setPersisted((current) => [...current, ...records]);
                setOffset((current) => current + records.length);
                setHasMore(records.length === 50);
              });
            }}>Load older jobs</button>
          )}
        </section>
        <section className="activity-detail" aria-live="polite">
          {selectedId ? (
            <>
              <JobOverview job={jobs.find((job) => job.id === selectedId)} memory={selectedMemory} detail={detail} />
              <StageTimeline memory={selectedMemory} detail={detail} exchanges={exchanges} />
              <JsonBlock title="Generation request" value={detail?.job.requestPayload ?? requestSnapshot(selectedMemory)} />
              {(detail?.job.errorPayload || selectedMemory?.error) && <JsonBlock title="Terminal error" value={detail?.job.errorPayload ?? selectedMemory?.error} />}
              {(selectedMemory?.warnings?.length || selectedArtifact?.warnings.length) ? (
                <JsonBlock title="Warnings" value={selectedMemory?.warnings ?? selectedArtifact?.warnings} />
              ) : null}
            </>
          ) : <div className="activity-empty"><Clock3 aria-hidden="true" /><p>Select a generation job.</p></div>}
        </section>
      </div>
    </main>
  );
}

function StageTimeline({ memory, detail, exchanges }: { memory?: GenerationJob; detail?: GenerationActivityDetail; exchanges: ModelExchange[] }) {
  const stages = detail?.stages.length ? detail.stages : exchanges.map((exchange) => ({
    jobId: memory?.id ?? "",
    stage: exchange.purpose,
    status: "completed",
    startedAt: exchange.startedAt,
    completedAt: exchange.completedAt,
    payload: exchange as unknown as Record<string, unknown>,
  }));
  return (
    <section className="activity-stages">
      <h2>Timeline</h2>
      {memory?.progress && isCurrent(memory.status) && (
        <div className="activity-live-progress">
          <span>{stageLabel(memory.progress.stage)}{memory.progress.approximate ? " · approximate" : ""}</span>
          <strong>{Math.min(99, memory.progress.percent)}%</strong>
          <i><b style={{ width: `${Math.min(99, memory.progress.percent)}%` }} /></i>
          {memory.progress.maxOutputTokens && <small>{formatTokens(memory.progress.currentOutputTokens)} / {formatTokens(memory.progress.maxOutputTokens)} output tokens</small>}
        </div>
      )}
      {stages.length ? stages.map((stage) => (
        <details className="activity-stage" key={stage.stage}>
          <summary><span><strong>{stageLabel(stage.stage)}</strong><small>{stage.status}</small></span><span>{duration(stage.startedAt, stage.completedAt)}</span></summary>
          <PrettyPayload value={stage.payload} />
        </details>
      )) : <p className="activity-empty">Stage records will appear as the job advances.</p>}
    </section>
  );
}

function JobOverview({ job, memory, detail }: { job?: GenerationJobRecord; memory?: GenerationJob; detail?: GenerationActivityDetail }) {
  if (!job) return null;
  const startedAt = memory?.startedAt ?? detail?.events.find((event) => event.eventType === "generation.started")?.timestamp ?? job.createdAt;
  const finishedAt = isCurrent(job.status) ? undefined : job.updatedAt;
  const usage = terminalUsage(detail) ?? memory?.usage;
  const maxOutput = memory?.progress?.maxOutputTokens ?? numericPath(job.requestPayload, "settings", "maxOutputTokens");
  return (
    <header className="activity-detail__header">
      <div><span>{displayStatus(job.status)}</span><h2>{jobTitle(job)}</h2><p>{jobUrl(job)}</p></div>
      <dl><div><dt>Started</dt><dd>{formatTimestamp(startedAt)}</dd></div><div><dt>Duration</dt><dd>{duration(startedAt, finishedAt)}</dd></div><div><dt>Model</dt><dd>{memory?.modelId ?? modelFromRequest(job.requestPayload)}</dd></div><div><dt>Tokens</dt><dd>{usage ? `${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out · ${formatTokens(usage.totalTokens)} total` : "Pending"}</dd></div><div><dt>Max output</dt><dd>{maxOutput ? formatTokens(maxOutput) : "Unknown"}</dd></div></dl>
    </header>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const formatted = pretty(value);
  return <details className="activity-json"><summary>{title}</summary><button type="button" onClick={() => void navigator.clipboard?.writeText(formatted)}><Copy aria-hidden="true" /> Copy</button><pre>{formatted}</pre></details>;
}

function PrettyPayload({ value }: { value: unknown }) {
  return <pre>{pretty(value)}</pre>;
}

function mergeJobs(profileId: string, memory: Record<string, GenerationJob>, persisted: GenerationJobRecord[]): GenerationJobRecord[] {
  const byId = new Map(persisted.map((job) => [job.id, job]));
  for (const job of Object.values(memory)) {
    if (job.profileId !== profileId || (!isCurrent(job.status) && !byId.has(job.id))) continue;
    const existing = byId.get(job.id);
    byId.set(job.id, {
      id: job.id,
      profileId,
      status: job.status,
      requestPayload: existing?.requestPayload ?? requestSnapshot(job),
      resultArtifactId: job.artifactId ?? existing?.resultArtifactId,
      errorPayload: job.error as unknown as Record<string, unknown> | undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function requestSnapshot(job?: GenerationJob): Record<string, unknown> {
  if (!job) return {};
  return { url: job.normalizedUrl ?? job.requestedUrl, purpose: job.purpose ?? "page", providerId: job.providerId, modelId: job.modelId, settings: job.generationSettingsSnapshot, navigationIntent: job.navigationIntent };
}

function activityJobId(location: string) { try { return new URL(location).searchParams.get("job") ?? undefined; } catch { return undefined; } }
function matchesFilter(status: string, filter: ActivityFilter) { return filter === "all" || (filter === "current" ? isCurrent(status) : filter === "failed" ? status === "failed" : status === "completed"); }
function isCurrent(status: string) { return !["completed", "failed", "cancelled"].includes(status); }
function displayStatus(status: string) { return isCurrent(status) ? "Running" : status.charAt(0).toUpperCase() + status.slice(1); }
function jobUrl(job: GenerationJobRecord) { const value = job.requestPayload.url ?? job.requestPayload.requestedUrl; return typeof value === "string" ? value : "Local generation"; }
function jobTitle(job: GenerationJobRecord) { if (job.requestPayload.discovery) return "I’m Feeling Lucky"; try { return new URL(jobUrl(job)).hostname || "Generated page"; } catch { return "Generated page"; } }
function modelFromRequest(request: Record<string, unknown>) { const provider = request.provider; return provider && typeof provider === "object" && "modelId" in provider ? String(provider.modelId) : String(request.modelId ?? "Unknown"); }
function terminalUsage(detail?: GenerationActivityDetail) { const event = [...(detail?.events ?? [])].reverse().find((item) => item.eventType === "generation.completed"); const value = event?.payload.usage; return value && typeof value === "object" ? value as { inputTokens?: number; outputTokens?: number; totalTokens?: number } : undefined; }
function numericPath(value: unknown, key: string, nested: string) { if (!value || typeof value !== "object") return undefined; const first = (value as Record<string, unknown>)[key]; if (!first || typeof first !== "object") return undefined; const result = (first as Record<string, unknown>)[nested]; return typeof result === "number" ? result : undefined; }
function pretty(value: unknown) { if (typeof value === "string") { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } } try { return JSON.stringify(value ?? {}, null, 2); } catch { return String(value); } }
function stageLabel(stage: string) { return ({ "page-director": "Director", director: "Director", "page-builder": "Builder", builder: "Builder", compile: "Compile", assets: "Assets", finalize: "Finalize", queued: "Waiting" } as Record<string, string>)[stage] ?? stage; }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function formatTokens(value?: number) { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0); }
function duration(start: string, end?: string) { const ms = Math.max(0, (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()); return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`; }

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") return <AlertTriangle aria-hidden="true" />;
  if (status === "completed") return <CheckCircle2 aria-hidden="true" />;
  return <LoaderCircle className={isCurrent(status) ? "is-spinning" : ""} aria-hidden="true" />;
}
