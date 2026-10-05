import { describe, expect, it } from "vitest";
import { linkTracks } from "./track.ts";

const face = (x: number, y = 0.4, w = 0.1) => ({ k: "face" as const, x, y, w, h: w });

describe("linkTracks", () => {
  it("follows two faces moving apart, and ends tracks at a shot change", () => {
    const times = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const frames = times.map((t) => [face(0.3 - t * 0.2), face(0.7 + t * 0.2)]);
    const tracks = linkTracks(times, frames);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.points).toHaveLength(6);
    expect(tracks[0]!.points.at(-1)!.x).toBeLessThan(tracks[0]!.points[0]!.x);
    // A cut at 0.25s: each face becomes two tracks.
    expect(linkTracks(times, frames, [0.25])).toHaveLength(4);
  });

  it("drops one-frame blips", () => {
    const times = [0, 0.1, 0.2, 0.3];
    const frames = [[face(0.5)], [face(0.5), face(0.1)], [face(0.5)], [face(0.5)]];
    expect(linkTracks(times, frames)).toHaveLength(1);
  });
});
