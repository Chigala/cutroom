import { applyOps, demoProject, type Op, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { runChecks } from "./index.ts";

const byId = (doc: ProjectDoc) => Object.fromEntries(runChecks(doc).map((r) => [r.id, r]));

describe("checks", () => {
  it("pass on the demo project apart from the beat grid", () => {
    const results = byId(demoProject());
    expect(results.hook!.status).toBe("pass");
    expect(results["safe-zones"]!.status).toBe("pass");
    expect(results["shot-length"]!.status).toBe("pass");
  });

  it("follow the project's check rules", () => {
    const doc = demoProject();
    const high = { ...doc, titles: doc.titles.map((t) => ({ ...t, position: { x: 0.1, y: 0.9 } })) };
    const status = (d: typeof doc) => Object.fromEntries(runChecks(d).map((r) => [r.id, r.status]));
    expect(status(high)["safe-zones"]).not.toBe("pass");
    // On YouTube there are no app buttons to keep clear of.
    expect(status({ ...high, checkRules: { ...high.checkRules, platform: "youtube" } })["safe-zones"]).toBe(
      "pass",
    );
    // Turned off, a check doesn't run at all.
    expect(
      status({ ...high, checkRules: { ...high.checkRules, off: ["safe-zones"] } })["safe-zones"],
    ).toBeUndefined();
  });

  it("every fix makes its own check pass", () => {
    let doc = demoProject();
    doc = applyOps(doc, [
      { op: "update", coll: "titles", id: "hook", patch: { anchor: { scene: "sc5", at: 0 } } },
      { op: "merge", key: "captionStyle", patch: { y: 0.92 } },
      { op: "merge", key: "music", patch: { duckUnderSpeech: false } },
      { op: "update", coll: "scenes", id: "sc3", patch: { out: 7 } },
      { op: "remove", coll: "scenes", id: "sc12" },
    ]).doc;
    for (const result of runChecks(doc)) {
      if (!result.fix) continue;
      const fixed = applyOps(doc, result.fix.ops).doc;
      expect(byId(fixed)[result.id]!.status, result.id).toBe("pass");
    }
  });

  it("snaps montage cuts to the music's beats", () => {
    let doc = demoProject();
    const beats = Array.from({ length: 80 }, (_, i) => Number((0.13 + i * 0.5357).toFixed(3)));
    doc = applyOps(doc, [
      {
        op: "insert",
        coll: "sources",
        item: { id: "song", kind: "audio", label: "song", path: "/song.mp3", duration: 60, hasAudio: true },
      },
      { op: "insert", coll: "analyses", item: { id: "song", beats, bpm: 112 } },
      { op: "merge", key: "music", patch: { source: "song" } },
    ]).doc;
    const beat = byId(doc).beat!;
    expect(beat.status).toBe("warn");
    expect(byId(applyOps(doc, beat.fix!.ops).doc).beat!.status).toBe("pass");
  });
});

describe("checks that use what the footage shows", () => {
  /** The demo with its first clip a real 9:16 clip, and what its picture was read to hold. */
  const withSeen = (seen: Record<string, unknown>) => {
    let doc = demoProject();
    const has = doc.analyses.some((a) => a.id === "clip_1");
    doc = applyOps(doc, [
      { op: "update", coll: "sources", id: "clip_1", patch: { width: 1080, height: 1920 } },
      (has
        ? { op: "update", coll: "analyses", id: "clip_1", patch: seen }
        : { op: "insert", coll: "analyses", item: { id: "clip_1", ...seen } }) as Op,
    ]).doc;
    return doc;
  };

  it("keep captions and titles off words already in the picture, and move the captions clear", () => {
    // A sign low in the frame while the first caption shows (cap1, from 0.6s).
    const doc = withSeen({
      text: [{ start: 0.5, end: 2.7, text: "OPEN DAILY", x: 0.2, y: 0.71, w: 0.5, h: 0.05 }],
    });
    const result = byId(doc)["words-clear"]!;
    expect(result.status).toBe("warn");
    expect(result.detail).toContain('"OPEN DAILY"');
    expect(result.scenes).toEqual(["sc1"]);
    expect(byId(applyOps(doc, result.fix!.ops).doc)["words-clear"]!.status).toBe("pass");
    // Under the hook title instead: flagged, with no caption move to offer.
    const top = withSeen({
      text: [{ start: 0.5, end: 2.7, text: "MENU", x: 0.1, y: 0.12, w: 0.3, h: 0.05 }],
    });
    expect(byId(top)["words-clear"]).toMatchObject({
      status: "warn",
      detail: expect.stringContaining("A title"),
    });
    expect(byId(top)["words-clear"]!.fix).toBeUndefined();
    // Cropped out of the frame, or only before the shot uses the clip: nothing to cover.
    expect(
      byId(withSeen({ text: [{ start: 3, end: 4, text: "LATER", x: 0.2, y: 0.71, w: 0.5, h: 0.05 }] }))[
        "words-clear"
      ]!.status,
    ).toBe("pass");
  });

  it("flag a cut that lands on a weak face moment", () => {
    // sc1 uses clip_1 from 0.5s to 2.7s; around 3s the face is weak (a blink, a turn).
    const quality = [0, 1, 2, 3, 4].map((t) => ({ t, face: t === 3 ? 0.1 : 0.6 }));
    const result = byId(withSeen({ quality }))["clear-face"]!;
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("sc1 ends");
    expect(byId(withSeen({ quality: quality.map((q) => ({ ...q, face: 0.6 })) }))["clear-face"]!.status).toBe(
      "pass",
    );
  });
});
