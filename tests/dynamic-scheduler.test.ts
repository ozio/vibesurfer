import { describe, expect, it } from "vitest";

import {
  coalesceDynamicTargets,
  collectDueDynamicRegionIds,
  dynamicBackoffSeconds,
  hasDynamicJobCapacity,
  isDynamicTimerEligible,
  shouldCancelDynamicJob,
  shouldPauseDynamicRegion,
} from "../src/dynamic/scheduler";

describe("dynamic scheduler policy", () => {
  const focused = {
    activeTab: true,
    windowFocused: true,
    documentVisible: true,
    siteWorldActive: true,
    pagePaused: false,
  };

  it("runs active mode only in the focused visible active tab", () => {
    expect(isDynamicTimerEligible({ mode: "active", ...focused })).toBe(true);
    expect(isDynamicTimerEligible({ mode: "active", ...focused, activeTab: false })).toBe(false);
    expect(isDynamicTimerEligible({ mode: "active", ...focused, windowFocused: false })).toBe(false);
    expect(isDynamicTimerEligible({ mode: "active", ...focused, documentVisible: false })).toBe(false);
  });

  it("allows background tabs in always mode but stops off, archived, and page-paused work", () => {
    expect(isDynamicTimerEligible({ mode: "always", ...focused, activeTab: false, windowFocused: false })).toBe(true);
    expect(isDynamicTimerEligible({ mode: "off", ...focused })).toBe(false);
    expect(isDynamicTimerEligible({ mode: "always", ...focused, siteWorldActive: false })).toBe(false);
    expect(isDynamicTimerEligible({ mode: "always", ...focused, pagePaused: true })).toBe(false);
  });

  it("backs off exponentially to fifteen minutes and pauses after the third failure", () => {
    expect(dynamicBackoffSeconds(60, 1)).toBe(120);
    expect(dynamicBackoffSeconds(60, 2)).toBe(240);
    expect(dynamicBackoffSeconds(600, 3)).toBe(900);
    expect(shouldPauseDynamicRegion(2)).toBe(false);
    expect(shouldPauseDynamicRegion(3)).toBe(true);
  });

  it("batches all due unpaused regions from one page into one target list", () => {
    const nextDue = new Map([
      ["tab-1:news", 1_000],
      ["tab-1:status", 2_000],
      ["tab-1:later", 9_000],
    ]);
    expect(collectDueDynamicRegionIds({
      tabId: "tab-1",
      regions: [
        { id: "news", refreshSeconds: 60 },
        { id: "status", refreshSeconds: 60 },
        { id: "later", refreshSeconds: 60 },
        { id: "manual-only" },
      ],
      nextDue,
      pausedRegions: new Set(["tab-1:status"]),
      now: 3_000,
    })).toEqual(["news"]);
  });

  it("coalesces repeated timer targets and enforces two global model jobs", () => {
    expect(coalesceDynamicTargets(["news", "status"], ["status", "thread"])).toEqual(["news", "status", "thread"]);
    expect(hasDynamicJobCapacity(0, 1)).toBe(true);
    expect(hasDynamicJobCapacity(1, 1)).toBe(false);
    expect(hasDynamicJobCapacity(2, 0)).toBe(false);
  });

  it("cancels closed, replaced, disabled, and newly ineligible background jobs", () => {
    const running = { tabOpen: true, mode: "active" as const, artifactMatches: true, eligible: true };
    expect(shouldCancelDynamicJob(running)).toBe(false);
    expect(shouldCancelDynamicJob({ ...running, tabOpen: false })).toBe(true);
    expect(shouldCancelDynamicJob({ ...running, artifactMatches: false })).toBe(true);
    expect(shouldCancelDynamicJob({ ...running, mode: "off" })).toBe(true);
    expect(shouldCancelDynamicJob({ ...running, eligible: false })).toBe(true);
  });
});
