import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import midiPackage from "@tonejs/midi";

const { Midi } = midiPackage;

const output = resolve(process.cwd(), "public/media/midi");
await mkdir(output, { recursive: true });

const tracks = [
  ["ambient-glass", 72, [48, 55, 60, 55], 89, 1],
  ["documentary-pulse", 96, [45, 52, 57, 52], 81, 2],
  ["warm-memory", 82, [50, 57, 62, 57], 74, 3],
  ["investigative-low", 88, [38, 45, 50, 44], 70, 4],
  ["night-drive", 112, [41, 48, 53, 48], 82, 5],
  ["playful-pluck", 124, [55, 62, 67, 60], 80, 6],
  ["minimal-piano", 68, [48, 55, 59, 53], 71, 7],
  ["soft-suspense", 78, [40, 47, 52, 46], 68, 8],
  ["resolution-rise", 92, [43, 50, 55, 60], 76, 9],
  ["retro-digital", 118, [45, 52, 57, 64], 86, 10],
  ["quiet-nature", 64, [50, 57, 61, 57], 73, 11],
  ["credits-drift", 76, [46, 53, 58, 53], 77, 12],
];

for (const [id, bpm, roots, leadBase, seed] of tracks) {
  const midi = new Midi();
  midi.name = `VibeSurfer ${id}`;
  midi.header.setTempo(bpm);
  const harmony = midi.addTrack();
  harmony.name = "harmony";
  harmony.instrument.number = id.includes("piano") || id.includes("memory") ? 4 : 89;
  const bass = midi.addTrack();
  bass.name = "bass";
  bass.instrument.number = 38;
  const lead = midi.addTrack();
  lead.name = "lead";
  lead.instrument.number = id.includes("pluck") || id.includes("digital") ? 80 : 88;
  const drums = midi.addTrack();
  drums.name = "pulse";
  drums.channel = 9;

  for (let bar = 0; bar < 8; bar += 1) {
    const root = roots[bar % roots.length];
    const start = bar * 2;
    for (const note of [root, root + (bar % 3 === 0 ? 3 : 4), root + 7]) {
      harmony.addNote({ midi: note, time: start, duration: 1.9, velocity: 0.34 });
    }
    bass.addNote({ midi: root - 12, time: start, duration: 0.9, velocity: 0.42 });
    bass.addNote({ midi: root - 5, time: start + 1, duration: 0.85, velocity: 0.31 });
    for (let beat = 0; beat < 4; beat += 1) {
      const time = start + beat * 0.5;
      const step = (bar * 3 + beat * 2 + seed) % 7;
      lead.addNote({ midi: leadBase + [0, 2, 4, 7, 9, 7, 4][step], time, duration: 0.34, velocity: 0.24 + (beat === 0 ? 0.12 : 0) });
      drums.addNote({ midi: beat % 2 === 0 ? 36 : 42, time, duration: 0.08, velocity: id.includes("ambient") || id.includes("nature") ? 0.08 : 0.2 });
    }
  }
  await writeFile(resolve(output, `${id}.mid`), Buffer.from(midi.toArray()));
}
