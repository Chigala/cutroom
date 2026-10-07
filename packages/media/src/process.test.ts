import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { probe } from "./probe.ts";
import { checkGraph, filterReport, graphFilters, makeProcessed, measureProcessed } from "./process.ts";
import { renderableAsIs, seeThrough } from "./transcode.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-process-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const out = path.join(dir, "processed");
const make = (name: string, args: string[]) => {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args, file]);
  return file;
};
/** Mean of one plane (gray, or alpha) of one frame of a file. */
const mean = (file: string, at: number, plane = "format=gray", decoder: string[] = []) => {
  const raw = execFileSync("ffmpeg", [
    "-v",
    "error",
    ...decoder,
    "-ss",
    String(at),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `${plane},scale=32:32`,
    "-f",
    "rawvideo",
    "-",
  ]);
  return raw.reduce((a, b) => a + b, 0) / raw.length;
};

describe("checking a filter graph", () => {
  it("reads filter names through labels, instances and quoted commas", () => {
    expect(
      graphFilters("[0:v]split=2[a][b];[a]reverse[r];[b][r]hstack,format@x=yuv420p[v]").map((f) => f.name),
    ).toEqual(["split", "reverse", "hstack", "format"]);
    expect(graphFilters("[0:v]geq=lum='if(gt(X,W/2),255,0)':cb=128:cr=128[v]").map((f) => f.name)).toEqual([
      "geq",
    ]);
  });

  it("allows what makes and measures pictures and sound", () => {
    for (const g of [
      "[0:v]reverse[v];[0:a]areverse[a]",
      "[0:v]chromakey=0x00FF00:0.15:0.05,despill=green[v]",
      "[0:a]showwaves=s=1080x400:mode=cline:colors=white[v]",
      "[0:a]asetrate=44100*1.5,aresample=44100,atempo=1/1.5[a]",
      "[0:v]fps=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG[v]",
      "sine=f=1000:d=0.5[a]",
    ])
      expect(checkGraph(g), g).toBeNull();
  });

  it("refuses files, the network, plugins and machine-only hardware", () => {
    expect(checkGraph("movie=/etc/passwd[v]")).toMatch(/movie filter isn't allowed/);
    expect(checkGraph("[0:v]drawtext=text=hi[v]")).toMatch(/drawtext/);
    expect(checkGraph("[0:v]lut3d=/tmp/x.cube[v]")).toMatch(/lut3d/);
    expect(checkGraph("[0:v]metadata=print:file=/tmp/out.txt[v]")).toMatch(/file option names a file/);
    expect(checkGraph("[0:a]afir,firequalizer=dumpfile=/tmp/x[a]")).toMatch(/dumpfile/);
    expect(checkGraph("[0:v]scale_opencl=640:360[v]")).toMatch(/hardware/);
    expect(checkGraph("[0:v]sendcmd=f=cmds.txt[v]")).toMatch(/sendcmd/);
    expect(checkGraph("[0:v]nosuchthing[v]", new Set(["reverse"]))).toMatch(/no nosuchthing filter/);
  });
});

describe("making clips", () => {
  // Two seconds that brighten from black to white, with a tone.
  const ramp = make("ramp.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x120:d=2:r=25,geq=lum='min(255,T*128)':cb=128:cr=128",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
  ]);
  const input = { path: ramp, kind: "video" as const };

  it("reverses a clip, picture and sound", async () => {
    const file = await makeProcessed({
      inputs: [input],
      graph: "[0:v]reverse[v];[0:a]areverse[a]",
      kind: "video",
      dir: out,
    });
    const p = await probe(file);
    expect(p).toMatchObject({ kind: "video", width: 160, height: 120, hasAudio: true });
    expect(p.duration).toBeCloseTo(2, 0);
    // It starts bright and ends dark.
    expect(mean(file, 0.05)).toBeGreaterThan(mean(file, 1.9) + 100);
    // The same recipe again: the same file, not made twice.
    expect(
      await makeProcessed({
        inputs: [input],
        graph: "[0:v]reverse[v];[0:a]areverse[a]",
        kind: "video",
        dir: out,
      }),
    ).toBe(file);
  });

  it("keys out a green screen into a see-through clip", async () => {
    const green = make("green.mp4", [
      "-f",
      "lavfi",
      "-i",
      "color=c=0x00FF00:s=160x120:d=1:r=25,drawbox=x=60:y=40:w=40:h=40:c=red:t=fill",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
    ]);
    const file = await makeProcessed({
      inputs: [{ path: green, kind: "video" }],
      graph: "[0:v]chromakey=0x00FF00:0.2:0.05,format=yuva420p[v]",
      kind: "video",
      alpha: true,
      dir: out,
    });
    expect(file).toMatch(/\.webm$/);
    // The green is gone (alpha near 0); the red box stays solid.
    const alpha = mean(file, 0.5, "alphaextract", ["-c:v", "libvpx-vp9"]);
    expect(alpha).toBeLessThan(40);
    expect(alpha).toBeGreaterThan(5);
    // It plays and exports as it is: a preview copy or a master would lose the transparency.
    expect(await seeThrough(file)).toBe(true);
    expect(await renderableAsIs(file)).toBe(true);
    expect(await seeThrough(green)).toBe(false);
  });

  it("draws a sound's waveform as video, the sound kept", async () => {
    const file = await makeProcessed({
      inputs: [{ path: ramp, kind: "video", in: 0.5, out: 1.5 }],
      graph: "[0:a]asplit[w][a];[w]showwaves=s=320x120:mode=cline:rate=25:colors=white[v]",
      kind: "video",
      dir: out,
    });
    const p = await probe(file);
    expect(p).toMatchObject({ width: 320, height: 120, hasAudio: true });
    expect(p.duration).toBeCloseTo(1, 0);
  });

  it("changes a voice into a sound of its own", async () => {
    const file = await makeProcessed({
      inputs: [input],
      graph: "[0:a]asetrate=44100*1.5,aresample=44100,atempo=1/1.5[a]",
      kind: "audio",
      dir: out,
    });
    expect(file).toMatch(/\.m4a$/);
    const p = await probe(file);
    expect(p.kind).toBe("audio");
    expect(p.duration).toBeCloseTo(2, 0);
  });

  it("makes a photo from a frame", async () => {
    const file = await makeProcessed({
      inputs: [{ ...input, in: 1 }],
      graph: "[0:v]scale=80:60[v]",
      kind: "image",
      dir: out,
    });
    expect(await probe(file)).toMatchObject({ kind: "image", width: 80, height: 60 });
  });

  it("says plainly when ffmpeg can't, and leaves nothing half made", async () => {
    await expect(
      makeProcessed({ inputs: [input], graph: "[0:v]scale=w=oops[v]", kind: "video", dir: out }),
    ).rejects.toThrow(/oops|Invalid|Error/i);
    await expect(
      makeProcessed({ inputs: [input], graph: "[0:v]movie=x[v]", kind: "video", dir: out }),
    ).rejects.toThrow(/movie filter isn't allowed/);
  });
});

describe("measuring", () => {
  it("hands back what the filters report", async () => {
    const clip = make("dark-start.mp4", [
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x120:d=1:r=25",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=160x120:d=1:r=25",
      "-filter_complex",
      "[0][1]concat=n=2:v=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
    ]);
    const report = await measureProcessed({
      inputs: [{ path: clip, kind: "video" }],
      graph: "[0:v]blackdetect=d=0.5,fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    });
    expect(report).toMatch(/black_start:0 black_end:1/);
    expect(report).toMatch(/lavfi\.signalstats\.YAVG=/);
    expect(report).not.toMatch(/Stream #|@ 0x/);
  });

  it("reads Windows' logs, whose addresses have no 0x", () => {
    const log = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
      "  Duration: 00:00:02.00, start: 0.000000, bitrate: 25 kb/s",
      "[Parsed_metadata_3 @ 000001F2A3B4C5D0] lavfi.signalstats.YAVG=16",
      "[blackdetect @ 000001f2a3b4c600] black_start:0 black_end:1 black_duration:1",
    ].join("\r\n");
    expect(filterReport(log, ["blackdetect", "metadata"])).toBe(
      "[Parsed_metadata_3] lavfi.signalstats.YAVG=16\n[blackdetect] black_start:0 black_end:1 black_duration:1",
    );
  });

  it("keeps a long report readable", () => {
    const log = [
      "Input #0, mov",
      ...Array.from({ length: 1000 }, (_, i) => `[Parsed_metadata_1 @ 0x12ab] frame:${i}`),
    ].join("\n");
    const report = filterReport(log);
    expect(report.split("\n").length).toBeLessThanOrEqual(301);
    expect(report).toMatch(/lines left out/);
    expect(report).not.toMatch(/Input #0/);
  });
});
