import type { VoiceAudioSettings } from "../types/browser";
import { SpeechAssetRenderer } from "../audio/local-speech";
import { isTauri } from "../lib/platform";
import { bestMidiTrack, midiLibraryTrack } from "./midi-library";
import { cacheLocalSpeech, cancelHostMedia, generateHostMusic, getCachedLocalSpeech, renderHostSpeech, type BrowserMediaAsset } from "./media-host-api";
import {
  createVideoTimeline,
  estimateNarrationDurationMs,
  sceneIndexAtTime,
  type PreparedNarrationTiming,
  type VideoMediaState,
  type VideoPlan,
  type VideoTimeline,
} from "./video-types";

type ToneNamespace = typeof import("tone");

interface PreparedSpeech extends PreparedNarrationTiming {
  blob?: Blob;
}

interface MidiNoteEvent {
  time: number;
  name: string;
  duration: number;
  velocity: number;
}

type MidiSynthKind = "pad" | "keys" | "pluck" | "bass" | "percussion";

interface PreparedMidiLayer {
  synth: MidiSynthKind;
  notes: MidiNoteEvent[];
}

interface PreparedMidi {
  duration: number;
  layers: PreparedMidiLayer[];
}

interface DisposableToneNode {
  dispose(): void;
}

export interface VideoMediaSessionOptions {
  profileId: string;
  voice: VoiceAudioSettings;
  permissions: {
    narrationEnabled: boolean;
    externalMediaEnabled: boolean;
  };
  onTimeline: (requestId: string, timeline: VideoTimeline) => void;
  onState: (state: VideoMediaState) => void;
}

let activeSession: VideoMediaSession | undefined;

export class VideoMediaSession {
  readonly #options: VideoMediaSessionOptions;
  readonly #localSpeech = new SpeechAssetRenderer();
  readonly #speech = new Map<string, PreparedSpeech>();
  readonly #midi = new Map<string, PreparedMidi>();
  #plan?: VideoPlan;
  #timeline?: VideoTimeline;
  #tone?: ToneNamespace;
  #audioNodes: DisposableToneNode[] = [];
  #master?: InstanceType<ToneNamespace["Gain"]>;
  #musicBus?: InstanceType<ToneNamespace["Gain"]>;
  #narrationBus?: InstanceType<ToneNamespace["Gain"]>;
  #musicNodes: DisposableToneNode[] = [];
  #activeTrack = "";
  #generatedMusic?: AudioBuffer;
  #timer = 0;
  #status: VideoMediaState["status"] = "idle";
  #currentTimeMs = 0;
  #volume = 1;
  #muted = false;
  #generation = 0;
  #disposed = false;
  #hostRequests = new Set<string>();
  #musicInFlight = false;
  #waitForMusic = false;
  #playWhenReady = false;
  #mediaWarnings: string[] = [];
  #narrationCompleted = 0;
  #narrationTotal = 1;

  constructor(options: VideoMediaSessionOptions) {
    this.#options = options;
  }

