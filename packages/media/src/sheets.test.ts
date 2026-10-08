import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { contactSheets, frameStrip, loudStretches, segmentsOf } from "./sheets.ts";
import { grabFrame } from "./transcode.ts";

describe("segmentsOf", () => {
  it("cuts at shot changes and splits long shots evenly", () => {
    const s = segmentsOf(20, [4, 4.3]);
    expect(s[0]).toEqual({ start: 0, end: 4.3 }); // the 0.3s sliver merged in
    expect(s.slice(1).every((x) => x.end - x.start <= 6)).toBe(true);
    expect(s.at(-1)!.end).toBe(20);
  });

  it("keeps very long footage under the cap", () => {
    expect(segmentsOf(3600, [], 6, 300).length).toBeLessThanOrEqual(300);
  });
});

describe("loudStretches", () => {
  it("finds loud stretches without speech", () => {
    const peaks = new Uint8Array(50 * 10).fill(20);
    peaks.fill(200, 50 * 2, 50 * 5); // loud 2-5s: someone talking
    peaks.fill(200, 50 * 6, 50 * 9); // loud 6-9s: a crowd
    const out = loudStretches(peaks, [{ start: 2, end: 5 }]);
    expect(out).toHaveLength(1);
    expect(out[0]![0]).toBeGreaterThanOrEqual(6);
    expect(out[0]![1]).toBeLessThanOrEqual(9.5);
  });
});

describe("frameStrip", () => {
  /** A solid-colour portrait frame, as a JPEG. */
  const frame = async (color: string) => {
    const { run } = await import("./exec.ts");
    const { stdoutBuffer } = await run(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=108x192`, "-frames:v", "1"].concat([
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-",
      ]),
      { binary: true },
    );
    return stdoutBuffer;
  };
  const size = (jpeg: Buffer) => {
    // The first SOF0/SOF2 marker carries height then width.
    for (let i = 2; i < jpeg.length; ) {
      const marker = jpeg[i + 1]!;
      if (marker === 0xc0 || marker === 0xc2)
        return { h: jpeg.readUInt16BE(i + 5), w: jpeg.readUInt16BE(i + 7) };
      i += 2 + jpeg.readUInt16BE(i + 2);
    }
    return null;
  };

  it("lays frames out in a row with a wider bar at the cut, or in rows", async () => {
    const frames = await Promise.all(["white", "white", "black", "black"].map(frame));
    const row = await frameStrip(frames, { width: 100, cutAfter: 1 });
    // Four tiles, two thin gaps and the bar.
    expect(size(row)).toEqual({ w: 4 * 100 + 4 + 10 + 4, h: 178 });
    const grid = await frameStrip([...frames, frames[0]!], { width: 100, columns: 2 });
    expect(size(grid)).toEqual({ w: 204, h: 3 * 178 + 2 * 8 });
  }, 30_000);
});

describe("frames near a clip's end", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-sheets-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // A second of picture under two of sound: the clip's listed length runs past its last frame.
  const clip = path.join(dir, "clip.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x284:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    clip,
  ]);
  const jpeg = (b: Buffer) => b.subarray(0, 2).toString("hex") === "ffd8";

  it("are the last frame when the time is past it", async () => {
    for (const t of [0.5, 1.02, 1.5, 1.99]) expect(jpeg(await grabFrame(clip, t, 80)), String(t)).toBe(true);
  });

  it("make a contact sheet to the clip's listed end", async () => {
    const sheets = await contactSheets(clip, [{ start: 0, end: 2 }], { portrait: true });
    expect(sheets).toHaveLength(1);
    expect(jpeg(sheets[0]!)).toBe(true);
  });

  it("fail with what went wrong, and leave nothing behind", async () => {
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith("vedit-sheets-")).length;
    const segments = segmentsOf(30, []);
    await expect(contactSheets(path.join(dir, "missing.mp4"), segments)).rejects.toThrow(/ffmpeg|missing/);
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith("vedit-sheets-")).length).toBe(before);
    expect(existsSync(clip)).toBe(true);
  });
});
