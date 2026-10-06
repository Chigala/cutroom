import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { playableCopy } from "./playable.ts";
import { probe } from "./probe.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-playable-"));
const out = path.join(dir, "converted");
const make = (name: string, input: string[], codec: string[]) => {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...input, ...codec, file]);
  return file;
};
const picture = ["-f", "lavfi", "-i", "testsrc=s=320x240:d=1", "-frames:v", "1"];
const tone = ["-f", "lavfi", "-i", "sine=f=440:d=1"];

describe("photos and sounds the app can't use as they are", () => {
  it("leaves what the browser shows and plays alone", async () => {
    const jpg = make("a.jpg", picture, []);
    const mp3 = make("a.mp3", tone, ["-c:a", "libmp3lame"]);
    const wav = make("a.wav", tone, ["-c:a", "pcm_s16le"]);
    for (const f of [jpg, mp3, wav]) expect(await playableCopy(f, out)).toBe(f);
  });

  it("converts a TIFF photo to a JPEG, the whole picture, once", async () => {
    const tif = make("scan.tif", picture, []);
    const copy = await playableCopy(tif, out);
    expect(copy).toMatch(/converted[\\/]scan-[0-9a-f]{8}\.jpg$/);
    expect(await probe(copy)).toMatchObject({ kind: "image", width: 320, height: 240 });
    expect(await playableCopy(tif, out)).toBe(copy);
  });

  it("converts AIFF and Apple Lossless to AAC", async () => {
    const aiff = make("take.aiff", tone, []);
    const alac = make("song.m4a", tone, ["-c:a", "alac"]);
    for (const f of [aiff, alac]) {
      const copy = await playableCopy(f, out);
      expect(copy).toMatch(/\.m4a$/);
      expect(copy).not.toBe(f);
      expect(await probe(copy)).toMatchObject({ kind: "audio", hasAudio: true });
    }
  });

  it("says plainly when a file can't be converted", async () => {
    const broken = path.join(dir, "broken.heic");
    writeFileSync(broken, "not a photo");
    await expect(playableCopy(broken, out)).rejects.toThrow(
      "Couldn't convert broken.heic to a photo the app can use",
    );
  });
});
