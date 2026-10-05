import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyOps,
  type Commit,
  captionLookMeta,
  emptyProject,
  fontFromFile,
  graphicParams,
  isScripted,
  lookDefaults,
  parseGraphic,
  renderTemplate,
  STARTER_CAPTION_LOOKS,
  STARTER_GRAPHICS,
  validateCaptionLook,
  validateGraphic,
} from "./index.ts";
import { ProjectStore } from "./node/index.ts";

describe("graphic templates", () => {
  it("fills params, escaping HTML", () => {
    expect(renderTemplate("<b>{{title}}</b>", { title: "<i>hi</i> & co" })).toBe(
      "<b>&lt;i&gt;hi&lt;/i&gt; &amp; co</b>",
    );
  });

  it("turns *stars* into highlighted words", () => {
    expect(renderTemplate("{{t}}", { t: "found *the hole* <b>" })).toBe(
      'found <em class="hl">the hole</em> &lt;b&gt;',
    );
  });

  it("repeats lists with the item and its index", () => {
    const out = renderTemplate('{{#items}}<li style="--i: {{@index}}">{{.}}</li>{{/items}}', {
      items: ["a", "b"],
    });
    expect(out).toBe('<li style="--i: 0">a</li><li style="--i: 1">b</li>');
  });

  it("reads fields of list objects, and handles empty and inverted sections", () => {
    const out = renderTemplate(
      "{{#rows}}{{label}}={{value}};{{/rows}}{{#kicker}}K{{/kicker}}{{^kicker}}none{{/kicker}}",
      {
        rows: [{ label: "x", value: 1 }],
        kicker: "",
      },
    );
    expect(out).toBe("x=1;none");
  });

  it("reads the header and merges defaults", () => {
    const { meta, body } = parseGraphic(
      '<!-- graphic {"name": "T", "params": {"title": {"type": "text", "default": "D"}}} --><p>{{title}}</p>',
    );
    expect(meta.name).toBe("T");
    expect(renderTemplate(body, graphicParams(meta, {}))).toBe("<p>D</p>");
  });

  it("explains broken graphics", () => {
    expect(validateGraphic("{{#a}}open")).toMatch(/never closed/);
    expect(validateGraphic("<!-- graphic {bad} -->")).toMatch(/JSON/);
    expect(validateGraphic('<!-- graphic {"libs": ["jquery"]} -->')).toMatch(/unknown libs: jquery/);
    expect(validateGraphic('<script src="https://x.dev/a.js"></script>')).toMatch(/libs/);
    expect(validateGraphic("<script>fetch('https://x.dev')</script>")).toMatch(/network \(fetch\)/);
    expect(validateGraphic("<script>import('x')</script>")).toMatch(/network/);
  });

  it("allows scripted graphics", () => {
    const html =
      '<!-- graphic {"libs": ["gsap"]} --><div class="a"></div><script>gsap.from(".a", {x: 10})</script>';
    expect(validateGraphic(html)).toBeNull();
    const { meta, body } = parseGraphic(html);
    expect(meta.libs).toEqual(["gsap"]);
    expect(isScripted(meta, body)).toBe(true);
    expect(isScripted(parseGraphic("<div></div>").meta, "<div></div>")).toBe(false);
  });

  it("every starter graphic is valid", () => {
    for (const g of STARTER_GRAPHICS) expect(validateGraphic(g.html), g.id).toBeNull();
  });
});

describe("graphics folder", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes one file per graphic, deletes removed ones, and picks up outside edits", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vedit-g-"));
    const seen: Commit[] = [];
    const store = await ProjectStore.create(dir, emptyProject("G"), { onCommit: (c) => seen.push(c) });
    expect((await readdir(path.join(dir, "graphics"))).sort()).toEqual(
      STARTER_GRAPHICS.map((g) => `${g.id}.html`),
    );

    store.commit({ author: "user", ops: [{ op: "remove", coll: "graphics", id: "stamp" }] });
    await store.flush();
    expect(await readdir(path.join(dir, "graphics"))).not.toContain("stamp.html");

    store.watch();
    // FSEvents starts asynchronously on macOS: a write in the first moments can go unseen.
    await new Promise((ok) => setTimeout(ok, 500));
    await writeFile(
      path.join(dir, "graphics", "mine.html"),
      '<!-- graphic {"name": "Mine"} --><div>hello</div>\n',
    );
    await expect
      .poll(() => seen.map((c) => c.message), { timeout: 10_000 })
      .toContain("Edited graphics/mine.html");
    expect(store.doc.graphics.some((g) => g.id === "mine")).toBe(true);
    await store.close();

    const reopened = await ProjectStore.open(dir);
    expect(reopened.doc.graphics.map((g) => g.id)).toEqual(store.doc.graphics.map((g) => g.id).sort());
    expect(await readFile(path.join(dir, "graphics", "mine.html"), "utf8")).toContain("hello");
  }, 20_000); // the file watcher can be slow on a busy machine

  it("seeds starters into projects made before graphics existed", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vedit-g-"));
    const store = await ProjectStore.create(dir, applyOps(emptyProject("Old"), []).doc);
    await store.close();
    await rm(path.join(dir, "graphics"), { recursive: true });
    const reopened = await ProjectStore.open(dir);
    expect(reopened.doc.graphics).toHaveLength(STARTER_GRAPHICS.length);
    expect(await readdir(path.join(dir, "graphics"))).toHaveLength(STARTER_GRAPHICS.length);
  });
});

