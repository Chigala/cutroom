import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { wordStress } from "./hear.ts";

/** A 16 kHz mono WAV of "words": tones, each with its own loudness and pitch, 0.1 s apart. */
function voice(words: { amp: number; hz: number }[]): {
  file: string;
  times: { start: number; end: number }[];
} {
  const rate = 16000;
  const len = 0.4;
  const gap = 0.1;
  const samples = new Int16Array(Math.ceil(words.length * (len + gap) * rate));
  const times = words.map((w, k) => {
    const start = k * (len + gap);
    for (let i = 0; i < len * rate; i++)
      samples[Math.round(start * rate) + i] = Math.round(
        w.amp * 32767 * Math.sin((2 * Math.PI * w.hz * i) / rate),
      );
    return { start, end: start + len };
  });
  const data = Buffer.from(samples.buffer);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(data.length, 40);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "vedit-stress-")), "voice.wav");
  writeFileSync(file, Buffer.concat([head, data]));
  return { file, times };
}

describe("word emphasis", () => {
  it("puts the word said louder and higher on top, and never marks a small function word", async () => {
    const plain = { amp: 0.1, hz: 140 };
    const spec = Array.from({ length: 14 }, (_, i) => (i === 6 || i === 9 ? { amp: 0.45, hz: 240 } : plain));
    const { file, times } = voice(spec);
    const text = [
      "we",
      "really",
      "need",
      "to",
      "talk",
      "about",
      "money",
      "now",
      "because",
      "the",
      "market",
      "moves",
      "fast",
      "today",
    ];
    const stress = await wordStress(
      file,
      times.map((t, i) => ({ ...t, text: text[i]! })),
    );
    // "money" was said hard; so was "the", but it carries no meaning to emphasise.
    expect(stress[6]).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...stress)).toBe(stress[6]);
    expect(stress[9]).toBeLessThanOrEqual(0.4);
  });
});
