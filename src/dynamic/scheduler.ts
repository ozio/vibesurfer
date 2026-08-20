import type { DynamicMode } from "../types/browser";

export const MAX_DYNAMIC_MODEL_JOBS = 2;

export interface RefreshableDynamicRegion {
  id: string;
  refreshSeconds?: number;
}

export function isDynamicTimerEligible(input: {
  mode: DynamicMode;
  activeTab: boolean;
  windowFocused: boolean;
  documentVisible: boolean;
  siteWorldActive: boolean;
  pagePaused: boolean;
}): boolean {
  if (input.mode === "off" || !input.siteWorldActive || input.pagePaused) return false;
  if (input.mode === "always") return true;
  return input.activeTab && input.windowFocused && input.documentVisible;
}

export function dynamicBackoffSeconds(intervalSeconds: number, consecutiveFailures: number): number {
  return Math.min(15 * 60, Math.max(60, intervalSeconds) * 2 ** Math.max(0, consecutiveFailures));
}

export function shouldPauseDynamicRegion(consecutiveFailures: number): boolean {
  return consecutiveFailures >= 3;
}

export function collectDueDynamicRegionIds(input: {
  tabId: string;
  regions: readonly RefreshableDynamicRegion[];
  nextDue: ReadonlyMap<string, number>;
  pausedRegions: ReadonlySet<string>;
  now: number;
}): string[] {
  return input.regions.flatMap((region) => {
    if (!region.refreshSeconds) return [];
    const key = `${input.tabId}:${region.id}`;
    if (input.pausedRegions.has(key) || (input.nextDue.get(key) ?? Number.POSITIVE_INFINITY) > input.now) return [];
    return [region.id];
  });
}

export function coalesceDynamicTargets(current: readonly string[], incoming: readonly string[]): string[] {
  return [...new Set([...current, ...incoming])];
}

export function hasDynamicJobCapacity(activeJobs: number, startingJobs: number): boolean {
  return activeJobs + startingJobs < MAX_DYNAMIC_MODEL_JOBS;
}

export function shouldCancelDynamicJob(input: {
  tabOpen: boolean;
  mode: DynamicMode;
  artifactMatches: boolean;
  eligible: boolean;
}): boolean {
  return !input.tabOpen
    || input.mode === "off"
    || !input.artifactMatches
    || !input.eligible;
}
