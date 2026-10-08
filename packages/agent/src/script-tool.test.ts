import { applyOps, emptyProject, type ProjectDoc, timelineOf } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { runTool, type Scratch, type ToolContext } from "./tools.ts";

/** Four b-roll shots of 1.3s and a 120 BPM track (a beat every half second) as the music. */
function project(): ProjectDoc {
  const doc = emptyProject("montage");
  return applyOps(doc, [
    {
      op: "insert",
      coll: "sources",
      item: { id: "song", kind: "audio", label: "song", path: "/song.mp3", duration: 60 } as never,
    },
    {
      op: "insert",
      coll: "analyses",
      item: { id: "song", bpm: 120, beats: Array.from({ length: 120 }, (_, i) => i * 0.5) } as never,
    },
    { op: "merge", key: "music", patch: { source: "song" } },
    ...[1, 2, 3, 4].map((n) => ({
      op: "insert" as const,
      coll: "sources" as const,
      item: { id: `b${n}`, kind: "video", label: `b${n}`, path: `/b${n}.mp4`, duration: 10 } as never,
    })),
    ...[1, 2, 3, 4].map((n) => ({
      op: "insert" as const,
      coll: "scenes" as const,
      item: { id: `s${n}`, source: `b${n}`, in: 0, out: 1.3 } as never,
    })),
  ]).doc;
}

function ctx(doc: ProjectDoc) {
  const scratch: Scratch = { doc, ops: [], groups: [] };
  const c: ToolContext = {
    scratch,
    host: { frame: async () => Buffer.from([0xff, 0xd8, 0xff]) },
    step: () => {},
  };
  return { c, scratch };
}

describe("run_script", () => {
  it("answers from the project, the timeline and the beats", async () => {
    const { c } = ctx(project());
    const out = await runTool(
      "run_script",
      {
        code: "return { shots: timeline.scenes.length, length: timeline.duration, bpm, firstBeats: beats.slice(0, 3) };",
      },
      c,
    );
    expect(out.isError).toBeFalsy();
    expect(JSON.parse(out.text)).toEqual({ shots: 4, length: 5.2, bpm: 120, firstBeats: [0, 0.5, 1] });
  });

  it("applies the ops it returns as one change, so the montage cuts land on the beat", async () => {
    const { c, scratch } = ctx(project());
    const out = await runTool(
      "run_script",
      {
        label: "Cut the montage on the beat",
        code: `// Two beats a shot.
const len = 2 * 60 / bpm;
return { ops: timeline.scenes.map((s) => ({ op: "update", coll: "scenes", id: s.id, patch: { out: s.in + len * s.speed } })) };`,
      },
      c,
    );
    expect(out.isError).toBeFalsy();
    expect(out.text).toMatch(/^Applied/);
    expect(scratch.groups.map((g) => g.label)).toEqual(["Cut the montage on the beat"]);
    expect(timelineOf(scratch.doc).scenes.map((s) => s.start)).toEqual([0, 1, 2, 3]);
  });

  it("applies nothing it can't check, and says why a script failed", async () => {
    const { c, scratch } = ctx(project());
    const before = scratch.doc;
    const unlabelled = await runTool(
      "run_script",
      { code: 'return { ops: [{ op: "remove", coll: "scenes", id: "s1" }] };' },
      c,
    );
    expect(unlabelled.isError).toBe(true);
    expect(unlabelled.text).toMatch(/label/);
    const derived = await runTool(
      "run_script",
      { label: "x", code: 'return { ops: [{ op: "remove", coll: "transcripts", id: "song" }] };' },
      c,
    );
    expect(derived.isError).toBe(true);
    const broken = await runTool(
      "run_script",
      { code: 'console.log("so far");\nreturn timeline.nope.x;' },
      c,
    );
    expect(broken.isError).toBe(true);
    expect(broken.text).toMatch(/TypeError.*line 2/);
    expect(broken.text).toMatch(/so far/);
    expect(scratch.doc).toBe(before);
    expect(scratch.groups).toEqual([]);
  });
});
