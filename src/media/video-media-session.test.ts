// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceAudioSettings } from "../types/browser";
import { VideoMediaSession } from "./video-media-session";
import type { VideoMediaState, VideoPlan, VideoTimeline } from "./video-types";

const host = vi.hoisted(() => ({
  generateMusic: vi.fn(),
  renderSpeech: vi.fn(),
  cancel: vi.fn(),
  getLocal: vi.fn(),
  cacheLocal: vi.fn(),
}));

const audio = vi.hoisted(() => ({
  transport: {
    seconds: 0,
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  },
  gains: [] as Array<{ gain: { rampTo: ReturnType<typeof vi.fn> }; dispose: ReturnType<typeof vi.fn> }>,
  players: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; sync: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  parts: [] as Array<{ start: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  context: {
    rawContext: {
      state: "suspended",
      decodeAudioData: vi.fn(async () => ({ duration: 8 })),
      resume: vi.fn(async () => { audio.context.rawContext.state = "running"; }),
    },
    dispose: vi.fn(),
  },
}));

vi.mock("./media-host-api", () => ({
  generateHostMusic: host.generateMusic,
  renderHostSpeech: host.renderSpeech,
  cancelHostMedia: host.cancel,
  getCachedLocalSpeech: host.getLocal,
  cacheLocalSpeech: host.cacheLocal,
}));

vi.mock("../audio/local-speech", () => ({
  SpeechAssetRenderer: class {
    render = vi.fn(async () => ({ blob: { arrayBuffer: async () => new ArrayBuffer(8) } as Blob, durationMs: 1_000 }));
    dispose = vi.fn();
  },
}));

vi.mock("@tonejs/midi", () => ({
  Midi: class {
    duration = 4;
    tracks = [
      { name: "harmony", channel: 0, notes: [{ time: 0, name: "C4", duration: 1, velocity: 0.4 }] },
      { name: "bass", channel: 1, notes: [{ time: 0, name: "C2", duration: 0.5, velocity: 0.3 }] },
      { name: "pulse", channel: 9, notes: [{ time: 0, name: "C1", duration: 0.08, velocity: 0.2 }] },
    ];
  },
}));

vi.mock("tone", () => {
  class Gain {
    gain = { rampTo: vi.fn() };
    dispose = vi.fn();
    constructor(_value?: number) { audio.gains.push(this); }
    connect() { return this; }
    toDestination() { return this; }
  }
  class Player {
    start = vi.fn();
    stop = vi.fn();
    sync = vi.fn(() => this);
    dispose = vi.fn();
    constructor(_input?: unknown) { audio.players.push(this); }
    connect() { return this; }
  }
  class PolySynth {
    dispose = vi.fn();
    constructor(_input?: unknown) {}
    connect() { return this; }
    triggerAttackRelease() {}
  }
  class Part {
    loop = false;
    loopEnd = 0;
    start = vi.fn();
    dispose = vi.fn();
    constructor(_callback: unknown, _events: unknown) { audio.parts.push(this); }
  }
  class Context {
    rawContext = { state: "suspended", decodeAudioData: vi.fn(async () => ({ duration: 8 })) };
    dispose = vi.fn();
    constructor(_options?: unknown) {}
  }
  return {
    Gain,
    Player,
    PolySynth,
    Part,
    Synth: class {},
    Context,
    getTransport: () => audio.transport,
    getContext: () => audio.context,
    setContext: vi.fn(),
    now: () => 10,
    start: vi.fn(async () => undefined),
  };
});

const baseVoice: VoiceAudioSettings = {
  engine: "local",
  provider: "elevenlabs",
  mediaConnectionId: "media-one",
  model: "kokoro-82m-q8",
  voice: "af_heart",
  availableVoiceIds: ["voice-one"],
  speed: 1,
  musicMode: "built-in",
  musicVolume: 0.22,
};

function plan(overrides: Partial<VideoPlan> = {}): VideoPlan {
  return {
    videoId: "runtime-video",
    aspectRatio: "16:9",
    pacing: "balanced",
    loop: false,
    scenes: [
      { id: "one", kind: "image", transition: "crossfade", motion: "ken-burns-in", musicTrack: "ambient-glass" },
      { id: "two", kind: "credits", transition: "dip-black", motion: "credits-roll", musicTrack: "credits-drift" },
    ],
    ...overrides,
  };
}

function session(voice: VoiceAudioSettings = baseVoice) {
  const states: VideoMediaState[] = [];
  const timelines: VideoTimeline[] = [];
  const value = new VideoMediaSession({
    profileId: "personal",
    voice,
    permissions: { narrationEnabled: true, externalMediaEnabled: true },
    onTimeline: (_requestId, timeline) => timelines.push(timeline),
    onState: (state) => states.push(structuredClone(state)),
  });
  return { value, states, timelines };
}

beforeEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })));
  host.generateMusic.mockReset();
  host.renderSpeech.mockReset();
  host.cancel.mockReset();
  host.getLocal.mockReset().mockResolvedValue(undefined);
  host.cacheLocal.mockReset().mockResolvedValue(undefined);
  audio.transport.seconds = 0;
  audio.transport.start.mockClear();
  audio.transport.pause.mockClear();
  audio.transport.stop.mockClear();
  audio.transport.cancel.mockClear();
  audio.gains.splice(0);
  audio.players.splice(0);
  audio.parts.splice(0);
  audio.context.rawContext.state = "suspended";
  audio.context.rawContext.decodeAudioData.mockClear();
  audio.context.rawContext.resume.mockClear();
  audio.context.dispose.mockClear();
});

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VideoMediaSession", () => {
  it("renders packaged Kokoro through the trusted host and uses its exact WAV duration", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    host.renderSpeech.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
      durationMs: 5_250,
      cacheHit: false,
    });
    const media = session();
    await media.value.prepare("prepare-host-kokoro", plan({ scenes: [{
      id: "voice",
      kind: "text",
      transition: "crossfade",
      motion: "stagger",
      musicTrack: "silence",
      narration: { text: "Exact offline narration.", lang: "en", voice: "af_heart" },
    }] }));

    expect(host.renderSpeech).toHaveBeenCalledWith(expect.objectContaining({
      engine: "local",
      provider: "kokoro",
      model: "kokoro-82m-q8",
      voice: "af_heart",
    }));
    expect(media.timelines[0]?.scenes[0]?.durationMs).toBe(6_250);
    expect(media.states.some((state) => state.progress?.label === "Rendering offline narration")).toBe(true);
    media.value.dispose();
  });

  it("schedules audible narration on the audio clock and rebuilds it without duplicates after pause or seek", async () => {
    const media = session({ ...baseVoice, musicMode: "off" });
    await media.value.prepare("prepare-narration", plan({ scenes: [{
      id: "spoken",
      kind: "text",
      transition: "cut",
      motion: "still",
      musicTrack: "silence",
      narration: { text: "A seekable spoken line.", lang: "en", voice: "af_heart" },
    }] }));
    expect(media.timelines[0]?.warnings).toEqual([]);
    expect(audio.context.rawContext.decodeAudioData).not.toHaveBeenCalled();
    expect(audio.gains).toHaveLength(0);
    expect(audio.players).toHaveLength(0);

    await media.value.play();
    expect(audio.context.rawContext.decodeAudioData).toHaveBeenCalledOnce();
    expect(audio.context.rawContext.resume).toHaveBeenCalledOnce();
    expect(audio.players).toHaveLength(1);
    expect(audio.players[0]?.sync).not.toHaveBeenCalled();
    expect(audio.players[0]?.start).toHaveBeenCalledWith(10.375, 0);

    audio.transport.seconds = 0.6;
    media.value.pause();
    expect(audio.players[0]?.stop).toHaveBeenCalledOnce();
    const playerCountWhilePaused = audio.players.length;
    media.value.seek(0.8 * 1_000);
    expect(audio.players).toHaveLength(playerCountWhilePaused);

    await media.value.play();
    expect(audio.players).toHaveLength(playerCountWhilePaused + 1);
    expect(audio.players.at(-1)?.start).toHaveBeenCalledWith(10.025, 0.45);
    const beforePlayingSeek = audio.players.at(-1)!;
    media.value.seek(900);
    expect(beforePlayingSeek.stop).toHaveBeenCalledOnce();
    expect(audio.players.at(-1)?.start).toHaveBeenCalledWith(10.025, 0.55);
    media.value.dispose();
  });

  it("returns the exact timeline before Web Audio initialization and keeps visual playback alive when one narration decode fails", async () => {
    const media = session({ ...baseVoice, musicMode: "off" });
    await media.value.prepare("prepare-before-audio", plan({ scenes: [{
      id: "spoken",
      kind: "text",
      transition: "cut",
      motion: "still",
      musicTrack: "silence",
      narration: { text: "The timeline must not wait for output initialization.", lang: "en", voice: "af_heart" },
    }] }));

    expect(media.timelines).toHaveLength(1);
    expect(media.states.at(-1)?.status).toBe("ready");
    expect(audio.gains).toHaveLength(0);
    audio.context.rawContext.decodeAudioData.mockRejectedValueOnce(new DOMException("decode failed", "EncodingError"));

    await media.value.play();

    expect(media.states.at(-1)?.status).toBe("playing");
    expect(media.timelines[0]?.warnings).toEqual([expect.stringContaining("decode")]);
    expect(audio.transport.start).toHaveBeenCalledOnce();
    media.value.dispose();
  });

  it("keeps one transport clock through play, pause, seek, crossfade, volume and stop", async () => {
    const media = session();
    await media.value.prepare("prepare-one", plan());
    expect(media.timelines[0]).toMatchObject({ durationMs: 10_000, scenes: [{ durationMs: 4_000 }, { durationMs: 6_000 }] });
    expect(media.states.at(-1)?.status).toBe("ready");

    await media.value.play();
    expect(media.states.at(-1)?.status).toBe("playing");
    expect(audio.parts.length).toBeGreaterThanOrEqual(3);
    audio.transport.seconds = 1.25;
    media.value.pause();
    expect(media.states.at(-1)).toMatchObject({ status: "paused", currentTimeMs: 1_250 });

    media.value.seek(7_000);
    expect(media.states.at(-1)).toMatchObject({ status: "paused", currentTimeMs: 7_000, activeSceneIndex: 1 });
    expect(audio.gains.some((gain) => gain.gain.rampTo.mock.calls.some((call) => call[0] === 0 && call[1] === 0.8))).toBe(true);
    media.value.setVolume(0.35);
    media.value.setMuted(true);
    expect(media.states.at(-1)).toMatchObject({ volume: 0.35, muted: true });

    media.value.stop();
    expect(media.states.at(-1)).toMatchObject({ status: "ready", currentTimeMs: 0 });
    media.value.dispose();
    expect(audio.context.dispose).toHaveBeenCalledOnce();
  });

  it("waits for generated music, supports silent start, then inserts a late result", async () => {
    let resolveMusic!: (asset: { blob: Blob; durationMs: number; cacheHit: boolean }) => void;
    host.generateMusic.mockImplementation(() => new Promise((resolve) => { resolveMusic = resolve; }));
    const media = session({ ...baseVoice, musicMode: "generate-if-requested" });
    await media.value.prepare("prepare-music", plan({ musicIntent: "quiet glass documentary score" }));
    expect(media.states.at(-1)).toMatchObject({ status: "waiting", progress: { label: "Preparing music" } });

    await media.value.play();
    expect(media.states.at(-1)?.status).toBe("waiting");
    await media.value.skipMusic();
    expect(media.states.some((state) => state.status === "playing")).toBe(true);
    const playersBefore = audio.players.length;

    resolveMusic({ blob: { arrayBuffer: async () => new ArrayBuffer(3) } as Blob, durationMs: 10_000, cacheHit: false });
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(audio.players.length).toBeGreaterThan(playersBefore);
    expect(media.states.at(-1)?.status).toBe("playing");
    media.value.dispose();
  });

  it("falls back to the built-in score when external music fails", async () => {
    host.generateMusic.mockRejectedValue(new Error("provider unavailable"));
    const media = session({ ...baseVoice, musicMode: "generate-if-requested" });
    await media.value.prepare("prepare-fallback", plan({ musicIntent: "restrained score" }));
    await Promise.resolve();
    expect(media.timelines[0]?.warnings).toContain("provider unavailable");
    await media.value.play();
    expect(media.states.at(-1)?.status).toBe("playing");
    expect(audio.parts.length).toBeGreaterThan(0);
    media.value.dispose();
  });
});
