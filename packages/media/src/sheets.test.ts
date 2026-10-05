import { describe, expect, it } from "vitest";
import { frameStrip, loudStretches, segmentsOf } from "./sheets.ts";

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
