import { runChecks } from "@vedit/checks";
import { applyOps, emptyProject, type Op, type ProjectDoc, timelineOf } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { type Scratch, snapCutsToBeat, type ToolContext } from "./tools.ts";

/**
 * Four 1.3s b-roll shots and a talking shot, over a 120 BPM track (a beat every half second) used from
 * 0.1s in: the music's beats land at 0.4, 0.9, 1.4... of the video.
 */
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
    { op: "merge", key: "music", patch: { source: "song", section: { start: 0.1, end: 30 } } },
    {
      op: "insert",
      coll: "sources",
      item: { id: "talk", kind: "video", label: "talk", path: "/talk.mp4", duration: 20 } as never,
    },
    { op: "insert", coll: "analyses", item: { id: "talk", speech: [[0, 20]] } as never },
    ...[1, 2, 3, 4].map((n) => ({
      op: "insert" as const,
      coll: "sources" as const,
      item: { id: `b${n}`, kind: "video", label: `b${n}`, path: `/b${n}.mp4`, duration: 10 } as never,
    })),
    ...[1, 2].map((n) => ({
      op: "insert" as const,
      coll: "scenes" as const,
      item: { id: `s${n}`, source: `b${n}`, in: 0, out: 1.3 } as never,
    })),
    { op: "insert", coll: "scenes", item: { id: "t", source: "talk", in: 2, out: 4.15 } as never },
    ...[3, 4].map((n) => ({
      op: "insert" as const,
      coll: "scenes" as const,
      item: { id: `s${n}`, source: `b${n}`, in: 0, out: 1.3 } as never,
    })),
  ]).doc;
}

function ctx(doc: ProjectDoc, ops: Op[] = []) {
  const scratch: Scratch = { doc, ops, groups: [] };
  const c: ToolContext = {
    scratch,
    host: { frame: async () => Buffer.from([0xff, 0xd8, 0xff]) },
    step: () => {},
  };
  return { c, scratch };
}

const starts = (doc: ProjectDoc) => timelineOf(doc).scenes.map((s) => Math.round(s.start * 100) / 100);

describe("cuts on the beat", () => {
  it("move onto the music's beats (its section, not its start) after a request that changed the cut", () => {
    const { c, scratch } = ctx(project(), [{ op: "update", coll: "scenes", id: "s1", patch: { out: 1.3 } }]);
    snapCutsToBeat(c);
    expect(scratch.groups.map((g) => g.label)).toEqual(["Cuts on the beat"]);
    // b-roll to 1.4 and 2.9 (beats); the talking shot keeps its 2.15s (to 5.05); the b-roll after it
    // ends on beats again (6.4, 7.9).
    expect(starts(scratch.doc)).toEqual([0, 1.4, 2.9, 5.05, 6.4]);
    expect(timelineOf(scratch.doc).duration).toBeCloseTo(7.9, 5);
    // The check agrees: every cut between shots nobody talks in is on the beat.
    expect(runChecks(scratch.doc).find((r) => r.id === "beat")?.status).toBe("pass");
  });

  it("leave the cuts alone after a request that didn't touch them, or with lockCuts off", () => {
    const untouched = ctx(project(), [{ op: "merge", key: "captionStyle", patch: { y: 0.8 } }]);
    snapCutsToBeat(untouched.c);
    expect(untouched.scratch.groups).toEqual([]);
    const off = applyOps(project(), [{ op: "merge", key: "music", patch: { lockCuts: false } }]).doc;
    const locked = ctx(off, [{ op: "update", coll: "scenes", id: "s1", patch: { out: 1.3 } }]);
    snapCutsToBeat(locked.c);
    expect(locked.scratch.groups).toEqual([]);
  });

  it("keep a speed-ramped shot's length, and the cuts after it still land on the beat", () => {
    const ramped = applyOps(project(), [
      {
        op: "update",
        coll: "scenes",
        id: "s2",
        patch: {
          ramp: [
            { at: 0, speed: 1 },
            { at: 1.3, speed: 0.5 },
          ],
        },
      },
    ]).doc;
    const { c, scratch } = ctx(ramped, [{ op: "update", coll: "scenes", id: "s1", patch: { out: 1.3 } }]);
    const before = timelineOf(ramped).scenes[1]!.duration;
    snapCutsToBeat(c);
    const tl = timelineOf(scratch.doc);
    expect(tl.scenes[1]!.duration).toBeCloseTo(before, 5);
    // The last cut, after the ramp and the talking shot, is on a beat (0.4 + k * 0.5).
    const last = tl.scenes[4]!.start;
    expect(Math.abs(((last - 0.4) / 0.5) % 1)).toBeLessThan(0.01);
  });
});
