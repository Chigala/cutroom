import { applyOps, demoProject, emptyProject, type Op, type ProjectDoc } from "@vedit/project";
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

  it("ask for no hook title, only that one there shows early", () => {
    const doc = demoProject();
    // The opening line is the hook: no title is fine.
    const none = applyOps(doc, [{ op: "remove", coll: "titles", id: "hook" }]).doc;
    expect(byId(none).hook!.status).toBe("pass");
    // A title that comes in late still gets moved to the start.
    const late = applyOps(doc, [
      { op: "update", coll: "titles", id: "hook", patch: { anchor: { scene: "sc5", at: 0 } } },
    ]).doc;
    expect(byId(late).hook!.status).toBe("warn");
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

  it("clear a voiceover whose recording or shot is gone", () => {
    const doc = demoProject();
    const shot = doc.scenes[0]!.id;
    const voice = (id: string, source: string, scene = shot) => ({
      id,
      anchor: { scene, at: 0 },
      duration: 1,
      source,
      offset: 0,
      volume: 1,
      duck: 0.2,
    });
    const broken = { ...doc, voiceovers: [voice("v1", "deleted"), voice("v2", doc.sources[0]!.id, "gone")] };
    const orphans = byId(broken).orphans!;
    expect(orphans.status).not.toBe("pass");
    const fixed = applyOps(broken, (orphans.fix?.ops ?? []) as Op[]).doc;
    expect(fixed.voiceovers).toEqual([]);
    expect(byId(fixed).orphans!.status).toBe("pass");
  });
});

describe("checks on a video where people talk only some of the time", () => {
  /**
   * A vlog clip: someone talks at 0-10s and 40-50s; between, the street (audible, nobody talking) unless
   * `quiet` makes that stretch silence. Low face, so headroom would want to reframe a talking shot.
   */
  const vlog = (
    scenes: { id: string; in: number; out: number }[],
    { quiet = false, mapped = true }: { quiet?: boolean; mapped?: boolean } = {},
  ): ProjectDoc => {
    const words = [
      ...Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, start: 1 + i * 0.6, end: 1.4 + i * 0.6 })),
      ...Array.from({ length: 12 }, (_, i) => ({ text: `v${i}`, start: 41 + i * 0.6, end: 41.4 + i * 0.6 })),
    ];
    const doc = emptyProject("Vlog");
    return {
      ...doc,
      sources: [
        {
          id: "vlog",
          kind: "video",
          label: "vlog",
          path: "/vlog.mp4",
          duration: 60,
          width: 1080,
          height: 1920,
          hdr: false,
          hasAudio: true,
          status: "ready",
          proxy: false,
          speech: true,
          summary: "",
          tags: [],
        },
      ],
      transcripts: [{ id: "vlog", language: "en", words }],
      analyses: [
        {
          id: "vlog",
          silences: quiet ? [[10.5, 40.5]] : [],
          shots: [],
          // A small face: in the scenery that's a passer-by; while talking, the speaker filmed wide.
          face: { x: 0.5, y: 0.7, size: 0.1 },
          ...(mapped && {
            speech: [
              [0, 10.5],
              [40, 50.5],
            ] as [number, number][],
          }),
        },
      ],
      scenes: scenes.map((s) => ({ ...s, source: "vlog", note: "", volume: 1 })),
      captionStyle: { ...doc.captionStyle, speech: false },
    } as ProjectDoc;
  };

  it("judges the scenery as picture: long holds and jump cuts there are flagged", () => {
    const doc = vlog([
      { id: "talk", in: 0, out: 10 },
      { id: "walk", in: 15, out: 27 },
      { id: "walk2", in: 27, out: 30 },
      { id: "talk2", in: 40, out: 50 },
    ]);
    const r = byId(doc);
    expect(r["shot-length"]!.scenes).toEqual(["walk"]);
    expect(r.repeats!.scenes).toEqual(["walk2"]);
    // Clips heard before speech was mapped: the whole clip talks, as before.
    const old = byId(vlog([{ id: "walk", in: 15, out: 27 }], { mapped: false }));
    expect(old["shot-length"]!.status).toBe("pass");
  });

  it("doesn't call the scenery between two pieces to camera dead air, but does a silent pause", () => {
    const shot = [{ id: "all", in: 0, out: 50 }];
    expect(byId(vlog(shot))["dead-air"]!.status).toBe("pass");
    expect(byId(vlog(shot, { quiet: true }))["dead-air"]!.status).toBe("warn");
    // Opening on the scenery isn't a slow start.
    expect(byId(vlog([{ id: "open", in: 20, out: 50 }]))["dead-air"]!.status).toBe("pass");
  });

  it("frames speakers, not the people in the scenery", () => {
    expect(byId(vlog([{ id: "walk", in: 15, out: 27 }])).headroom!.status).toBe("pass");
    expect(byId(vlog([{ id: "talk", in: 0, out: 10 }])).headroom!.status).toBe("warn");
    // A big face is the subject even when nobody talks (a reaction, a portrait).
    const portrait = vlog([{ id: "walk", in: 15, out: 27 }]);
    const big = {
      ...portrait,
      analyses: portrait.analyses.map((a) => ({ ...a, face: { x: 0.5, y: 0.7, size: 0.3 } })),
    };
    expect(byId(big).headroom!.status).toBe("warn");
  });

  it("only asks the music to duck, and the captions to move, when they matter", () => {
    const scenery = vlog([{ id: "walk", in: 15, out: 27 }]);
    const withMusic = (doc: ProjectDoc) => ({
      ...doc,
      music: { ...doc.music, source: "vlog", duckUnderSpeech: false },
    });
    expect(byId(withMusic(scenery)).ducking!.status).toBe("pass");
    expect(byId(withMusic(vlog([{ id: "talk", in: 0, out: 10 }]))).ducking!.status).toBe("warn");
    // Captions set low, but nothing is captioned: nothing to move.
    const low = { ...scenery, captionStyle: { ...scenery.captionStyle, y: 0.95 } };
    expect(byId(low)["safe-zones"]!.status).toBe("pass");
  });
});
