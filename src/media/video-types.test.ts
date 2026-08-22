import { describe, expect, it } from "vitest";
import { createVideoTimeline, sceneIndexAtTime, type VideoPlan } from "./video-types";

function plan(overrides: Partial<VideoPlan> = {}): VideoPlan {
  return {
    videoId: "reference-video",
    aspectRatio: "16:9",
    pacing: "balanced",
    loop: false,
    scenes: [
      { id: "title", kind: "title", transition: "cut", motion: "still", musicTrack: "silence", desiredDurationMs: 2_000, narration: { text: "Opening", lang: "en" } },
      { id: "image", kind: "image", transition: "crossfade", motion: "ken-burns-in", musicTrack: "ambient-glass", desiredDurationMs: 10_000, narration: { text: "Short narration", lang: "en" } },
      { id: "credits", kind: "credits", transition: "dip-black", motion: "credits-roll", musicTrack: "credits-drift" },
    ],
    ...overrides,
  };
}

describe("video timeline", () => {
  it("extends a scene for measured speech and never clips it at the desired hold", () => {
    const timeline = createVideoTimeline(plan(), new Map([
      ["title", { durationMs: 7_200 }],
      ["image", { durationMs: 2_000 }],
    ]));
    expect(timeline.scenes[0]).toMatchObject({ startMs: 0, durationMs: 8_200, narrationDurationMs: 7_200 });
    expect(timeline.scenes[1]).toMatchObject({ startMs: 8_200, durationMs: 10_000, narrationDurationMs: 2_000 });
    expect(timeline.scenes[2]).toMatchObject({ startMs: 18_200, durationMs: 6_000, narrationDurationMs: 0 });
    expect(timeline.durationMs).toBe(24_200);
  });

  it("uses scene-type bases and pacing only when desired time or speech does not need longer", () => {
    const fast = createVideoTimeline(plan({ pacing: "fast", scenes: [
      { id: "title", kind: "title", transition: "cut", motion: "still", musicTrack: "silence" },
      { id: "text", kind: "text", transition: "cut", motion: "still", musicTrack: "silence" },
      { id: "credits", kind: "credits", transition: "cut", motion: "still", musicTrack: "silence" },
    ] }), new Map());
    expect(fast.scenes.map((scene) => scene.durationMs)).toEqual([2_000, 3_200, 4_800]);
    expect(fast.durationMs).toBe(10_000);
  });

  it("maps scrubs and the exact end to stable scene indexes", () => {
    const timeline = createVideoTimeline(plan(), new Map([
      ["title", { durationMs: 1_000 }],
      ["image", { durationMs: 1_000 }],
    ]));
    expect(sceneIndexAtTime(timeline, -100)).toBe(0);
    expect(sceneIndexAtTime(timeline, timeline.scenes[1]!.startMs)).toBe(1);
    expect(sceneIndexAtTime(timeline, timeline.durationMs)).toBe(2);
  });
});
