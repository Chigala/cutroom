import { Design, emptyProject, type ProjectDoc } from "@vedit/project";
import { describe, expect, it, vi } from "vitest";
import { StepLimit } from "./types.ts";

const GRAPHIC = `<!-- graphic {"name": "Tag", "params": {"word": {"type": "text", "default": "Tag"}}} --><style>.w { animation: in .4s var(--ease) both } .out { animation: o .3s var(--ease) var(--exit) both }</style><div class="out w">{{word}}</div>`;

const started: string[] = [];
vi.mock("./sdk.ts", () => ({
  runWithSubscription: vi.fn(async (run: { prompt: string; signal?: AbortSignal }, ctx: never) => {
    const { runTool } = await import("./tools.ts");
    const id = /with the id "([a-z0-9-]+)"/.exec(run.prompt)?.[1];
    if (id) {
      // A graphic's own agent: writes it, then runs out of turns before it can say so.
      started.push(id);
      await runTool("write_graphic", { label: id, id, html: GRAPHIC }, ctx);
      throw new StepLimit("");
    }
    await runTool(
      "make_graphics",
      {
        graphics: [
          { id: "tag", brief: "An ingredient tag that drops onto the bowl" },
          { id: "card", brief: "A recipe card that slides in from the left" },
        ],
      },
      ctx,
    );
    const ready = await runTool("graphics_ready", {}, ctx);
    return `Done. ${ready.text.split("\n")[0]}`;
  }),
}));

const design = Design.parse({
  idea: "A hand-written kitchen notebook",
  palette: ["#e8743b", "#1b1612"],
  display: "Inter Tight",
  text: "IBM Plex Sans",
  motion: "soft settling drops",
  graphics: ["ingredient tag"],
});

describe("graphics' own agents", () => {
  it("keep a graphic that was written before its agent ran out of turns", async () => {
    const { runAgent } = await import("./agent.ts");
    const result = await runAgent({
      doc: { ...(emptyProject("Soup") as ProjectDoc), design },
      prompt: "Make the graphics",
      host: { frame: async () => Buffer.alloc(0) },
      backend: "subscription",
      review: "light",
    });
    expect(started.sort()).toEqual(["card", "tag"]);
    expect(result.doc.graphics.map((g) => g.id)).toEqual(expect.arrayContaining(["tag", "card"]));
    expect(result.summary).toContain("tag: Tag");
  });

  it("never start once the request is stopped", async () => {
    started.length = 0;
    const { runAgent } = await import("./agent.ts");
    const stop = new AbortController();
    stop.abort();
    await runAgent({
      doc: { ...(emptyProject("Soup") as ProjectDoc), design },
      prompt: "Make the graphics",
      host: { frame: async () => Buffer.alloc(0) },
      backend: "subscription",
      review: "light",
      signal: stop.signal,
    }).catch(() => null);
    expect(started).toEqual([]);
  });
});
