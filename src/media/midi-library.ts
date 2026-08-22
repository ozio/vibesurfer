import { VIDEO_MUSIC_TRACK_IDS, type VideoMusicTrackId } from "./video-types";

export interface MidiLibraryTrack {
  id: VideoMusicTrackId;
  path: string;
  tags: readonly string[];
  bpm: number;
  synth: "pad" | "keys" | "pluck" | "bass" | "percussion";
}

const metadata: ReadonlyArray<Omit<MidiLibraryTrack, "path">> = [
  { id: "ambient-glass", tags: ["ambient", "calm", "glass"], bpm: 72, synth: "pad" },
  { id: "documentary-pulse", tags: ["documentary", "neutral", "pulse"], bpm: 96, synth: "keys" },
  { id: "warm-memory", tags: ["warm", "memory", "nostalgic"], bpm: 82, synth: "keys" },
  { id: "investigative-low", tags: ["investigative", "low", "tension"], bpm: 88, synth: "bass" },
  { id: "night-drive", tags: ["night", "drive", "steady"], bpm: 112, synth: "pad" },
  { id: "playful-pluck", tags: ["playful", "light", "pluck"], bpm: 124, synth: "pluck" },
  { id: "minimal-piano", tags: ["minimal", "piano", "melancholy"], bpm: 68, synth: "keys" },
  { id: "soft-suspense", tags: ["soft", "suspense", "dark"], bpm: 78, synth: "pad" },
  { id: "resolution-rise", tags: ["resolution", "hopeful", "rise"], bpm: 92, synth: "keys" },
  { id: "retro-digital", tags: ["retro", "digital", "technology"], bpm: 118, synth: "pluck" },
  { id: "quiet-nature", tags: ["quiet", "nature", "gentle"], bpm: 64, synth: "pad" },
  { id: "credits-drift", tags: ["credits", "drift", "ending"], bpm: 76, synth: "pad" },
];

export const MIDI_LIBRARY: readonly MidiLibraryTrack[] = metadata.map((track) => ({
  ...track,
  path: `/media/midi/${track.id}.mid`,
}));

if (new Set(MIDI_LIBRARY.map((track) => track.id)).size !== VIDEO_MUSIC_TRACK_IDS.length) {
  throw new Error("The built-in MIDI catalog is incomplete.");
}

export function midiLibraryTrack(id: string): MidiLibraryTrack | undefined {
  return MIDI_LIBRARY.find((track) => track.id === id);
}

export function bestMidiTrack(intent: string): MidiLibraryTrack {
  const tokens = new Set(intent.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return MIDI_LIBRARY.reduce((best, track) => {
    const score = track.tags.reduce((total, tag) => total + (tokens.has(tag) ? 1 : 0), 0);
    const bestScore = best.tags.reduce((total, tag) => total + (tokens.has(tag) ? 1 : 0), 0);
    return score > bestScore ? track : best;
  }, MIDI_LIBRARY[1]!);
}
