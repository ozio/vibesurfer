import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { MIDI_LIBRARY, bestMidiTrack } from "./midi-library";

interface MidiManifest {
  version: number;
  license: string;
  tracks: Array<{
    id: string;
    file: string;
    tags: string[];
    bpm: number;
    key: string;
    loopStart: number;
    loopEnd: number;
    license: string;
  }>;
}

describe("built-in MIDI library", () => {
  it("ships twelve valid original loops with stable manifest metadata", () => {
    const root = resolve(process.cwd(), "public/media/midi");
    const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as MidiManifest;
    expect(manifest).toMatchObject({ version: 1, license: "CC0-1.0" });
    expect(manifest.tracks).toHaveLength(12);
    expect(new Set(manifest.tracks.map((track) => track.id))).toEqual(new Set(MIDI_LIBRARY.map((track) => track.id)));
    for (const track of manifest.tracks) {
      expect(track).toMatchObject({ loopStart: 0, license: "CC0-1.0" });
      expect(track.tags.length).toBeGreaterThanOrEqual(3);
      expect(track.bpm).toBeGreaterThan(0);
      expect(track.key).not.toBe("");
      const midi = new Midi(readFileSync(resolve(root, track.file)));
      expect(midi.tracks).toHaveLength(4);
      expect(midi.tracks.some((layer) => layer.channel === 9)).toBe(true);
      expect(midi.duration).toBeCloseTo(track.loopEnd, 2);
    }
  });

  it("selects a tag-matching safe ID and never invents a URL", () => {
    expect(bestMidiTrack("playful light pluck").id).toBe("playful-pluck");
    expect(bestMidiTrack("https://evil.example/score").path).toMatch(/^\/media\/midi\/[a-z-]+\.mid$/);
  });
});
