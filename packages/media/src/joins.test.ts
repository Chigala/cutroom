import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyProject, type ProjectDoc } from "@vedit/project";
import { afterAll, describe, expect, it } from "vitest";
import { measureJoins, roomToneStretch } from "./joins.ts";
import { addRoomTone } from "./voice.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-joins-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
/** A 16 kHz mono wav from an ffmpeg expression of t. */
const wav = (name: string, expr: string, seconds: number) => {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${expr}':s=16000:d=${seconds}`,
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    file,
  ]);
  return file;
};
const rms = (file: string, rate: number, a: number, b: number) => {
  const buf = readFileSync(file);
  const at = buf.indexOf("data", 12, "ascii") + 8;
  let s = 0;
  let n = 0;
  for (let i = Math.floor(a * rate); i < b * rate; i++, n++) s += (buf.readInt16LE(at + i * 2) / 32768) ** 2;
  return Math.sqrt(s / n);
};

describe("measuring joins", () => {
  it("hears a level and pitch jump mid-thought, and a cut that lands mid-sound", async () => {
    const files: Record<string, string> = {
      x: wav("x.wav", "0.05*sin(2*PI*150*t)*lt(t,2)", 3),
      y: wav("y.wav", "0.2*sin(2*PI*300*t)", 3),
    };
    const base = emptyProject("t");
    const doc = {
      ...base,
      sources: [
        { id: "x", kind: "video", label: "x", path: files.x, duration: 3, hasAudio: true },
        { id: "y", kind: "video", label: "y", path: files.y, duration: 3, hasAudio: true },
      ],
      transcripts: [
        {
          id: "x",
          language: "en",
          words: [
            { text: "well,", start: 0.02, end: 0.08 },
            { text: "so", start: 0.1, end: 1.95 },
            { text: "and", start: 2.0, end: 2.5 },
          ],
        },
        { id: "y", language: "en", words: [{ text: "then", start: 0, end: 2.5 }] },
      ],
      scenes: [
        { id: "a", source: "x", in: 0, out: 1.98, note: "", volume: 1 },
        { id: "b", source: "y", in: 0.2, out: 2.4, note: "", volume: 1 },
      ],
    } as never as ProjectDoc;
    const [j] = await measureJoins(doc, async (id) => files[id] ?? null);
    expect(j!.scene).toBe("b");
    expect(j!.loudness!).toBeCloseTo(12, 0);
    expect(j!.melody!).toBeGreaterThan(11);
    expect(j!.melody!).toBeLessThan(13);
    expect(j!.inSpeech).toBe(true);
    expect(j!.problems.join(" ")).toMatch(/level jumps up/);
    expect(j!.problems.join(" ")).toMatch(/mid-thought/);
  });
});

describe("room tone", () => {
  it("picks the longest pause, trimmed, and fills dead silence with the room", async () => {
    expect(
      roomToneStretch([
        [1, 1.5],
        [3, 5.2],
      ]),
    ).toEqual({ start: 3.1, duration: 2 });
    expect(roomToneStretch([[1, 1.5]])).toBeNull();
    // Voice, then two seconds of quiet room hiss, a dead-silent gap, and voice again.
    const voice = wav(
      "voice.wav",
      "0.2*sin(2*PI*200*t)*(lt(t,2)+gte(t,4.5))+0.003*(random(0)-0.5)*gte(t,2)*lt(t,3.9)",
      6,
    );
    const out = path.join(dir, "voice.room.wav");
    expect(rms(voice, 16000, 4, 4.4)).toBe(0);
    expect(await addRoomTone(voice, out, 1)).toBe(true);
    expect(rms(out, 48000, 4, 4.4)).toBeGreaterThan(0.0003);
    expect(await addRoomTone(voice, path.join(dir, "none.wav"), 0)).toBe(false);
  });
});

describe("joins as heard", () => {
  it("counts the shot's volume, and doesn't call an unpunctuated run mid-thought", async () => {
    const files: Record<string, string> = {
      x: wav("x2.wav", "0.05*sin(2*PI*150*t)*lt(t,2)", 3),
      y: wav("y2.wav", "0.2*sin(2*PI*300*t)", 3),
    };
    const doc = {
      ...emptyProject("t"),
      sources: [
        { id: "x", kind: "video", label: "x", path: files.x, duration: 3, hasAudio: true },
        { id: "y", kind: "video", label: "y", path: files.y, duration: 3, hasAudio: true },
      ],
      transcripts: [
        { id: "x", language: "en", words: [{ text: "so", start: 0.1, end: 1.95 }] },
        { id: "y", language: "en", words: [{ text: "then", start: 0, end: 2.5 }] },
      ],
      // The louder shot turned down by 12 dB.
      scenes: [
        { id: "a", source: "x", in: 0, out: 2.1, note: "", volume: 1 },
        { id: "b", source: "y", in: 0.2, out: 2.4, note: "", volume: 0.25, crossfade: 0.12 },
      ],
    } as never as ProjectDoc;
    const [j] = await measureJoins(doc, async (id) => files[id] ?? null);
    expect(Math.abs(j!.loudness!)).toBeLessThan(1);
    // No punctuation anywhere before the cut: a pitch reset upward isn't flagged as mid-thought.
    // (The synthetic clips' rooms differ: one is silent, so only the room is flagged.)
    const heard = j!.problems.filter((p) => !p.startsWith("the room"));
    expect(heard, heard.join("; ")).toEqual([]);
  });
});
