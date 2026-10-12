import { describe, expect, it } from "vitest";
import { lintGraphic } from "./graphic-lint.ts";
import { STARTER_GRAPHICS } from "./starter-graphics.ts";

const header = (params = '{"t": {"type": "text", "default": "Big point"}}', libs = "") =>
  `<!-- graphic {"name": "T", "params": ${params}${libs ? `, "libs": ${libs}` : ""}} -->`;

const kinds = (html: string) => lintGraphic(html).map((l) => l.message.split(":")[0]);

describe("lintGraphic", () => {
  it("passes every starter graphic", () => {
    for (const g of STARTER_GRAPHICS) expect(lintGraphic(g.html), g.id).toEqual([]);
  });

  it("flags linear and keyword curves, but not the house curve", () => {
    const css = (curve: string) =>
      `${header()}<style>.a { animation: rise .5s ${curve} both } .out { animation: o .3s var(--ease) var(--exit) both }</style><div class="out a">{{t}}</div>`;
    expect(kinds(css("linear"))).toEqual(["linear timing"]);
    expect(kinds(css("ease-in-out"))[0]).toContain("default curve");
    expect(lintGraphic(css("var(--ease)"))).toEqual([]);
    expect(lintGraphic(css("cubic-bezier(.16, 1, .3, 1)"))).toEqual([]);
  });

  it("flags motion that never leaves", () => {
    const html = `${header()}<style>.a { animation: rise .5s var(--ease) both }</style><div class="a">{{t}}</div>`;
    expect(kinds(html)).toEqual(["nothing leaves"]);
  });

  it("flags pixel type and banned faces", () => {
    const html = `${header()}<style>.a { font: 700 64px Arial; font-size: 64px; animation: o .3s var(--ease) var(--exit) both }</style><div class="a">{{t}}</div>`;
    const found = lintGraphic(html).map((l) => l.kind);
    expect(found).toEqual(["type", "type"]);
  });

  it("flags timers in scripts and text rules in defaults", () => {
    const html = `${header('{"t": {"type": "text", "default": "Wow! 🚀"}}', '["gsap"]')}<div>{{t}}</div><script>setTimeout(() => {}, 100); graphic.onFrame((t, f) => { if (t > f.duration - .3) {} });</script>`;
    const found = lintGraphic(html);
    expect(found.map((l) => l.kind)).toEqual(["script", "text"]);
    expect(found[1]!.message).toContain("an emoji and an exclamation mark");
  });
});
