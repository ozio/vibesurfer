import type { DynamicManifest } from "../types/browser";

const REGION_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const ACTION = /^(?:state:(?:cart\.add|cart\.remove|cart\.setQuantity|wishlist\.toggle|value\.set)|model:[a-z][a-z0-9.-]{0,63})$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function normalizeDynamicManifest(value: unknown): DynamicManifest | undefined {
  const source = record(value);
  if (!source || source.version !== 1 || !Array.isArray(source.regions) || source.regions.length > 16
      || !Array.isArray(source.actions) || source.actions.length > 32
      || !Array.isArray(source.bindings) || source.bindings.length > 64) return undefined;
  const regions = source.regions.flatMap((candidate) => {
    const item = record(candidate);
    if (!item || typeof item.id !== "string" || !REGION_ID.test(item.id)) return [];
    const refreshSeconds = item.refreshSeconds;
    if (refreshSeconds !== undefined && (!Number.isInteger(refreshSeconds) || Number(refreshSeconds) < 60 || Number(refreshSeconds) > 3_600)) return [];
    return [{ id: item.id, ...(refreshSeconds === undefined ? {} : { refreshSeconds: Number(refreshSeconds) }) }];
  });
  const regionIds = new Set(regions.map((region) => region.id));
  if (regions.length !== source.regions.length || regionIds.size !== regions.length) return undefined;
  const actions = source.actions.flatMap((candidate) => {
    const item = record(candidate);
    if (!item || typeof item.action !== "string" || !ACTION.test(item.action)
        || (item.execution !== "state" && item.execution !== "model") || !Array.isArray(item.targets)
        || !item.action.startsWith(`${item.execution}:`)
        || item.targets.length > 16 || new Set(item.targets).size !== item.targets.length
        || item.targets.some((target) => typeof target !== "string" || !regionIds.has(target))) return [];
    return [{
      action: item.action,
      execution: item.execution as "state" | "model",
      targets: [...new Set(item.targets as string[])],
    }];
  });
  const bindings = source.bindings.filter((binding): binding is string => typeof binding === "string"
    && /^(?:cart\.(?:count|total)|wishlist\.count|value\.[A-Za-z][A-Za-z0-9_.-]{0,63})$/.test(binding));
  if (actions.length !== source.actions.length || bindings.length !== source.bindings.length) return undefined;
  return { version: 1, regions, actions, bindings, localTabs: source.localTabs === true };
}
