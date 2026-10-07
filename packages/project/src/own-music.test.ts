import { describe, expect, it } from "vitest";
import {
  applyOps,
  emptyProject,
  type ProjectDoc,
  parseDerivedKey,
  replaceTimelineOps,
  splitSceneOps,
  splitsSound,
  stemKey,
} from "./index.ts";

/** A reposted clip (music under her voice) cut into two shots that take the music out, and a stock clip. */
function reposted(): ProjectDoc {
  const base = emptyProject("own music");
  const clip = (id: string) => ({
    id,
    kind: "video" as const,
    label: id,
    path: `/${id}.mp4`,
    duration: 30,
    hasAudio: true,
  });
  return applyOps(base, [
    { op: "insert", coll: "sources", item: clip("talk") as never },
    { op: "insert", coll: "sources", item: clip("stock") as never },
    { op: "insert", coll: "scenes", item: { id: "s1", source: "talk", in: 0, out: 4, ownMusic: 0 } as never },
    { op: "insert", coll: "scenes", item: { id: "s2", source: "talk", in: 6, out: 9, ownMusic: 0 } as never },
    { op: "insert", coll: "scenes", item: { id: "s3", source: "stock", in: 0, out: 2 } as never },
  ]).doc;
}

describe("a clip's own music", () => {
  it("comes out of a shot set below 1, and stays in one left as recorded", () => {
    expect(splitsSound({ ownMusic: 0 })).toBe(true);
    expect(splitsSound({ ownMusic: 0.2 })).toBe(true);
    expect(splitsSound({ ownMusic: 1 })).toBe(false);
    expect(splitsSound({})).toBe(false);
  });

  it("has media keys for its two parts", () => {
    expect(stemKey("clip_1", "voice")).toBe("clip_1~stem~voice");
    expect(parseDerivedKey(stemKey("clip_1", "music"))).toEqual({
      kind: "stem",
      source: "clip_1",
      part: "music",
    });
    expect(parseDerivedKey("clip_1~stem~drums")).toBeNull();
  });

  it("stays out when the cut is rebuilt or a shot is split", () => {
    const doc = reposted();
    const rebuilt = applyOps(
      doc,
      replaceTimelineOps(doc, [
        { source: "talk", in: 10, out: 14, note: "" },
        { source: "stock", in: 0, out: 3, note: "" },
      ]),
    ).doc;
    expect(rebuilt.scenes.map((s) => [s.source, s.ownMusic])).toEqual([
      ["talk", 0],
      ["stock", undefined],
    ]);
    const split = applyOps(doc, splitSceneOps(doc, "s1", 2)).doc;
    expect(split.scenes.filter((s) => s.source === "talk").every((s) => s.ownMusic === 0)).toBe(true);
  });

  it("isn't guessed for a rebuilt cut when the clip's shots disagreed", () => {
    const doc = applyOps(reposted(), [
      { op: "update", coll: "scenes", id: "s2", patch: { ownMusic: 0.5 } },
    ]).doc;
    const rebuilt = applyOps(doc, replaceTimelineOps(doc, [{ source: "talk", in: 0, out: 5, note: "" }])).doc;
    expect(rebuilt.scenes[0]!.ownMusic).toBeUndefined();
  });
});
