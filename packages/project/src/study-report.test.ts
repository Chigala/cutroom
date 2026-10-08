import { describe, expect, it } from "vitest";
import { motionReport, type ReferenceStudy, rhythmReport } from "./reference.ts";

/** 120 bpm over 20 s: a beat every half second. */
const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);

/** Quiet, with a swell in the half second before 8 s (a whoosh into the cut there). */
const loudness = Array.from({ length: 401 }, (_, i) => (i * 0.05 > 7.5 && i * 0.05 < 7.98 ? 0.3 : 0.02));

type Rhythm = NonNullable<ReferenceStudy["rhythm"]>;
type Motion = NonNullable<ReferenceStudy["motion"]>;

const rhythm = (hits: number[], effects: Rhythm["effects"] = []): Rhythm => ({
  bpm: 120,
  pulse: 5,
  beats,
  hits: hits.map((at) => ({ at, strength: 6 })),
  voiceless: true,
  loudness,
  effects,
});

describe("what lands on what", () => {
  it("counts cuts on the beat against what chance gives, and on hits, and with a rise into them", () => {
    // Four cuts on beats, one off them (on a hit), one with a whoosh into it.
    const r = rhythmReport(rhythm([3.25, 8, 12.75]), [2, 4.5, 6, 10, 3.25, 8], [12.75], 20);
    expect(r.chance.beat).toBe(0.28);
    expect(r.cuts).toEqual({ count: 6, onBeat: 0.83, onHit: 0.33, rise: 0.17 });
    expect(r.punches).toEqual({ count: 1, onBeat: 0, onHit: 1, rise: 0 });
    // The hits off the beat (3.25 and 12.75), per 10 s.
    expect(r.offBeatHits).toBe(1);
  });

  it("doesn't count beats where there's no pulse to speak of", () => {
    const r = rhythmReport({ ...rhythm([]), pulse: 1.2 }, [2, 4.5], [], 20);
    expect(r.cuts.onBeat).toBe(0);
    expect(r.chance.beat).toBe(0);
  });
});

describe("the frame's movement over a video", () => {
  it("sums punches, pushes, pans and how steady the shots are; and counts the kinds of cut", () => {
    const shot = (from: number, to: number, o: Partial<Motion["shots"][number]> = {}) => ({
      from,
      to,
      punches: [],
      drift: 0,
      pan: { x: 0, y: 0 },
      shake: 0.001,
      ...o,
    });
    const m = motionReport(
      {
        shots: [
          shot(0, 2, { punches: [{ at: 1, size: 0.1 }], shake: 0.006 }),
          shot(2, 4, { punches: [{ at: 3, size: -0.06 }] }),
          shot(4, 7, { drift: 0.08 }),
          shot(7, 9, { pan: { x: 0.12, y: 0 }, shake: 0.003 }),
        ],
        transitions: [
          { at: 2, kind: "cut" },
          { at: 4, kind: "cut" },
          { at: 7, kind: "flash" },
        ],
        jumps: [{ at: 4, size: 0.12 }],
      },
      9,
    );
    expect(m).toMatchObject({
      punches: 2,
      per10s: 2.2,
      size: 0.08,
      punchesIn: 1,
      shotsPunched: 0.5,
      pushes: 1,
      pushSize: 0.08,
      pans: 1,
      locked: 0.5,
      handheld: 0.25,
      transitions: { cut: 2, flash: 1 },
      jumps: 1,
      jumpSize: 0.12,
      jumpsIn: 1,
      jumpShare: 0.33,
    });
  });
});

describe("effects, and what they land on", () => {
  it("counts each kind and what it lands on: cuts, zooms, text coming up", () => {
    const r = rhythmReport(
      rhythm(
        [],
        [
          // Whooshes land near cuts (a third of a second either side), one on its own.
          { at: 3.8, kind: "whoosh", confidence: 0.6 },
          { at: 8.2, kind: "whoosh", confidence: 0.5 },
          { at: 15, kind: "whoosh", confidence: 0.4 },
          // A pop as a word comes up; an impact on a zoom.
          { at: 6.05, kind: "pop", confidence: 0.4 },
          { at: 12.7, kind: "impact", confidence: 0.5 },
        ],
      ),
      [4, 8],
      [],
      20,
      { zooms: [12.75], text: [6], textNear: 0.125 },
    );
    expect(r.effects).toEqual([
      { kind: "whoosh", count: 3, onCuts: 2, onZooms: 0, onText: 0 },
      { kind: "pop", count: 1, onCuts: 0, onZooms: 0, onText: 1 },
      { kind: "impact", count: 1, onCuts: 0, onZooms: 1, onText: 0 },
    ]);
    // What landing there means: a cut's window (±0.12 s) twice, a zoom's once, text's once, over 20 s.
    expect(r.effectChance).toEqual({ cuts: 0.02, zooms: 0.01, text: 0.01 });
  });

  it("doesn't call a rise a rise when the voice is still in the sound", () => {
    const r = rhythmReport({ ...rhythm([]), voiceless: false }, [8], [], 20);
    expect(r.cuts.rise).toBeNull();
  });
});
