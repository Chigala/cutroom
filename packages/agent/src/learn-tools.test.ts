import { execFileSync } from "node:child_process";
import {
  emptyProject,
  inspirationOps,
  type ProjectDoc,
  type SeenText,
  STARTER_INSPIRATIONS,
} from "@vedit/project";
import { describe, expect, it } from "vitest";
import { GUIDE_TOPICS } from "./guides.ts";
import { type AgentHost, runTool, type Scratch, type ToolContext } from "./tools.ts";

/** A small solid JPEG, as a frame or a still. */
const jpeg = (w: number, h: number, color: string) =>
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${w}x${h}`,
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-c:v",
    "mjpeg",
    "-",
  ]);

/** Twelve words said over 5 s of a portrait reference, captioned two at a time in capitals. */
const said = "so here is the thing nobody tells you about selling homes online".split(" ");
const words = said.map((text, i) => ({ text, start: 1 + i * 0.4, end: 1.35 + i * 0.4 }));
const captions: SeenText[] = [];
for (let i = 0; i < said.length; i += 2)
  captions.push({
    start: words[i]!.start - 0.1,
    end: words[i]!.start + 0.7,
    text: `${said[i]} ${said[i + 1]}`.toUpperCase(),
    x: 0.3,
    y: 0.62,
    w: 0.4,
    h: 0.04,
  });

function reference(scenes = false): ProjectDoc {
  const doc: ProjectDoc = {
    ...emptyProject("learn"),
    sources: [
      {
        id: "ref",
        kind: "video",
        label: "ref",
        path: "/ref.mp4",
        duration: 30,
        width: 720,
        height: 1280,
        hdr: false,
        hasAudio: true,
        status: "ready",
        proxy: true,
        speech: true,
        summary: "",
        tags: [],
      },
    ],
    transcripts: [{ id: "ref", language: "en", words }],
    analyses: [{ id: "ref", silences: [], shots: [2, 4, 6, 8], text: [] }],
  };
  return scenes
    ? { ...doc, scenes: [{ id: "s1", source: "ref", in: 0, out: 10, note: "", volume: 1 }] }
    : doc;
}

// Made once: a frame and a still for every call.
const FRAME = jpeg(72, 128, "navy");
const STILL = jpeg(108, 192, "teal");

function ctx(doc: ProjectDoc, host: Partial<AgentHost> = {}) {
  const frames: { source: string; t: number; width?: number }[] = [];
  const rendered: ProjectDoc[] = [];
  const reads: number[] = [];
  // The craft guides read, as a request does before these jobs.
  const scratch: Scratch = { doc, ops: [], groups: [], guides: new Set(GUIDE_TOPICS) };
  const c: ToolContext = {
    scratch,
    host: {
      frame: async (source, t, width) => {
        frames.push({ source, t, ...(width && { width }) });
        return FRAME;
      },
      stills: async (d, times) => {
        rendered.push(d);
        return { images: times.map(() => STILL), errors: [] };
      },
      readText: async (_id, rate) => {
        reads.push(rate);
        return captions;
      },
      study: async () => ({
        motion: {
          shots: [
            { from: 0, to: 30, punches: [{ at: 2, size: 0.1 }], drift: 0, pan: { x: 0, y: 0 }, shake: 0.001 },
          ],
          transitions: [
            { at: 2, kind: "cut" },
            { at: 4, kind: "flash" },
          ],
          jumps: [{ at: 2, size: 0.1 }],
        },
        rhythm: {
          bpm: 120,
          pulse: 5,
          beats: [2, 4, 6, 8],
          hits: [],
          voiceless: true,
          loudness: [],
          effects: [{ at: 2.1, kind: "whoosh", confidence: 0.6 }],
        },
      }),
      ...host,
    },
    step: () => {},
  };
  return { c, scratch, frames, rendered, reads };
}

describe("studying a reference", () => {
  it("measure reads its captions densely, once a request", async () => {
    const { c, reads } = ctx(reference());
    const out = await runTool("inspiration", { action: "measure", source: "ref" }, c);
    expect(reads).toEqual([4]);
    expect(out.text).toMatch(/Captions \(read off the screen 4 times a second: times ±0\.25s\):\n6 pages/);
    expect(out.text).toMatch(/2 words a page .* ALL CAPS; centred 64% down the frame/);
    // Up 0.1s ahead, seen at the next of 4 reads a second: 0.1 + half a read (0.125) ahead, on average.
    expect(out.text).toMatch(/a page comes up 0\.23s ahead of its first word/);
    expect(out.text).toMatch(
      /Motion: 1 punch-ins .* typically 10%; 1 in, 0 out.* Transitions: 1 hard cut, 1 flash\./,
    );
    expect(out.text).toMatch(
      /1 jump zoom \(cuts within a take, reframed: 50% of cuts, typically 10%; 1 tighter/,
    );
    expect(out.text).toMatch(
      /Effects \(heard in the sound without the voice\): 1 whoosh \(1 on cuts, 1 on zooms, 1 as text comes up\)/,
    );
    expect(out.text).toMatch(
      /Rhythm: 120 bpm, a clear beat \(pulse 5\)\. Cuts \(4\): 100% on the beat \(by chance 7%\)/,
    );
    expect(out.text).toMatch(
      /Watch it play \(watch with source ref\).*: 0-4s \(the hook\); 27-30s \(the ending\)/,
    );
    await runTool("inspiration", { action: "measure", source: "ref" }, c);
    expect(reads).toEqual([4]);
  });

  it("watch shows a stretch as it plays: consecutive frames in sheets, with their times", async () => {
    const { c, frames } = ctx(reference());
    const out = await runTool("watch", { source: "ref", from: 2, to: 4 }, c);
    expect(out.isError).toBeFalsy();
    // Two seconds fit 48 frames at 12 a second (the most): 24 frames, in two sheets.
    expect(frames).toHaveLength(24);
    expect(frames.slice(0, 3).map((f) => f.t)).toEqual([2, 2.08, 2.17]);
    expect(frames.every((f) => f.width === 216)).toBe(true);
    expect(out.images).toHaveLength(2);
    expect(out.text).toMatch(/^24 frames of ref, 12 a second/);
    expect(out.text).toContain("Sheet 1: 2.00, 2.08, 2.17");
  });

  it("watch says where to carry on when a stretch is longer than one call takes", async () => {
    const { c, frames } = ctx(reference());
    const out = await runTool("watch", { source: "ref", from: 0, to: 30, fps: 2 }, c);
    expect(frames).toHaveLength(48);
    expect(out.text).toContain("Stopped at 48 frames: watch from 24.00s for the rest.");
  });

  it("compare renders this edit following an inspiration under the reference, without changing it", async () => {
    const doc = reference(true);
    const { c, scratch, frames, rendered } = ctx(doc);
    const pack = STARTER_INSPIRATIONS.find((p) => p.id === "punchy-explainer")!;
    const out = await runTool("compare", { source: "ref", times: [1.5, 3], inspiration: pack.id }, c);
    expect(out.isError).toBeFalsy();
    expect(out.images).toHaveLength(1);
    expect(frames.map((f) => f.t)).toEqual([1.5, 3]);
    // What was rendered followed the inspiration (its caption settings); the edit itself didn't change.
    const settings = inspirationOps(doc, pack).find((o) => o.op === "merge" && o.key === "captionStyle");
    expect(rendered[0]!.captionStyle).toMatchObject((settings as { patch: object }).patch);
    expect(scratch.doc).toBe(doc);
    expect(scratch.ops).toEqual([]);
    // Picked where someone's talking.
    expect(out.text).toMatch(/Bottom: this edit following Punchy explainer at \d/);
  });

  it("compare stands the reference in when nothing's cut yet", async () => {
    const { c, rendered } = ctx(reference());
    const out = await runTool("compare", { source: "ref", times: [2] }, c);
    expect(rendered[0]!.scenes.map((s) => s.source)).toEqual(["ref"]);
    expect(out.text).toContain("the reference stands in");
  });
});
