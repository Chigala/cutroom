import { describe, expect, it } from "vitest";
import { scopeCss } from "./css-scope.ts";

describe("scopeCss", () => {
  it("scopes layer rules to the wrapper, renames keyframes, and drops everything else", () => {
    const css = `/* effect {"name": "X"} */
      .frame { animation: shake .4s linear both, in var(--duration) both; }
      .overlay { background: red; animation: shake 1s; }
      body, .frame::after { color: red; }
      @keyframes shake { from { transform: translateX(10px); } }
      @media (min-width: 1px) { .frame { color: blue; } }`;
    const out = scopeCss(css, "vfx1", ["frame"]);
    expect(out).toContain(
      '[data-vfx~="vfx1-frame"] { animation: vfx1-shake .4s linear both, in var(--duration) both; }',
    );
    expect(out).toContain('[data-vfx~="vfx1-frame"]::after { color: red; }');
    expect(out).toContain("@keyframes vfx1-shake");
    expect(out).not.toContain("overlay");
    expect(out).not.toMatch(/(^|\s)body/);
    expect(out).not.toContain("@media");
  });

  it("leaves classes that only start like a layer alone", () => {
    expect(scopeCss(".frames { x: 1 } .in-out { y: 2 } .in { z: 3 }", "a", ["in", "out"])).toBe(
      '[data-vfx~="a-in"] { z: 3 }',
    );
  });
});
