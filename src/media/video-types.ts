export const VIDEO_SCENE_KINDS = ["title", "text", "image", "split", "quote", "stat", "credits"] as const;
export const VIDEO_TRANSITIONS = ["cut", "crossfade", "dip-black", "slide-left", "slide-up", "push", "wipe", "zoom", "blur"] as const;
export const VIDEO_MOTIONS = ["still", "ken-burns-in", "ken-burns-out", "pan-left", "pan-right", "drift", "stagger", "credits-roll"] as const;
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "4:3", "3:2", "1:1", "4:5", "21:9"] as const;
export const VIDEO_MUSIC_TRACK_IDS = [
  "ambient-glass", "documentary-pulse", "warm-memory", "investigative-low",
  "night-drive", "playful-pluck", "minimal-piano", "soft-suspense",
  "resolution-rise", "retro-digital", "quiet-nature", "credits-drift",
] as const;

export type VideoSceneKind = typeof VIDEO_SCENE_KINDS[number];
export type VideoTransition = typeof VIDEO_TRANSITIONS[number];
export type VideoMotion = typeof VIDEO_MOTIONS[number];
export type VideoAspectRatio = typeof VIDEO_ASPECT_RATIOS[number];
export type VideoMusicTrackId = typeof VIDEO_MUSIC_TRACK_IDS[number];
export type VideoPacing = "slow" | "balanced" | "fast";

export interface VideoNarrationPlan {
  text: string;
  lang: string;
  voice?: string;
}

export interface VideoScenePlan {
  id: string;
  kind: VideoSceneKind;
  transition: VideoTransition;
  motion: VideoMotion;
  desiredDurationMs?: number;
  narration?: VideoNarrationPlan;
  musicTrack: VideoMusicTrackId | "inherit" | "silence";
}

export interface VideoPlan {
  videoId: string;
  aspectRatio: VideoAspectRatio;
  pacing: VideoPacing;
  loop: boolean;
  musicIntent?: string;
  scenes: VideoScenePlan[];
}

export interface VideoCaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface VideoTimelineScene {
  id: string;
  startMs: number;
  durationMs: number;
  narrationDurationMs: number;
  captionWords?: VideoCaptionWord[];
}

export interface VideoTimeline {
  videoId: string;
  durationMs: number;
  scenes: VideoTimelineScene[];
  warnings: string[];
}

export type VideoPlaybackStatus = "idle" | "preparing" | "ready" | "playing" | "paused" | "waiting" | "ended" | "error";

export interface VideoMediaState {
  videoId: string;
  status: VideoPlaybackStatus;
  currentTimeMs: number;
  durationMs: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  activeSceneIndex: number;
  progress?: { completed: number; total: number; label: string };
  message?: string;
}

export interface PreparedNarrationTiming {
  durationMs: number;
  captionWords?: VideoCaptionWord[];
}

const BASE_SCENE_DURATION: Readonly<Record<VideoSceneKind, number>> = {
  title: 2_500,
  text: 4_000,
  image: 4_000,
  split: 4_000,
  quote: 4_000,
  stat: 4_000,
  credits: 6_000,
};

const PACING_MULTIPLIER: Readonly<Record<VideoPacing, number>> = {
  slow: 1.25,
  balanced: 1,
  fast: 0.8,
};

export function estimateNarrationDurationMs(text: string, speed = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1_000, Math.round(words / (155 * Math.max(0.6, speed)) * 60_000));
}

export function createVideoTimeline(
  plan: VideoPlan,
  narration: ReadonlyMap<string, PreparedNarrationTiming>,
): VideoTimeline {
  let cursor = 0;
  const scenes = plan.scenes.map((scene) => {
    const prepared = narration.get(scene.id);
    const narrationDurationMs = Math.max(0, Math.round(prepared?.durationMs ?? 0));
    const base = Math.round(BASE_SCENE_DURATION[scene.kind] * PACING_MULTIPLIER[plan.pacing]);
    const spoken = narrationDurationMs > 0 ? narrationDurationMs + 1_000 : 0;
    const durationMs = Math.max(1_000, scene.desiredDurationMs ?? 0, base, spoken);
    const result: VideoTimelineScene = {
      id: scene.id,
      startMs: cursor,
      durationMs,
      narrationDurationMs,
      ...(prepared?.captionWords?.length ? { captionWords: prepared.captionWords } : {}),
    };
    cursor += durationMs;
    return result;
  });
  return { videoId: plan.videoId, durationMs: cursor, scenes, warnings: [] };
}

export function sceneIndexAtTime(timeline: VideoTimeline, currentTimeMs: number): number {
  if (timeline.scenes.length === 0) return -1;
  const bounded = Math.max(0, Math.min(timeline.durationMs, currentTimeMs));
  const index = timeline.scenes.findIndex((scene) => bounded < scene.startMs + scene.durationMs);
  return index >= 0 ? index : timeline.scenes.length - 1;
}