  async prepare(requestId: string, plan: VideoPlan): Promise<void> {
    if (activeSession && activeSession !== this) {
      activeSession.pause();
      activeSession.#deactivateAudioGraph();
    }
    const generation = ++this.#generation;
    this.#deactivateAudioGraph();
    this.#speech.clear();
    this.#midi.clear();
    this.#generatedMusic = undefined;
    this.#musicInFlight = false;
    this.#waitForMusic = false;
    this.#playWhenReady = false;
    this.#mediaWarnings = [];
    this.#plan = structuredClone(plan);
    this.#timeline = undefined;
    this.#currentTimeMs = 0;
    this.#setStatus("preparing", { completed: 0, total: Math.max(1, plan.scenes.filter((scene) => scene.narration).length), label: "Preparing narration" });
    const warnings: string[] = [];
    const narrated = plan.scenes.filter((scene) => scene.narration);
    this.#narrationCompleted = 0;
    this.#narrationTotal = Math.max(1, narrated.length);
    const wantsGeneratedMusic = Boolean(plan.musicIntent && this.#options.voice.musicMode === "generate-if-requested"
      && this.#options.permissions.externalMediaEnabled && this.#options.voice.provider === "elevenlabs"
      && this.#options.voice.mediaConnectionId && this.#options.voice.availableVoiceIds.length > 0);
    if (wantsGeneratedMusic) {
      const estimatedNarration = new Map(plan.scenes.flatMap((scene) => scene.narration
        ? [[scene.id, { durationMs: estimateNarrationDurationMs(scene.narration.text, this.#options.voice.speed) }] as const]
        : []));
      const estimatedDurationMs = Math.max(3_000, createVideoTimeline(plan, estimatedNarration).durationMs);
      this.#musicInFlight = true;
      this.#waitForMusic = true;
      void this.#prepareGeneratedMusic(plan.musicIntent!, estimatedDurationMs, generation);
    }
    for (const [index, scene] of narrated.entries()) {
      if (generation !== this.#generation || this.#disposed) return;
      const narration = scene.narration!;
      let prepared: PreparedSpeech;
      try {
        prepared = await this.#renderNarration(scene.id, narration.text, narration.lang, narration.voice);
      } catch (error) {
        prepared = { durationMs: estimateNarrationDurationMs(narration.text, this.#options.voice.speed) };
        warnings.push(`${scene.id}: ${error instanceof Error ? error.message : "Narration unavailable"}`);
      }
      this.#speech.set(scene.id, prepared);
      this.#narrationCompleted = index + 1;
      this.#setStatus("preparing", { completed: index + 1, total: Math.max(1, narrated.length), label: "Preparing narration" });
    }
    if (generation !== this.#generation || this.#disposed) return;

    const timeline = createVideoTimeline(plan, this.#speech);
    timeline.warnings.push(...warnings, ...this.#mediaWarnings);
    this.#timeline = timeline;
    await this.#preloadMidi(plan).catch((error: unknown) => {
      timeline.warnings.push(error instanceof Error ? error.message : "Built-in music could not be prepared.");
    });
    if (generation !== this.#generation || this.#disposed) return;
    this.#options.onTimeline(requestId, timeline);
    if (wantsGeneratedMusic && this.#musicInFlight) {
      this.#setStatus("waiting", { completed: 0, total: 1, label: "Preparing music" });
    } else {
      this.#setStatus("ready");
    }
  }

  async play(): Promise<void> {
    if (!this.#plan || !this.#timeline || this.#disposed) return;
    if (this.#waitForMusic && this.#musicInFlight) {
      this.#playWhenReady = true;
      this.#setStatus("waiting", { completed: 0, total: 1, label: "Preparing music" });
      return;
    }
    try {
      if (activeSession && activeSession !== this) {
        activeSession.pause();
        activeSession.#deactivateAudioGraph();
      }
      activeSession = this;
      const tone = await this.#ensureTone();
      await tone.start();
      if (!this.#master) await this.#activateAudioGraph();
      const transport = tone.getTransport();
      if (this.#currentTimeMs >= this.#timeline.durationMs) this.#currentTimeMs = 0;
      transport.seconds = this.#currentTimeMs / 1_000;
      transport.start();
      this.#status = "playing";
      this.#startTimer();
      this.#emitState();
    } catch (error) {
      this.#status = "error";
      this.#timeline.warnings.push(error instanceof Error ? error.message : "Audio playback could not start.");
      this.#stopTimer();
      this.#emitState();
      throw error;
    }
  }

  pause(): void {
    this.#playWhenReady = false;
    if (this.#tone) {
      const transport = this.#tone.getTransport();
      this.#currentTimeMs = Math.min(this.#timeline?.durationMs ?? 0, transport.seconds * 1_000);
      transport.pause();
    }
    this.#stopTimer();
    if (this.#status !== "idle" && this.#status !== "error" && this.#status !== "ended") this.#status = "paused";
    this.#emitState();
  }

  stop(): void {
    this.#playWhenReady = false;
    if (this.#tone) {
      const transport = this.#tone.getTransport();
      transport.stop();
      transport.seconds = 0;
    }
    this.#currentTimeMs = 0;
    this.#stopTimer();
    this.#status = this.#timeline ? "ready" : "idle";
    this.#emitState();
  }

  seek(currentTimeMs: number): void {
    if (!this.#timeline) return;
    this.#currentTimeMs = Math.max(0, Math.min(this.#timeline.durationMs, currentTimeMs));
    if (this.#tone && this.#master) {
      this.#tone.getTransport().seconds = this.#currentTimeMs / 1_000;
      this.#syncMusicForCurrentScene(true);
    }
    if (this.#status === "ended" && this.#currentTimeMs < this.#timeline.durationMs) this.#status = "paused";
    this.#emitState();
  }

  setVolume(volume: number): void {
    this.#volume = Math.max(0, Math.min(1, volume));
    this.#applyMasterVolume();
    this.#emitState();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    this.#applyMasterVolume();
    this.#emitState();
  }

  async skipMusic(): Promise<void> {
    this.#waitForMusic = false;
    this.#disposeMusicNodes();
    this.#activeTrack = "silence";
    if (this.#status === "waiting") this.#status = "ready";
    const shouldPlay = this.#playWhenReady;
    this.#playWhenReady = false;
    this.#emitState();
    if (shouldPlay) await this.play();
  }

  dispose(): void {
    const ownsAudioContext = activeSession === this;
    this.#disposed = true;
    this.#generation += 1;
    for (const requestId of this.#hostRequests) void cancelHostMedia(requestId).catch(() => undefined);
    this.#hostRequests.clear();
    this.#stopTimer();
    this.#deactivateAudioGraph();
    this.#localSpeech.dispose();
    if (activeSession === this) activeSession = undefined;
    if (ownsAudioContext && this.#tone) this.#tone.getContext().dispose();
  }

  async #renderNarration(sceneId: string, text: string, lang: string, requestedVoice?: string): Promise<PreparedSpeech> {
    if (!this.#options.permissions.narrationEnabled) return { durationMs: 0 };
    const availableVoices = this.#options.voice.engine === "cloud" && this.#options.voice.availableVoiceIds.length
      ? this.#options.voice.availableVoiceIds
      : [this.#options.voice.voice];
    const voice = requestedVoice && availableVoices.includes(requestedVoice)
      ? requestedVoice
      : this.#options.voice.voice;
    const russian = /^ru(?:-|$)/i.test(lang) || /[А-Яа-яЁё]/.test(text);
    const engine = this.#options.voice.engine === "local" && russian ? "system" : this.#options.voice.engine;
    if (engine === "local") {
      return this.#renderLocalNarration(sceneId, text, lang, voice);
    }
    if (engine === "cloud" && (!this.#options.permissions.externalMediaEnabled || !this.#options.voice.mediaConnectionId)) {
      throw new Error("Cloud narration is not enabled or has no verified media connection.");
    }
    if (engine === "system") {
      try {
        return await this.#renderHostNarration("system", text, lang, voice === "default" || this.#options.voice.engine === "local" ? "" : voice);
      } catch (systemError) {
        if (!russian) return this.#renderLocalNarration(sceneId, text, lang, "af_heart");
        const cloudVoice = this.#options.voice.availableVoiceIds[0];
        if (cloudVoice && this.#options.permissions.externalMediaEnabled && this.#options.voice.mediaConnectionId
            && this.#options.voice.provider === "elevenlabs") {
          return this.#renderHostNarration("cloud", text, lang, cloudVoice, "eleven_multilingual_v2");
        }
        throw new Error(`System speech export was unavailable; this scene will remain caption-only. ${systemError instanceof Error ? systemError.message : ""}`.trim());
      }
    }
    return this.#renderHostNarration("cloud", text, lang, voice);
  }

  async #renderLocalNarration(sceneId: string, text: string, lang: string, voice: string): Promise<PreparedSpeech> {
    const cacheKey = {
      profileId: this.#options.profileId,
      model: "kokoro-82m-q8",
      voice,
      speed: this.#options.voice.speed,
      text,
      lang,
    };
    const cached = await getCachedLocalSpeech(cacheKey).catch(() => undefined);
    if (cached) return { blob: cached.blob, durationMs: cached.durationMs };
    if (isTauri()) {
      this.#setStatus("preparing", {
        completed: this.#narrationCompleted,
        total: this.#narrationTotal,
        label: "Rendering offline narration",
      });
      return this.#renderHostNarration("local", text, lang, "af_heart", "kokoro-82m-q8");
    }
    const asset = await this.#localSpeech.render(
      { id: `video-${sceneId}-${crypto.randomUUID()}`, text, voice, speed: this.#options.voice.speed },
      (label) => this.#setStatus("preparing", {
        completed: this.#narrationCompleted,
        total: this.#narrationTotal,
        label,
      }),
    );
    const persisted = await cacheLocalSpeech(cacheKey, asset).catch(() => undefined);
    return persisted ? { blob: persisted.blob, durationMs: persisted.durationMs } : { blob: asset.blob, durationMs: asset.durationMs };
  }

  async #renderHostNarration(engine: "local" | "system" | "cloud", text: string, lang: string, voice: string, model = this.#options.voice.model): Promise<PreparedSpeech> {
    const requestId = `speech-${crypto.randomUUID()}`;
    this.#hostRequests.add(requestId);
    let asset: BrowserMediaAsset;
    try {
      asset = await renderHostSpeech({
        requestId,
        profileId: this.#options.profileId,
        engine,
        ...(engine === "cloud" && this.#options.voice.mediaConnectionId ? { connectionId: this.#options.voice.mediaConnectionId } : {}),
        provider: engine === "local" ? "kokoro" : this.#options.voice.provider,
        model,
        voice,
        speed: this.#options.voice.speed,
        text,
        lang,
      });
    } finally {
      this.#hostRequests.delete(requestId);
    }
    return { blob: asset.blob, durationMs: asset.durationMs, ...(asset.captionWords ? { captionWords: asset.captionWords } : {}) };
  }

  async #ensureTone(): Promise<ToneNamespace> {
    const tone = this.#tone ??= await import("tone");
    if (tone.getContext().rawContext.state === "closed") tone.setContext(new tone.Context({ latencyHint: "playback" }));
    return tone;
  }

  async #decode(blob: Blob): Promise<AudioBuffer> {
    const tone = await this.#ensureTone();
    const raw = tone.getContext().rawContext as AudioContext;
    return raw.decodeAudioData(await blob.arrayBuffer());
  }

  async #activateAudioGraph(): Promise<void> {
    const tone = await this.#ensureTone();
    const transport = tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.seconds = this.#currentTimeMs / 1_000;
    this.#master = new tone.Gain(this.#muted ? 0 : this.#volume).toDestination();
    this.#musicBus = new tone.Gain(this.#options.voice.musicVolume).connect(this.#master);
    this.#narrationBus = new tone.Gain(1).connect(this.#master);
    this.#audioNodes.push(this.#master, this.#musicBus, this.#narrationBus);

    if (this.#timeline && this.#plan) {
      for (const scene of this.#plan.scenes) {
        const prepared = this.#speech.get(scene.id);
        const timing = this.#timeline.scenes.find((candidate) => candidate.id === scene.id);
        if (!prepared?.blob || !timing || !this.#narrationBus) continue;
        try {
          const buffer = await this.#decode(prepared.blob);
          const player = new tone.Player(buffer).connect(this.#narrationBus);
          player.sync().start((timing.startMs + 350) / 1_000);
          this.#audioNodes.push(player);
        } catch (error) {
          this.#timeline.warnings.push(error instanceof Error ? error.message : `Could not decode narration for ${scene.id}.`);
        }
      }
    }
    this.#syncMusicForCurrentScene(true);
  }

  #deactivateAudioGraph(): void {
    if (this.#tone) {
      const transport = this.#tone.getTransport();
      transport.pause();
      transport.cancel();
    }
    this.#disposeMusicNodes();
    for (const node of this.#audioNodes.splice(0)) {
      try { node.dispose(); } catch { /* already released */ }
    }
    this.#master = undefined;
    this.#musicBus = undefined;
    this.#narrationBus = undefined;
    this.#activeTrack = "";
  }

  async #preloadMidi(plan: VideoPlan): Promise<void> {
    if (this.#options.voice.musicMode === "off") return;
    const fallback = plan.musicIntent ? bestMidiTrack(plan.musicIntent).id : undefined;
    const ids = new Set(plan.scenes.map((scene) => scene.musicTrack).filter((id) => id !== "inherit" && id !== "silence"));
    if (fallback) ids.add(fallback);
    await Promise.all([...ids].map(async (id) => {
      const track = midiLibraryTrack(id);
      if (!track || this.#midi.has(id)) return;
      const response = await fetch(track.path, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Built-in MIDI ${id} could not be loaded.`);
      const module = await import("@tonejs/midi");
      const midi = new module.Midi(await response.arrayBuffer());
      const layers = midi.tracks.flatMap((midiTrack): PreparedMidiLayer[] => {
        if (!midiTrack.notes.length) return [];
        const name = midiTrack.name.toLowerCase();
        const synth: MidiSynthKind = midiTrack.channel === 9 || /(?:drum|pulse|percussion)/.test(name)
          ? "percussion"
          : name.includes("bass") ? "bass"
            : name.includes("harmony") ? (track.synth === "keys" ? "keys" : "pad")
              : track.synth;
        return [{ synth, notes: midiTrack.notes.map((note) => ({
          time: note.time,
          name: note.name,
          duration: Math.max(0.04, note.duration),
          velocity: Math.max(0.04, note.velocity),
        })) }];
      });
      this.#midi.set(id, { duration: Math.max(0.25, midi.duration), layers });
    }));
  }

  #resolvedMusicTrack(sceneIndex: number): string {
    if (!this.#plan || this.#options.voice.musicMode === "off") return "silence";
    if (this.#musicInFlight && !this.#generatedMusic) return "silence";
    for (let index = Math.max(0, sceneIndex); index >= 0; index -= 1) {
      const selected = this.#plan.scenes[index]?.musicTrack;
      if (selected && selected !== "inherit") return selected;
    }
    return this.#plan.musicIntent ? bestMidiTrack(this.#plan.musicIntent).id : "silence";
  }

  #syncMusicForCurrentScene(force = false): void {
    if (!this.#timeline || !this.#tone || !this.#musicBus) return;
    if (this.#generatedMusic) {
      if (force || this.#activeTrack !== "generated") this.#startGeneratedMusic();
      return;
    }
    const index = sceneIndexAtTime(this.#timeline, this.#currentTimeMs);
    const id = this.#resolvedMusicTrack(index);
    if (!force && id === this.#activeTrack) return;
    this.#startMidiMusic(id);
  }

  #startMidiMusic(id: string): void {
    this.#disposeMusicNodes(0.8);
    this.#activeTrack = id;
    if (id === "silence" || !this.#tone || !this.#musicBus) return;
    const prepared = this.#midi.get(id);
    if (!prepared) return;
    const tone = this.#tone;
    const gain = new tone.Gain(0).connect(this.#musicBus);
    const transport = tone.getTransport();
    for (const layer of prepared.layers) {
      const options = layer.synth === "pad"
        ? { oscillator: { type: "sine8" as const }, envelope: { attack: 0.7, decay: 0.8, sustain: 0.55, release: 1.8 } }
        : layer.synth === "keys"
          ? { oscillator: { type: "triangle8" as const }, envelope: { attack: 0.015, decay: 0.35, sustain: 0.24, release: 0.7 } }
          : layer.synth === "pluck"
            ? { oscillator: { type: "sawtooth8" as const }, envelope: { attack: 0.005, decay: 0.14, sustain: 0.08, release: 0.28 } }
            : layer.synth === "bass"
              ? { oscillator: { type: "square8" as const }, envelope: { attack: 0.02, decay: 0.25, sustain: 0.36, release: 0.45 } }
              : { oscillator: { type: "square32" as const }, envelope: { attack: 0.001, decay: 0.05, sustain: 0.01, release: 0.06 } };
      const synth = new tone.PolySynth({ maxPolyphony: layer.synth === "percussion" ? 8 : 16, voice: tone.Synth, options }).connect(gain);
      const part = new tone.Part((time, note: MidiNoteEvent) => {
        synth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
      }, layer.notes);
      part.loop = true;
      part.loopEnd = prepared.duration;
      part.start(transport.seconds, transport.seconds % prepared.duration);
      this.#musicNodes.push(part, synth);
    }
    gain.gain.rampTo(1, 0.8);
    this.#musicNodes.push(gain);
  }

  #startGeneratedMusic(): void {
    if (!this.#tone || !this.#musicBus || !this.#generatedMusic) return;
    this.#disposeMusicNodes(0.8);
    const tone = this.#tone;
    const gain = new tone.Gain(0).connect(this.#musicBus);
    const player = new tone.Player({ url: this.#generatedMusic, loop: true, fadeIn: 0.8, fadeOut: 0.8 }).connect(gain);
    const transport = tone.getTransport();
    player.sync().start(transport.seconds, transport.seconds % Math.max(0.25, this.#generatedMusic.duration));
    gain.gain.rampTo(1, 0.8);
    this.#musicNodes.push(player, gain);
    this.#activeTrack = "generated";
  }

  #disposeMusicNodes(fadeSeconds = 0): void {
    const nodes = this.#musicNodes.splice(0);
    if (fadeSeconds > 0) {
      const gain = nodes.at(-1) as (DisposableToneNode & { gain?: { rampTo(value: number, seconds: number): void } }) | undefined;
      gain?.gain?.rampTo(0, fadeSeconds);
      window.setTimeout(() => nodes.forEach((node) => { try { node.dispose(); } catch { /* released */ } }), fadeSeconds * 1_000 + 50);
    } else {
      nodes.forEach((node) => { try { node.dispose(); } catch { /* released */ } });
    }
  }

  async #prepareGeneratedMusic(intent: string, durationMs: number, generation: number): Promise<void> {
    const requestId = `music-${crypto.randomUUID()}`;
    this.#hostRequests.add(requestId);
    try {
      const asset: BrowserMediaAsset = await generateHostMusic({
        requestId,
        profileId: this.#options.profileId,
        connectionId: this.#options.voice.mediaConnectionId!,
        prompt: intent,
        durationMs,
      });
      if (generation !== this.#generation || this.#disposed) return;
      this.#generatedMusic = await this.#decode(asset.blob);
      this.#musicInFlight = false;
      this.#waitForMusic = false;
      if (activeSession === this && this.#status === "playing") this.#startGeneratedMusic();
      const shouldPlay = this.#playWhenReady;
      this.#playWhenReady = false;
      if (this.#status === "waiting") this.#status = "ready";
      this.#emitState();
      if (shouldPlay) await this.play().catch(() => undefined);
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) return;
      this.#musicInFlight = false;
      this.#waitForMusic = false;
      const message = error instanceof Error ? error.message : "Generated music was unavailable.";
      if (this.#timeline) this.#timeline.warnings.push(message);
      else this.#mediaWarnings.push(message);
      const shouldPlay = this.#playWhenReady;
      this.#playWhenReady = false;
      if (this.#status === "waiting") this.#status = "ready";
      if (activeSession === this && this.#status === "playing") this.#syncMusicForCurrentScene(true);
      this.#emitState();
      if (shouldPlay) await this.play().catch(() => undefined);
    } finally {
      this.#hostRequests.delete(requestId);
    }
  }

  #startTimer(): void {
    this.#stopTimer();
    this.#timer = window.setInterval(() => {
      if (!this.#tone || !this.#timeline || this.#status !== "playing") return;
      this.#currentTimeMs = Math.min(this.#timeline.durationMs, this.#tone.getTransport().seconds * 1_000);
      const sceneIndex = sceneIndexAtTime(this.#timeline, this.#currentTimeMs);
      this.#syncMusicForCurrentScene();
      const scene = this.#timeline.scenes[sceneIndex];
      const narrationActive = Boolean(scene && scene.narrationDurationMs > 0
        && this.#currentTimeMs >= scene.startMs + 350
        && this.#currentTimeMs < scene.startMs + 350 + scene.narrationDurationMs);
      this.#musicBus?.gain.rampTo(narrationActive ? this.#options.voice.musicVolume * 0.22 : this.#options.voice.musicVolume, narrationActive ? 0.12 : 0.35);
      if (this.#currentTimeMs >= this.#timeline.durationMs) {
        if (this.#plan?.loop) {
          this.seek(0);
        } else {
          this.#tone.getTransport().pause();
          this.#status = "ended";
          this.#stopTimer();
        }
      }
      this.#emitState();
    }, 100);
  }

  #stopTimer(): void {
    if (this.#timer) window.clearInterval(this.#timer);
    this.#timer = 0;
  }

  #applyMasterVolume(): void {
    this.#master?.gain.rampTo(this.#muted ? 0 : this.#volume, 0.08);
  }

  #setStatus(status: VideoMediaState["status"], progress?: VideoMediaState["progress"]): void {
    this.#status = status;
    this.#emitState(progress);
  }

  #emitState(progress?: VideoMediaState["progress"]): void {
    if (!this.#plan) return;
    this.#options.onState({
      videoId: this.#plan.videoId,
      status: this.#status,
      currentTimeMs: Math.round(this.#currentTimeMs),
      durationMs: this.#timeline?.durationMs ?? 0,
      paused: this.#status !== "playing",
      muted: this.#muted,
      volume: this.#volume,
      activeSceneIndex: this.#timeline ? sceneIndexAtTime(this.#timeline, this.#currentTimeMs) : 0,
      ...(progress ? { progress } : {}),
      ...(this.#timeline?.warnings.length ? { message: this.#timeline.warnings.at(-1) } : {}),
    });
  }
}
