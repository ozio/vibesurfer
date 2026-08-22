import { useEffect, useMemo, useState } from "react";
import {
  getPersistedGenerationActivity,
  listPersistedGenerationJobs,
  type GenerationJobRecord,
} from "../../generation/host-api";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab, GenerationJob } from "../../types/browser";
import {
  ActivitySurface,
  type ActivityFilter,
} from "./ActivitySurface";

export function ActivityPage({ tab }: { tab: BrowserTab }) {
  const profileId = useBrowserStore((state) => state.activeProfileId);
  const memoryJobs = useBrowserStore((state) => state.generationJobs);
  const artifacts = useBrowserStore((state) => state.artifacts);
  const [persisted, setPersisted] = useState<GenerationJobRecord[]>([]);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getPersistedGenerationActivity>>>();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const requestedJobId = useMemo(() => activityJobId(tab.location), [tab.location]);
  const [selectedId, setSelectedId] = useState<string | undefined>(requestedJobId);

  useEffect(() => setSelectedId(requestedJobId), [requestedJobId]);
  useEffect(() => {
    let cancelled = false;
    setPersisted([]);
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
    setDetail(undefined);
    if (!selectedId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => void getPersistedGenerationActivity(profileId, selectedId).then((next) => {
      if (!cancelled) setDetail(next);
    }).catch(() => undefined), selectedMemory && isCurrent(selectedMemory.status) ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [profileId, selectedId, selectedMemory?.updatedAt, selectedMemory?.status]);

  const selectedArtifact = selectedId
    ? Object.values(artifacts).find((artifact) => artifact.generationJobId === selectedId)
    : undefined;
  const warnings = selectedMemory?.warnings?.length
    ? selectedMemory.warnings
    : selectedArtifact?.warnings.length
      ? selectedArtifact.warnings
      : undefined;

  return (
    <ActivitySurface
      jobs={jobs}
      selectedId={selectedId}
      selectedMemoryJob={selectedMemory}
      detail={detail}
      exchanges={selectedArtifact?.modelExchanges}
      warnings={warnings}
      filter={filter}
      hasMore={hasMore}
      loadingOlder={loadingOlder}
      onFilterChange={setFilter}
      onSelectJob={setSelectedId}
      onLoadOlder={() => {
        if (loadingOlder) return;
        setLoadingOlder(true);
        void listPersistedGenerationJobs(profileId, 50, offset).then((records) => {
          setPersisted((current) => [...current, ...records]);
          setOffset((current) => current + records.length);
          setHasMore(records.length === 50);
        }).catch(() => undefined).finally(() => setLoadingOlder(false));
      }}
    />
  );
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

function requestSnapshot(job: GenerationJob): Record<string, unknown> {
  return { url: job.normalizedUrl ?? job.requestedUrl, purpose: job.purpose ?? "page", providerId: job.providerId, modelId: job.modelId, settings: job.generationSettingsSnapshot, navigationIntent: job.navigationIntent };
}

function activityJobId(location: string) {
  try { return new URL(location).searchParams.get("job") ?? undefined; } catch { return undefined; }
}

function isCurrent(status: string) {
  return !["completed", "failed", "cancelled"].includes(status);
}