describe("caption looks", () => {
  it("starters are valid and name their defaults", () => {
    for (const l of STARTER_CAPTION_LOOKS) {
      expect(validateCaptionLook(l.css), l.id).toBeNull();
      expect(captionLookMeta(l.css)?.name, l.id).toBeTruthy();
    }
    expect(STARTER_CAPTION_LOOKS.map((l) => l.id)).toEqual(["boxed", "clean", "neon", "outline", "silver"]);
  });

  it("applies only the defaults a look names", () => {
    const css = '/* look {"defaults": {"maxWords": 5, "size": 9000, "look": "x", "bogus": 1}} */ .caption {}';
    expect(lookDefaults(css)).toEqual({ maxWords: 5 });
    expect(validateCaptionLook("@import url(x.css); .caption {}")).toMatch(/import/);
    expect(validateCaptionLook(".caption { background: url(https://x.dev/a.png) }")).toMatch(/remote/);
  });

  it("lives in captions/looks/ and is seeded into older projects", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vedit-l-"));
    const store = await ProjectStore.create(dir, emptyProject("L"));
    expect((await readdir(path.join(dir, "captions/looks"))).sort()).toEqual(
      STARTER_CAPTION_LOOKS.map((l) => `${l.id}.css`),
    );
    await store.close();
    await rm(path.join(dir, "captions/looks"), { recursive: true });
    const reopened = await ProjectStore.open(dir);
    expect(reopened.doc.captionLooks.map((l) => l.id)).toEqual(STARTER_CAPTION_LOOKS.map((l) => l.id));
    await reopened.flush();
    expect(await readdir(path.join(dir, "captions/looks"))).toContain("silver.css");
    await reopened.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("project fonts", () => {
  it("reads family, weight and style from file names", () => {
    expect(fontFromFile("BrandSans-SemiBoldItalic.woff2")).toMatchObject({
      id: "brandsans-semibolditalic",
      family: "BrandSans",
      weight: 600,
      style: "italic",
    });
    expect(fontFromFile("Inter Tight Bold.ttf")).toMatchObject({ family: "Inter Tight", weight: 700 });
    expect(fontFromFile("Brand.otf")).toMatchObject({ family: "Brand", weight: 400, style: "normal" });
    expect(fontFromFile("notes.txt")).toBeNull();
    expect(fontFromFile(".hidden.woff2")).toBeNull();
  });

  it("picks up dropped fonts and deletes a removed font's file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vedit-f-"));
    const seen: Commit[] = [];
    const store = await ProjectStore.create(dir, emptyProject("F"), { onCommit: (c) => seen.push(c) });
    await store.close();
    const reopened = await ProjectStore.open(dir, { onCommit: (c) => seen.push(c) });
    reopened.watch();
    // FSEvents starts asynchronously on macOS: a write in the first moments can go unseen.
    await new Promise((ok) => setTimeout(ok, 500));
    await writeFile(path.join(dir, "fonts", "Brand-Bold.woff2"), "not really a font");
    await expect.poll(() => reopened.doc.fonts.map((f) => f.family), { timeout: 10_000 }).toEqual(["Brand"]);
    expect(seen.at(-1)?.author).toBe("file");
    reopened.commit({ author: "user", ops: [{ op: "remove", coll: "fonts", id: "brand-bold" }] });
    await reopened.flush();
    expect(await readdir(path.join(dir, "fonts"))).toEqual([]);
    await reopened.close();
    await rm(dir, { recursive: true, force: true });
  }, 20_000);
});

describe("graphic libraries", () => {
  it("accepts every library the runtime ships, and every starter is valid", async () => {
    const { GRAPHIC_LIBS, STARTER_GRAPHICS, isScripted, parseGraphic } = await import("./index.ts");
    expect(Object.keys(GRAPHIC_LIBS).sort()).toEqual(["chart", "d3", "gsap", "lottie", "rough", "three"]);
    expect(
      validateGraphic('<!-- graphic {"libs": ["gsap", "d3", "chart", "rough", "three", "lottie"]} -->'),
    ).toBeNull();
    for (const g of STARTER_GRAPHICS) expect(validateGraphic(g.html), g.id).toBeNull();
    // The new starters run in the scripted runtime: a D3 chart, and particles with no library.
    const trend = STARTER_GRAPHICS.find((g) => g.id === "trend")!;
    const celebrate = STARTER_GRAPHICS.find((g) => g.id === "celebrate")!;
    expect(parseGraphic(trend.html).meta.libs).toEqual(["d3"]);
    expect(isScripted(parseGraphic(celebrate.html).meta, parseGraphic(celebrate.html).body)).toBe(true);
  });
});
