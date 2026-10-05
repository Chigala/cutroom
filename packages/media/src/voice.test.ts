import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVoiceTrack } from "./voice.ts";

const duration = (file: string) =>
  Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]).toString(),
  );

describe("buildVoiceTrack", () => {
  it("crossfaded segments overlap by exactly their crossfade, so the track matches the cut", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vedit-voice-"));
    const tone = path.join(dir, "tone.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=20", "-ac", "2", tone]);
    const out = path.join(dir, "out.wav");
    // 0-5.1s, then a 0.2s crossfade into 4.9-10s: a 10s cut.
    await buildVoiceTrack(
      [
        { file: tone, start: 0, duration: 5.1, volume: 1 },
        { file: tone, start: 8, duration: 5.1, volume: 1, crossfade: 0.2 },
      ],
      out,
    );
    expect(duration(out)).toBeCloseTo(10, 1);
  });
});
