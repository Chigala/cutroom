import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cutToSpeech, fromSpeechCut } from "./audio.ts";
import { type HeardWindow, needsTranscript, speechMap } from "./hear.ts";

/** Windows a second long every half second, speech scored by the second it starts in. */
function windows(speech: (t: number) => number, seconds: number, label = "speech"): HeardWindow[] {
  return Array.from({ length: seconds * 2 }, (_, i) => {
    const t = i / 2;
    const c = speech(t);
    return { t, d: 1, c: c > 0.1 ? [[label, c]] : [["music", 0.8]] } as HeardWindow;
  });
}

describe("where someone talks", () => {
  it("finds the stretches, padded, and joins close ones", () => {
    // Talking 2-5s and 6-8s (a short pause: one stretch), then again at 20-22s.
    const map = speechMap(
      windows((t) => ((t >= 2 && t < 5) || (t >= 6 && t < 8) || (t >= 20 && t < 22) ? 0.9 : 0), 30),
    );
    expect(map.spans).toEqual([
      [1.25, 9.25],
      [19.25, 23.25],
    ]);
    expect(map.seconds).toBe(7);
    expect(map.peak).toBe(0.9);
  });

  it("counts a shout or a whisper as talking, but not singing or a crowd", () => {
    expect(speechMap(windows(() => 0.8, 4, "shout")).seconds).toBe(4);
    expect(speechMap(windows(() => 0.8, 4, "whispering")).seconds).toBe(4);
    expect(speechMap(windows(() => 0.8, 4, "singing")).seconds).toBe(0);
    expect(speechMap(windows(() => 0.8, 4, "crowd")).seconds).toBe(0);
  });

  it("transcribes when someone clearly talks, even a two-word line in a short clip, and not otherwise", () => {
    const talking = speechMap(windows(() => 0.9, 20));
    const scenery = speechMap(windows(() => 0, 20));
    const murmur = speechMap(windows((t) => (t < 0.5 ? 0.2 : 0), 20));
    const heyBuddy = speechMap(windows((t) => (t < 0.5 ? 0.34 : 0), 1.5));
    expect(needsTranscript(talking, 20)).toBe(true);
    expect(needsTranscript(scenery, 20)).toBe(false);
    expect(needsTranscript(murmur, 20)).toBe(false);
    expect(needsTranscript(heyBuddy, 1.5)).toBe(true);
  });
});

describe("transcribing only the talking", () => {
  /** A 16 kHz mono wav whose sample values say which second of the clip they are. */
  function wav(seconds: number): string {
    const rate = 16000;
    const body = Buffer.alloc(seconds * rate * 2);
    for (let i = 0; i < seconds * rate; i++) body.writeInt16LE(Math.floor(i / rate), i * 2);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + body.length, 4);
    header.write("WAVEfmt ", 8, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(body.length, 40);
    const file = path.join(mkdtempSync(path.join(tmpdir(), "vedit-cut-")), "clip.wav");
    writeFileSync(file, Buffer.concat([header, body]));
    return file;
  }

  it("keeps just the stretches, with a short silence between, and puts words back in the clip's time", async () => {
    const source = wav(30);
    const out = path.join(path.dirname(source), "speech.wav");
    const cut = await cutToSpeech(
      source,
      [
        [2, 5],
        [20, 22],
      ],
      out,
    );
    expect(cut.pieces).toEqual([
      { from: 2, at: 0, length: 3 },
      { from: 20, at: 3.5, length: 2 },
    ]);
    // 3s + 0.5s of silence + 2s.
    const written = readFileSync(out);
    expect((written.length - 44) / 2 / 16000).toBe(5.5);
    // The second piece starts with the clip's 20th second.
    expect(written.readInt16LE(44 + 3.5 * 16000 * 2)).toBe(20);
    expect(written.readInt16LE(44 + 3.2 * 16000 * 2)).toBe(0);

    const words = fromSpeechCut(
      [
        { text: "hello", start: 0.5, end: 0.9 },
        { text: "there", start: 3.6, end: 4.0 },
        { text: "late", start: 2.9, end: 3.3 },
      ],
      cut,
    );
    expect(words).toEqual([
      { text: "hello", start: 2.5, end: 2.9 },
      { text: "there", start: 20.1, end: 20.5 },
      // Running into the silence: kept to the end of its own stretch.
      { text: "late", start: 4.9, end: 5 },
    ]);
  });
});
