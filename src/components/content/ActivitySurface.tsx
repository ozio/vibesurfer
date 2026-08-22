import { Activity, AlertTriangle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import type { GenerationJob, ModelExchange } from "../../types/browser";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/ChoiceControls";
import { JsonViewer } from "../ui/Code";
import { Badge, EmptyState, Progress } from "../ui/Feedback";
import { ListRow } from "../ui/Surfaces";

export type ActivityFilter = "all" | "current" | "failed" | "completed";

export interface ActivityJobRecord {
  id: string;
  profileId: string;
  status: string;
  requestPayload: Record<string, unknown>;
  resultArtifactId?: string;
  errorPayload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEventRecord {
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface ActivityStageRecord {
  jobId: string;
  stage: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  payload: Record<string, unknown>;
}

export interface ActivityDetailRecord {
  job: ActivityJobRecord;
  events: ActivityEventRecord[];
  stages: ActivityStageRecord[];
}

export interface ActivitySurfaceProps {
  jobs: ActivityJobRecord[];
  selectedId?: string;
  selectedMemoryJob?: GenerationJob;
  detail?: ActivityDetailRecord;
  exchanges?: ModelExchange[];
  warnings?: unknown;
  filter: ActivityFilter;
  hasMore?: boolean;
  loadingOlder?: boolean;
  now?: string;
  onFilterChange: (filter: ActivityFilter) => void;
  onSelectJob: (jobId: string) => void;
  onLoadOlder?: () => void;
}

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "current", label: "Current" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
] as const;

export function ActivitySurface({
  jobs,
  selectedId,
  selectedMemoryJob,
  detail,
  exchanges = [],
  warnings,
  filter,
  hasMore = false,
  loadingOlder = false,
  now,
  onFilterChange,
  onSelectJob,
  onLoadOlder,
}: ActivitySurfaceProps) {
  const visible = jobs.filter((job) => matchesFilter(job.status, filter));
  const selectedJob = jobs.find((job) => job.id === selectedId);
  const referenceNow = now ?? new Date().toISOString();

  return (
    <main className="activity-page">
      <header className="activity-page__header">
        <div><span><Activity aria-hidden="true" /> Local diagnostics</span><h1>Generation activity</h1><p>Live progress, exact local request records and previous loads for this profile.</p></div>
        <SegmentedControl
          className="activity-filters"
          label="Activity filters"
          options={FILTER_OPTIONS}
          value={filter}
          onValueChange={(value) => onFilterChange(value as ActivityFilter)}
        />
      </header>
      <div className="activity-layout">
        <section className="activity-list" aria-label="Generation jobs">
          {visible.map((job) => (
            <ActivityJobRow
              key={job.id}
              job={job}
              selected={selectedId === job.id}
              onSelect={() => onSelectJob(job.id)}
            />
          ))}
          {visible.length === 0 && <EmptyState className="activity-empty" title="No jobs match this filter" description="Choose another filter or start a generation." />}
          {hasMore && onLoadOlder && <Button className="activity-load-more" variant="ghost" loading={loadingOlder} onClick={onLoadOlder}>Load older jobs</Button>}
        </section>
        <section className="activity-detail" aria-live="polite">
          {selectedId && selectedJob ? (
            <>
              <ActivityJobOverview job={selectedJob} memory={selectedMemoryJob} detail={detail} now={referenceNow} />
              <ActivityStageTimeline memory={selectedMemoryJob} detail={detail} exchanges={exchanges} now={referenceNow} />
              <JsonViewer className="activity-json" title="Generation request" value={detail?.job.requestPayload ?? requestSnapshot(selectedMemoryJob)} collapsed defaultOpen={false} />
              {(detail?.job.errorPayload || selectedMemoryJob?.error) && <JsonViewer className="activity-json" title="Terminal error" value={detail?.job.errorPayload ?? selectedMemoryJob?.error} collapsed defaultOpen />}
              {warnings ? <JsonViewer className="activity-json" title="Warnings" value={warnings} collapsed defaultOpen={false} /> : null}
            </>
          ) : (
            <EmptyState className="activity-empty" icon={<Clock3 />} title={selectedId ? "Generation job unavailable" : "Select a generation job"} description={selectedId ? "The selected record is no longer available for this profile." : "Request, timeline and token details will appear here."} />
          )}
        </section>
      </div>
    </main>
  );
}

export interface ActivityJobRowProps {
  job: ActivityJobRecord;
  selected?: boolean;
  onSelect: () => void;
}

export function ActivityJobRow({ job, selected = false, onSelect }: ActivityJobRowProps) {
  return (
    <ListRow
      className={selected ? "is-active" : ""}
      selected={selected}
      title={jobTitle(job)}
      description={jobUrl(job)}
      leading={<ActivityStatusIcon status={job.status} />}
      trailing={(
        <span className="activity-job-meta">
          <time dateTime={job.createdAt}>{formatTimestamp(job.createdAt)}</time>
          <Badge variant={statusVariant(job.status)}>{displayStatus(job.status)}</Badge>
        </span>
      )}
      onClick={onSelect}
    />
  );
}

export interface ActivityJobOverviewProps {
  job: ActivityJobRecord;
  memory?: GenerationJob;
  detail?: ActivityDetailRecord;
  now: string;
}

export function ActivityJobOverview({ job, memory, detail, now }: ActivityJobOverviewProps) {
  const startedAt = memory?.startedAt ?? detail?.events.find((event) => event.eventType === "generation.started")?.timestamp ?? job.createdAt;
  const finishedAt = isCurrent(job.status) ? now : job.updatedAt;
  const usage = terminalUsage(detail) ?? memory?.usage;
  const maxOutput = memory?.progress?.maxOutputTokens ?? numericPath(job.requestPayload, "settings", "maxOutputTokens");
  return (
    <header className="activity-detail__header">
      <div><Badge variant={statusVariant(job.status)}>{displayStatus(job.status)}</Badge><h2>{jobTitle(job)}</h2><p>{jobUrl(job)}</p></div>
      <dl>
        <div><dt>Started</dt><dd>{formatTimestamp(startedAt)}</dd></div>
        <div><dt>Duration</dt><dd>{duration(startedAt, finishedAt)}</dd></div>
        <div><dt>Model</dt><dd>{memory?.modelId ?? modelFromRequest(job.requestPayload)}</dd></div>
        <div><dt>Tokens</dt><dd>{usage ? `${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out · ${formatTokens(usage.totalTokens)} total` : "Pending"}</dd></div>
        <div><dt>Max output</dt><dd>{maxOutput ? formatTokens(maxOutput) : "Unknown"}</dd></div>
      </dl>
    </header>
  );
}

export interface ActivityStageTimelineProps {
  memory?: GenerationJob;
  detail?: ActivityDetailRecord;
  exchanges?: ModelExchange[];
  now: string;
}

export function ActivityStageTimeline({ memory, detail, exchanges = [], now }: ActivityStageTimelineProps) {
  const stages: ActivityStageRecord[] = detail?.stages.length ? detail.stages : exchanges.map((exchange) => ({
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
        <Progress
          className="activity-live-progress"
          label={`${stageLabel(memory.progress.stage)}${memory.progress.approximate ? " · approximate" : ""}`}
          value={Math.min(99, memory.progress.percent)}
          formatValue={(value) => `${Math.round(value)}%`}
        />
      )}
      {memory?.progress?.maxOutputTokens && isCurrent(memory.status) && (
        <small className="activity-live-tokens">{formatTokens(memory.progress.currentOutputTokens)} / {formatTokens(memory.progress.maxOutputTokens)} output tokens</small>
      )}
      {stages.length ? stages.map((stage, index) => (
        <JsonViewer
          className="activity-stage"
          key={`${stage.stage}-${stage.startedAt}-${index}`}
          title={<span><strong>{stageLabel(stage.stage)}</strong><small>{stage.status} · {duration(stage.startedAt, stage.completedAt ?? (isCurrent(stage.status) ? now : stage.startedAt))}</small></span>}
          value={stage.payload}
          collapsed
          defaultOpen={false}
        />
      )) : <EmptyState className="activity-empty" title="Timeline pending" description="Stage records will appear as the job advances." />}
    </section>
  );
}

function requestSnapshot(job?: GenerationJob): Record<string, unknown> {
  if (!job) return {};
  return { url: job.normalizedUrl ?? job.requestedUrl, purpose: job.purpose ?? "page", providerId: job.providerId, modelId: job.modelId, settings: job.generationSettingsSnapshot, navigationIntent: job.navigationIntent };
}

function matchesFilter(status: string, filter: ActivityFilter) {
  return filter === "all" || (filter === "current" ? isCurrent(status) : filter === "failed" ? status === "failed" : status === "completed");
}

function isCurrent(status: string) { return !["completed", "failed", "cancelled"].includes(status); }
function displayStatus(status: string) { return isCurrent(status) ? "Running" : status.charAt(0).toUpperCase() + status.slice(1); }
function statusVariant(status: string) { return status === "failed" ? "danger" : status === "completed" ? "success" : status === "cancelled" ? "warning" : "accent"; }
function jobUrl(job: ActivityJobRecord) { const value = job.requestPayload.url ?? job.requestPayload.requestedUrl; return typeof value === "string" ? value : "Local generation"; }
function jobTitle(job: ActivityJobRecord) { if (job.requestPayload.discovery) return "I’m Feeling Lucky"; try { return new URL(jobUrl(job)).hostname || "Generated page"; } catch { return "Generated page"; } }
function modelFromRequest(request: Record<string, unknown>) { const provider = request.provider; return provider && typeof provider === "object" && "modelId" in provider ? String(provider.modelId) : String(request.modelId ?? "Unknown"); }
function terminalUsage(detail?: ActivityDetailRecord) { const event = [...(detail?.events ?? [])].reverse().find((item) => item.eventType === "generation.completed"); const value = event?.payload.usage; return value && typeof value === "object" ? value as { inputTokens?: number; outputTokens?: number; totalTokens?: number } : undefined; }
function numericPath(value: unknown, key: string, nested: string) { if (!value || typeof value !== "object") return undefined; const first = (value as Record<string, unknown>)[key]; if (!first || typeof first !== "object") return undefined; const result = (first as Record<string, unknown>)[nested]; return typeof result === "number" ? result : undefined; }
function stageLabel(stage: string) { return ({ "page-director": "Director", director: "Director", "page-builder": "Builder", builder: "Builder", compile: "Compile", assets: "Assets", finalize: "Finalize", queued: "Waiting" } as Record<string, string>)[stage] ?? stage; }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function formatTokens(value?: number) { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0); }
function duration(start: string, end: string) { const ms = Math.max(0, new Date(end).getTime() - new Date(start).getTime()); return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`; }

function ActivityStatusIcon({ status }: { status: string }) {
  if (status === "failed") return <AlertTriangle aria-hidden="true" />;
  if (status === "completed") return <CheckCircle2 aria-hidden="true" />;
  return <LoaderCircle className={isCurrent(status) ? "is-spinning" : ""} aria-hidden="true" />;
}
