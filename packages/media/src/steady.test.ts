import { describe, expect, it } from "vitest";
import { fitMove } from "./steady.ts";

describe("reading the camera's move", () => {
  const grid = Array.from({ length: 30 }, (_, i) => ({
    u: (i % 6) * 40 - 100,
    v: Math.floor(i / 6) * 30 - 60,
  }));

  it("finds a shift, turn and zoom from where patches went", () => {
    const a = 0.01;
    const s = 1.02;
    const pairs = grid.map(({ u, v }) => {
      const x = s * (Math.cos(a) * u - Math.sin(a) * v) + 3;
      const y = s * (Math.sin(a) * u + Math.cos(a) * v) - 2;
      return { u, v, du: x - u, dv: y - v };
    });
    const m = fitMove(pairs);
    expect(m.tx).toBeCloseTo(3, 4);
    expect(m.ty).toBeCloseTo(-2, 4);
    expect(m.a).toBeCloseTo(a, 5);
    expect(m.s).toBeCloseTo(s, 5);
  });

  it("leaves out what moved on its own (a person walking through)", () => {
    const pairs = grid.map(({ u, v }, i) => ({ u, v, du: i < 8 ? 15 : 2, dv: i < 8 ? 9 : 0 }));
    const m = fitMove(pairs);
    expect(m.tx).toBeCloseTo(2, 3);
    expect(m.ty).toBeCloseTo(0, 3);
  });

  it("calls it still when there's too little to go on", () => {
    expect(fitMove(grid.slice(0, 3).map(({ u, v }) => ({ u, v, du: 5, dv: 5 })))).toEqual({
      tx: 0,
      ty: 0,
      a: 0,
      s: 1,
    });
  });
});
