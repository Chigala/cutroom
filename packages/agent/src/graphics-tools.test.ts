import { Design, emptyProject, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { graphicPrompt } from "./agent.ts";
import { GUIDE_TOPICS } from "./guides.ts";
import { finishReview } from "./review.ts";
import { runTool, type Scratch, type ToolContext } from "./tools.ts";

const design = Design.parse({
  idea: "An architect's drawing set come to life",
  palette: ["#f2a65a", "#1e2422"],
  display: "Inter Tight",
  text: "IBM Plex Sans",
  motion: "lines draw first, then type follows",
  graphics: ["dimension line"],
});

const graphic = (word: string) =>
  `<!-- graphic {"name": "Word", "params": {"word": {"type": "text", "default": "${word}"}}} --><style>.w { animation: in .4s var(--ease) both } .out { animation: o .3s var(--ease) var(--exit) both }</style><div class="out w">{{word}}</div>`;

function setup(maker?: ToolContext["graphicMaker"]) {
  const scratch: Scratch = {
    doc: { ...(emptyProject("Plans") as ProjectDoc), design },
    ops: [],
    groups: [],
    guides: new Set(GUIDE_TOPICS),
  };
  const steps: string[] = [];
  const ctx: ToolContext = {
    scratch,
    host: { frame: async () => Buffer.from([]) },
    step: (t) => steps.push(t),
    ...(maker && { graphicMaker: maker }),
  };
  return { ctx, scratch, steps };
}

describe("graphics made in parallel", () => {
  it("start in the background, run at once, and land in the project by graphics_ready", async () => {
    let running = 0;
    let most = 0;
    const { ctx, scratch } = setup(async (id) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return graphic(id);
    });
    const started = await runTool(
      "make_graphics",
      {
        graphics: [
          { id: "dim", brief: "A dimension line that draws across the room's width" },
          { id: "stamp", brief: "A planning-approval stamp that lands on the key word" },
        ],
      },
      ctx,
    );
    expect(started.text).toContain("Designing dim, stamp in the background");
    // The request carries on meanwhile: nothing's in the project yet.
    expect(scratch.doc.graphics.some((g) => g.id === "dim")).toBe(false);
    const ready = await runTool("graphics_ready", {}, ctx);
    expect(most).toBe(2);
    expect(ready.text).toContain("dim: Word, 3s; params word (text)");
    expect(scratch.doc.graphics.map((g) => g.id)).toEqual(expect.arrayContaining(["dim", "stamp"]));
  });

  it("say when one couldn't be made, so the agent writes it itself", async () => {
    const { ctx } = setup(async () => {
      throw new Error("its agent finished without writing it");
    });
    await runTool(
      "make_graphics",
      { graphics: [{ id: "dim", brief: "A dimension line across the room" }] },
      ctx,
    );
    expect((await runTool("graphics_ready", {}, ctx)).text).toContain(
      "dim: not made (its agent finished without writing it); write it with write_graphic.",
    );
  });

  it("are waited for before the request finishes", async () => {
    const { ctx, scratch } = setup(async (id) => graphic(id));
    const review = finishReview(scratch.doc, ctx);
    await runTool(
      "make_graphics",
      { graphics: [{ id: "dim", brief: "A dimension line across the room" }] },
      ctx,
    );
    expect(await review()).toContain("the graphics you asked for are ready");
    expect(scratch.doc.graphics.some((g) => g.id === "dim")).toBe(true);
  });

  it("brief each agent with the design and the graphics guide", () => {
    const prompt = graphicPrompt(
      { ...(emptyProject("Plans") as ProjectDoc), design },
      "dim",
      "A dimension line",
    );
    expect(prompt).toContain('"idea": "An architect\'s drawing set come to life"');
    expect(prompt).toContain("## The kit");
    expect(prompt).toContain('with the id "dim"');
  });
});

describe("edit_graphic", () => {
  it("changes one exact piece, and refuses a find that's missing or ambiguous", async () => {
    const { ctx, scratch } = setup();
    scratch.doc = { ...scratch.doc, graphics: [{ id: "w", html: graphic("Hi") }] };
    const ok = await runTool(
      "edit_graphic",
      { label: "Faster in", id: "w", edits: [{ find: "in .4s", replace: "in .3s" }] },
      ctx,
    );
    expect(ok.isError).toBeFalsy();
    expect(scratch.doc.graphics[0]!.html).toContain("in .3s");
    const missing = await runTool(
      "edit_graphic",
      { label: "x", id: "w", edits: [{ find: "nope", replace: "" }] },
      ctx,
    );
    expect(missing.text).toContain("isn't in the graphic");
    const twice = await runTool(
      "edit_graphic",
      { label: "x", id: "w", edits: [{ find: "var(--ease)", replace: "" }] },
      ctx,
    );
    expect(twice.text).toContain("matches 2 places");
  });
});
