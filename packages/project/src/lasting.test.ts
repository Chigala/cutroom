import { describe, expect, it } from "vitest";
import {
  applyOps,
  clearRect,
  emptyProject,
  entrySound,
  lasting,
  type ProjectDoc,
  scenesNeedingCutout,
  spanOf,
  splitSceneOps,
  timelineOf,
  trimSceneOps,
} from "./index.ts";

/** Three two-second shots: a (0-2), b (2-4), d (4-6). */
function shots(order = ["a", "b", "d"]): ProjectDoc {
  const base = emptyProject("t");
  const scene = (id: string, at: number) => ({ id, source: "c", in: at, out: at + 2, note: "", volume: 1 });
  const all = { a: scene("a", 0), b: scene("b", 5), d: scene("d", 9) } as Record<
    string,
    ReturnType<typeof scene>
  >;
  return {
    ...base,
    sources: [{ id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 20 }],
    scenes: order.map((id) => all[id]!),
  } as never;
}

describe("overlays that last", () => {
  it("cover the whole video, whatever the edit", () => {
    const watermark = { anchor: { scene: "d", at: 1 }, duration: 3, whole: true };
    expect(spanOf(timelineOf(shots()), watermark)).toEqual({ start: 0, end: 6 });
    // Shots reordered and one removed: still the whole video.
    expect(spanOf(timelineOf(shots(["d", "a"])), watermark)).toEqual({ start: 0, end: 4 });
  });

  it("run from their moment to a later one, both moving with the edit", () => {
    const label = { anchor: { scene: "a", at: 1 }, duration: 0.5, until: { scene: "d", at: 0.5 } };
    expect(spanOf(timelineOf(shots()), label)).toEqual({ start: 1, end: 4.5 });
    // Shot b removed: the end moves up with d.
    expect(spanOf(timelineOf(shots(["a", "d"])), label)).toEqual({ start: 1, end: 2.5 });
    // d now comes first (the end before the start): its own duration instead.
    expect(spanOf(timelineOf(shots(["d", "a", "b"])), label)).toEqual({ start: 3, end: 3.5 });
    // d gone: its own duration too.
    expect(spanOf(timelineOf(shots(["a", "b"])), label)).toEqual({ start: 1, end: 1.5 });
    expect(spanOf(timelineOf(shots()), { ...label, until: "end" })).toEqual({ start: 1, end: 6 });
  });

  it("leave a moment as it was", () => {
    const moment = { anchor: { scene: "b", at: 0.5 }, duration: 1 };
    expect(spanOf(timelineOf(shots()), moment)).toEqual({ start: 2.5, end: 3.5 });
    expect(lasting({ whole: false })).toBe(false);
    expect(lasting({ whole: true })).toBe(true);
    expect(lasting({ until: "end" })).toBe(true);
  });

  it("put the person behind them for as long as they last", () => {
    const doc = {
      ...shots(),
      titles: [
        {
          id: "t1",
          role: "title",
          anchor: { scene: "a", at: 0 },
          duration: 1,
          text: "BIG",
          behindSubject: true,
          whole: true,
        },
      ],
    };
    const tl = timelineOf(doc as never);
    const starts = new Map(tl.scenes.map((p) => [p.scene.id, { start: p.start, end: p.start + p.duration }]));
    expect(scenesNeedingCutout(doc as never, starts).map((s) => s.id)).toEqual(["a", "b", "d"]);
  });
});

describe("a stretch's end", () => {
  /** A chapter label from shot a to 1.5s into shot d. */
  const labelled = () =>
    ({
      ...shots(),
      titles: [
        {
          id: "t1",
          role: "label",
          anchor: { scene: "a", at: 0.5 },
          duration: 1,
          text: "Part 2",
          until: { scene: "d", at: 1.5 },
        },
      ],
    }) as unknown as ProjectDoc;
  const end = (doc: ProjectDoc) => spanOf(timelineOf(doc), doc.titles[0]!)!.end;

  it("stays on its moment when its shot is split", () => {
    const doc = labelled();
    const split = applyOps(doc, splitSceneOps(doc, "d", 1)).doc;
    expect(end(split)).toBeCloseTo(end(doc));
    expect(split.titles[0]!.until).toMatchObject({ at: 0.5 });
  });

  it("stays on its moment of the footage when its shot is trimmed", () => {
    const doc = labelled();
    // A second off the front of d: the moment it ended on is now 0.5s in.
    const trimmed = applyOps(doc, trimSceneOps(doc, "d", 10, 11)).doc;
    expect(trimmed.titles[0]!.until).toEqual({ scene: "d", at: 0.5 });
  });
});

describe("entry sounds", () => {
  it("are only the ones a visual names", () => {
    expect(entrySound({})).toBeNull();
    expect(entrySound({ sfx: "pop" })).toBe("pop");
    expect(entrySound({ sfx: "none" })).toBeNull();
    expect(entrySound({ sfx: null })).toBeNull();
  });
});

describe("the clear area", () => {
  it("keeps a portrait frame's overlays off the app's buttons, and leaves a wide frame whole", () => {
    expect(clearRect({ platform: "tiktok" }, 1080, 1920)).toEqual({
      left: 0,
      top: 0.08 * 1920,
      width: 0.82 * 1080,
      height: (0.78 - 0.08) * 1920,
    });
    expect(clearRect({ platform: "tiktok" }, 1920, 1080)).toEqual({
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
    // The project's own clear area, when it sets one.
    const own = clearRect({ platform: "tiktok", safeZone: { top: 0, bottom: 0.9, right: 0.9 } }, 1000, 2000);
    expect(own).toEqual({ left: 0, top: 0, width: 900, height: 1800 });
  });
});

