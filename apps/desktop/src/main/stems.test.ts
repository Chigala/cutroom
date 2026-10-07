import { applyOps, emptyProject, type ProjectDoc } from "@vedit/project";
import { beforeEach, describe, expect, it, vi } from "vitest";

const made: { id: string; current: boolean | undefined }[] = [];
let available = true;
vi.mock("@vedit/media", () => ({
  STEMS_MODEL: "model-2",
  canSeparate: () => available,
  makeStems: vi.fn(async (_dir: string, src: { id: string }, o: { current?: boolean }) => {
    made.push({ id: src.id, current: o.current });
    return { voice: `/stems/${src.id}.voice.wav`, music: `/stems/${src.id}.music.wav` };
  }),
}));

const { makeNeededStems } = await import("./stems.ts");

/** Clips: one whose shots take its music out, one left as recorded, one split by an older model. */
function project(): ProjectDoc {
  const clip = (id: string) => ({
    id,
    kind: "video",
    label: id,
    path: `/${id}.mp4`,
    duration: 10,
    hasAudio: true,
  });
  return applyOps(emptyProject("t"), [
    ...["talk", "stock", "old"].map((id) => ({
      op: "insert" as const,
      coll: "sources" as const,
      item: clip(id) as never,
    })),
    { op: "insert", coll: "scenes", item: { id: "s1", source: "talk", in: 0, out: 3, ownMusic: 0 } as never },
    { op: "insert", coll: "scenes", item: { id: "s2", source: "talk", in: 4, out: 6, ownMusic: 0 } as never },
    { op: "insert", coll: "scenes", item: { id: "s3", source: "stock", in: 0, out: 2 } as never },
    {
      op: "insert",
      coll: "scenes",
      item: { id: "s4", source: "old", in: 0, out: 2, ownMusic: 0.3 } as never,
    },
    { op: "insert", coll: "analyses", item: { id: "talk", silences: [] } as never },
    { op: "insert", coll: "analyses", item: { id: "old", silences: [], stems: "model-1" } as never },
  ]).doc;
}

describe("taking a clip's music out in the background", () => {
  beforeEach(() => {
    made.length = 0;
    available = true;
  });

  it("splits each clip once, for the shots that want it, and records the model", async () => {
    const doc = project();
    const ops = await makeNeededStems("/project", doc);
    expect(made).toEqual([
      { id: "talk", current: false },
      { id: "old", current: false },
    ]);
    const after = applyOps(doc, ops).doc;
    expect(after.analyses.find((a) => a.id === "talk")?.stems).toBe("model-2");
    expect(after.analyses.find((a) => a.id === "old")?.stems).toBe("model-2");
    // Done: next time it only checks the files are there, and records nothing.
    made.length = 0;
    expect(await makeNeededStems("/project", after)).toEqual([]);
    expect(made.every((m) => m.current)).toBe(true);
  });

  it("says plainly when this computer can't", async () => {
    available = false;
    await expect(makeNeededStems("/project", project())).rejects.toThrow(/isn't available on this computer/);
  });
});
