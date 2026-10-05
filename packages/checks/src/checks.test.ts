import { applyOps, demoProject, type ProjectDoc } from "@vedit/project";
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
