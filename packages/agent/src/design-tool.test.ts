import { Design, emptyProject, type PastDesign, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { GUIDE_TOPICS } from "./guides.ts";
import { runTool, type Scratch, type ToolContext } from "./tools.ts";

const cooking = {
  idea: "Warm, hand-made kitchen notebook",
  palette: ["#e8743b", "#1b1612", "#f6efe6"],
  display: "Inter Tight",
  text: "IBM Plex Sans",
  motion: "soft settling drops, things land from above like ingredients",
  graphics: ["ingredient tag", "recipe card", "price count-up"],
};

function ctx(recent: PastDesign[] = []) {
  const scratch: Scratch = {
    doc: emptyProject("Soup") as ProjectDoc,
    ops: [],
    groups: [],
    guides: new Set(GUIDE_TOPICS),
  };
  const c: ToolContext = {
    scratch,
    host: { frame: async () => Buffer.from([]), recentDesigns: async () => recent },
    step: () => {},
  };
  return { c, scratch };
}

const GRAPHIC = `<!-- graphic {"name": "Tag"} --><style>.t { animation: in .4s var(--ease) both } .out { animation: o .3s var(--ease) var(--exit) both }</style><div class="out t">Tag</div>`;

describe("the design tool", () => {
  it("saves the design and points look's accent and font at it", async () => {
    const { c, scratch } = ctx();
    const out = await runTool("design", { label: "Design", ...cooking }, c);
    expect(out.isError).toBeFalsy();
    expect(scratch.doc.design.display).toBe("Inter Tight");
    expect(scratch.doc.look.accent).toBe("#e8743b");
    expect(scratch.doc.look.font).toBe("Inter Tight");
  });

  it("refuses a design that repeats a recent video's, and says what it repeats", async () => {
    const { c, scratch } = ctx([{ name: "Pasta night", design: Design.parse(cooking) }]);
    const out = await runTool("design", { label: "Design", ...cooking, palette: ["#f07a30", "#000000"] }, c);
    expect(out.isError).toBe(true);
    expect(out.text).toContain('"Pasta night"');
    expect(scratch.doc.design.idea).toBe("");
  });

  it("says when a face isn't in the project yet", async () => {
    const { c } = ctx();
    const out = await runTool("design", { label: "Design", ...cooking, display: "Fraunces" }, c);
    expect(out.text).toContain("Not in the project yet: Fraunces");
  });

  it("asks for a design before a new graphic, but lets an existing one be fixed", async () => {
    const { c, scratch } = ctx();
    const first = await runTool("write_graphic", { label: "Tag", id: "tag", html: GRAPHIC }, c);
    expect(first.isError).toBe(true);
    expect(first.text).toContain("decide this video's design first");

    await runTool("design", { label: "Design", ...cooking }, c);
    expect(
      (await runTool("write_graphic", { label: "Tag", id: "tag", html: GRAPHIC }, c)).isError,
    ).toBeFalsy();
    // An existing graphic changes without a design (a project from before designs).
    scratch.doc = { ...scratch.doc, design: Design.parse({}) };
    expect(
      (await runTool("write_graphic", { label: "Tag", id: "tag", html: GRAPHIC }, c)).isError,
    ).toBeFalsy();
  });
});

describe("guides", () => {
  it("are asked for before the jobs that need them, once a request", async () => {
    const scratch: Scratch = { doc: emptyProject("Soup") as ProjectDoc, ops: [], groups: [] };
    const c: ToolContext = { scratch, host: { frame: async () => Buffer.from([]) }, step: () => {} };
    const first = await runTool("write_graphic", { label: "Tag", id: "tag", html: GRAPHIC }, c);
    expect(first.isError).toBe(true);
    expect(first.text).toContain('guide {"topic": "graphics"}');
    const guide = await runTool("guide", { topic: "graphics" }, c);
    expect(guide.text).toContain("## The kit");
    // Read: the job goes on to its own checks (here, the design it needs first).
    const again = await runTool("write_graphic", { label: "Tag", id: "tag", html: GRAPHIC }, c);
    expect(again.text).toContain("decide this video's design first");
  });
});

describe("the first message", () => {
  it("shows recent designs to steer clear of, until this video has its own", async () => {
    const { buildPrompt } = await import("./context.ts");
    const recent = [{ name: "Pasta night", design: Design.parse(cooking) }];
    const doc = emptyProject("Soup") as ProjectDoc;
    const fresh = buildPrompt(doc, "Edit it", undefined, [], [], [], recent);
    expect(fresh).toContain("<recent_designs>");
    expect(fresh).toContain("- Pasta night: Inter Tight / IBM Plex Sans, accent #e8743b");
    const designed = buildPrompt(
      { ...doc, design: Design.parse(cooking) },
      "Edit it",
      undefined,
      [],
      [],
      [],
      recent,
    );
    expect(designed).not.toContain("<recent_designs>");
  });
});
