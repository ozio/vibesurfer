import { useBrowserStore } from "../../store/browser-store";
import type { GenerationJob, PageArtifact, TokenUsage } from "../../types/browser";

interface BrowserStatusBarProps {
  location: string;
  hoveredLink?: string;
  profileName: string;
  modelName: string;
  artifact?: PageArtifact;
  activeJob?: GenerationJob;
}

export function BrowserStatusBar({ location, hoveredLink, profileName, modelName, artifact, activeJob }: BrowserStatusBarProps) {
  const openActivity = useBrowserStore((state) => state.openActivity);
  const usage = artifact?.usage ?? activeJob?.usage;
  const exchanges = artifact?.modelExchanges ?? [];
  const summary = compactUsage(usage, exchanges.length, activeJob);
  const status = hoveredLink ?? generationStatus(activeJob) ?? location;
  const classicStatus = hoveredLink ?? generationStatus(activeJob) ?? (activeJob?.status === "failed" ? "Error" : "Done");
  const jobId = activeJob?.id ?? artifact?.generationJobId;

  return (
    <footer className="browser-statusbar" title={hoveredLink}>
      <div className="browser-statusbar__modern">
        <span className="browser-statusbar__destination"><i className="status-orb" />{status}</span>
        <span className="browser-statusbar__identity">{profileName} · {modelName}</span>
        <button className="browser-statusbar__usage" type="button" disabled={!jobId} onClick={() => openActivity(jobId)} title={jobId ? "Open generation activity" : "No generation activity for this page"}>{summary}</button>
      </div>
      <div className="browser-statusbar__classic">
        <span className="classic-status-destination">
          {!hoveredLink && <i className="classic-status-icon">e</i>}
          {classicStatus}
        </span>
        <span className="classic-status-zone"><i className="classic-status-globe" />Hallunet</span>
        <button className="browser-statusbar__usage classic-status-usage" type="button" disabled={!jobId} onClick={() => openActivity(jobId)} title={jobId ? "Open generation activity" : "No generation activity for this page"}>{summary}</button>
        <span className="classic-status-zoom">⌕&nbsp; 100%</span>
        <i className="classic-resize-grip" aria-hidden="true" />
      </div>
    </footer>
  );
}

export function generationStatus(job?: GenerationJob): string | undefined {
  if (!job) return undefined;
  if (job.status === "failed") return `Failed · ${job.error?.message ?? "generation error"}`;
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "completed") return undefined;
  const progress = job.progress;
  const suffix = progress ? ` · ${progress.approximate ? "~" : ""}${Math.min(99, progress.percent)}%` : "";
  const label = ({
    queued: "Waiting…",
    "preparing-context": "Preparing context…",
    directing: "Directing…",
    generating: "Building page…",
    validating: "Validating…",
    "compiling-styles": "Compiling styles…",
    "resolving-images": "Resolving images…",
    committing: "Finalizing…",
  } as Partial<Record<GenerationJob["phase"], string>>)[job.phase] ?? "Loading…";
  return `${label}${suffix}`;
}

function compactUsage(usage: TokenUsage | undefined, exchangeCount: number, job?: GenerationJob) {
  const live = job?.progress;
  if (live && job && job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
    return `${live.stageIndex}/${live.stageCount} · ${live.approximate ? "~" : ""}${formatTokens(live.currentOutputTokens)} / ${formatTokens(live.maxOutputTokens)}`;
  }
  const requests = usage?.requests ?? exchangeCount;
  if (!usage && requests === 0) return "No stats";
  return `${requests} req · in ${formatTokens(usage?.inputTokens)} · out ${formatTokens(usage?.outputTokens)}`;
}

function formatTokens(value: number | undefined) {
  const amount = value ?? 0;
  if (amount < 1_000) return new Intl.NumberFormat().format(amount);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(amount / 1_000)}k`;
}
