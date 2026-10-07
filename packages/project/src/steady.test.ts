import { describe, expect, it } from "vitest";
import { cutoutRange, flowHash, flowRange, needsFlow, steady, steadyAt } from "./motion.ts";
import { timelineOf } from "./time.ts";

const shaky = (n: number) => ({
  from: 2,
  to: 2 + n / 30,
  fps: 30,
  // A slow pan right with a jitter on top.
  x: Array.from({ length: n }, (_, i) => i * 0.002 + (i % 2 ? 0.01 : -0.01)),
  y: Array.from({ length: n }, (_, i) => (i % 3) * 0.005),
  a: Array.from({ length: n }, () => 0),
  s: Array.from({ length: n }, () => 0),
});

describe("steadying", () => {
  const frame = { w: 1080, h: 1920 };
  const shown = { w: 1080, h: 1920 };

  it("cancels the jitter and keeps the pan", () => {
    const st = steady(shaky(60), { amount: 0.6, zoom: 1.5 }, frame, shown);
    const path = shaky(60);
    const after = path.x.map((x, i) => x + st.x[i]!);
    // What's left moves smoothly: frame to frame it steps about as the pan does, not ±0.02.
    for (let i = 20; i < 40; i++) expect(Math.abs(after[i + 1]! - after[i]! - 0.002)).toBeLessThan(0.001);
    // And it zooms just enough to keep the frame filled.
    expect(st.zoom).toBeGreaterThan(1);
    expect(st.zoom).toBeLessThan(1.1);
  });

  it("holds still at 1, as on a tripod", () => {
    const st = steady(shaky(60), { amount: 1, zoom: 1.5 }, frame, shown);
    const path = shaky(60);
    const after = path.x.map((x, i) => x + st.x[i]!);
    expect(Math.max(...after) - Math.min(...after)).toBeLessThan(1e-6);
  });

  it("steadies less rather than zoom past its limit", () => {
    const st = steady(shaky(60), { amount: 1, zoom: 1.05 }, frame, shown);
    expect(st.zoom).toBeLessThanOrEqual(1.05 + 1e-6);
    // Footage wider than the frame has room to move without zooming.
    const wide = steady(shaky(60), { amount: 0.6, zoom: 1.05 }, frame, { w: 3413, h: 1920 });
    expect(wide.zoom).toBeLessThan(1.02);
  });

  it("reads the move between the path's frames, by clip time", () => {
    const st = steady(shaky(4), { amount: 0, zoom: 1.2 }, frame, shown);
    expect(steadyAt(st, 2 + 1.5 / 30).x).toBeCloseTo(0, 6);
    expect(steadyAt(st, 0).x).toBe(st.x[0]);
  });
});

describe("smooth slow motion", () => {
  const video = { kind: "video", fps: 30 };

  it("is needed only when slowed past the footage's frames", () => {
    expect(needsFlow({ speed: 0.5 }, video, 30)).toBe(true);
    expect(needsFlow({ speed: 0.5 }, { kind: "video", fps: 60 }, 30)).toBe(false);
    expect(needsFlow({ speed: 1 }, video, 30)).toBe(false);
    // Lower frame-rate footage at its own speed plays as filmed: not slow motion.
    expect(needsFlow({ speed: 1 }, { kind: "video", fps: 23.98 }, 30)).toBe(false);
    expect(needsFlow({ speed: 1 }, { kind: "video", fps: 25 }, 30)).toBe(false);
    // Slowed, it is.
    expect(needsFlow({ speed: 0.8 }, { kind: "video", fps: 25 }, 30)).toBe(true);
    expect(
      needsFlow(
        {
          ramp: [
            { at: 0, speed: 1 },
            { at: 1, speed: 0.3 },
          ],
        },
        video,
        30,
      ),
    ).toBe(true);
    expect(needsFlow({ speed: 0.5, interpolate: false }, video, 30)).toBe(false);
    expect(needsFlow({ speed: 0.5 }, { kind: "image" }, 30)).toBe(false);
  });

  it("covers what shows of the shot, and changes with anything it's made from", () => {
    const scenes = [
      { id: "a", source: "c", in: 0, out: 2, note: "", volume: 1 },
      {
        id: "b",
        source: "c",
        in: 5,
        out: 7,
        note: "",
        volume: 1,
        speed: 0.5,
        transition: { kind: "x", duration: 0.4 },
      },
    ];
    const tl = timelineOf({ scenes } as never);
    const b = scenes[1]! as never;
    expect(flowRange(b, tl)).toEqual(cutoutRange(b, tl));
    const ramped = {
      ...scenes[1]!,
      ramp: [
        { at: 0, speed: 1 },
        { at: 1, speed: 0.3 },
      ],
    } as never;
    expect(flowRange(ramped, tl)).toEqual({ from: 5, to: 7 });
    const r = flowRange(b, tl);
    expect(flowHash(b, r, 30)).toBe(flowHash(b, r, 30));
    expect(flowHash({ ...scenes[1]!, speed: 0.4 } as never, r, 30)).not.toBe(flowHash(b, r, 30));
  });
});
