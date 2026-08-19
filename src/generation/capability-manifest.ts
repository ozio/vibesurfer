import {
  CAPABILITY_EXECUTION_TARGETS,
  CAPABILITY_IDS,
  type ArtifactCapabilityUse,
} from "../types/browser";

const capabilityIds = new Set<string>(CAPABILITY_IDS);
const executionTargets = new Set<string>(CAPABILITY_EXECUTION_TARGETS);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

export function normalizeCapabilityManifest(value: unknown): ArtifactCapabilityUse[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: ArtifactCapabilityUse[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, 64)) {
    const item = record(candidate);
    if (!item) continue;
    const id = boundedString(item.id, 80);
    const version = boundedString(item.version, 80);
    const execution = boundedString(item.execution, 32);
    const instances = item.instances;
    if (!id || seen.has(id) || !capabilityIds.has(id) || !version || !execution || !executionTargets.has(execution)
      || typeof instances !== "number" || !Number.isInteger(instances) || instances < 1 || instances > 256) continue;
    seen.add(id);
    result.push({
      id: id as ArtifactCapabilityUse["id"],
      version,
      execution: execution as ArtifactCapabilityUse["execution"],
      instances,
      noticeIds: Array.isArray(item.noticeIds)
        ? item.noticeIds.slice(0, 16).flatMap((notice) => boundedString(notice, 160) ?? [])
        : [],
    });
  }
  return result;
}
