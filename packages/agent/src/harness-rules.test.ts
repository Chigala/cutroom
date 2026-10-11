import { emptyProject, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { runTool, type Scratch, type ToolContext } from "./tools.ts";

function setup(over: Partial<Scratch> = {}) {
  const scratch: Scratch = { doc: emptyProject("Plans") as ProjectDoc, ops: [], groups: [], ...over };
  const halted: string[] = [];
  let stills = 0;
  const ctx: ToolContext = {
    scratch,
    host: {
      frame: async () => Buffer.from([0xff, 0xd8, 0xff]),
      stills: async (_doc, times) => {
        stills++;
        return { images: times.map(() => Buffer.from([0xff, 0xd8, 0xff])), errors: [] };
      },
    },
    step: () => {},
    halt: (why) => halted.push(why),
  };
  return { ctx, scratch, halted, stills: () => stills };
}

describe("the plan", () => {
  it("is asked for once on a big request, then shown after every step", async () => {
    const { ctx } = setup({ planWanted: true });
    const first = await runTool("get_project", {}, ctx);
    expect(first.text).toContain("You haven't made a plan yet: call update_plan");
    // Asked once only.
    expect((await runTool("get_project", {}, ctx)).text).not.toContain("You haven't made a plan");
    const plan = await runTool(
      "update_plan",
      {
        steps: [
          { content: "Cut the retakes", status: "completed" },
          { content: "Captions", status: "in_progress" },
          { content: "Graphics", status: "pending" },
        ],
      },
      ctx,
    );
    expect(plan.text).toBe("Plan (1 of 3 done):\n[x] Cut the retakes\n[>] Captions\n[ ] Graphics");
    expect((await runTool("get_project", {}, ctx)).text).toContain("[>] Captions");
  });

  it("keeps one step in progress at a time", async () => {
    const { ctx } = setup();
    const two = await runTool(
      "update_plan",
      {
        steps: [
          { content: "Cut", status: "in_progress" },
          { content: "Captions", status: "in_progress" },
        ],
      },
      ctx,
    );
    expect(two.isError).toBe(true);
  });
});

describe("stuck detection", () => {
  it("nudges after five identical calls, and stops after eight that fail the same way", async () => {
    const { ctx, halted } = setup();
    const call = () => runTool("read_graphic", { id: "nope" }, ctx);
    for (let i = 1; i < 5; i++) expect((await call()).text).not.toContain("keeps failing");
    expect((await call()).text).toContain("read_graphic with the same input 5 times and it keeps failing");
    // Nudged once per streak.
    expect((await call()).text).not.toContain("keeps failing the same way. Repeating");
    await call();
    expect(halted).toEqual([]);
    expect((await call()).text).toContain("Stopped: read_graphic failed the same way 8 times.");
    expect(halted).toEqual(["it called read_graphic the same way 8 times and it kept failing"]);
  });

  it("starts the count again when the call changes", async () => {
    const { ctx, halted } = setup();
    for (let i = 0; i < 7; i++) await runTool("read_graphic", { id: "nope" }, ctx);
    await runTool("read_graphic", { id: "other" }, ctx);
    await runTool("read_graphic", { id: "nope" }, ctx);
    expect(halted).toEqual([]);
  });
});

describe("looking again", () => {
  it("doesn't render the same frames twice when nothing changed, but does once something has", async () => {
    const { ctx, scratch, stills } = setup();
    scratch.doc = {
      ...scratch.doc,
      sources: [{ id: "s", kind: "solid", label: "s", color: "#000000", duration: 0 }],
      scenes: [{ id: "a", source: "s", in: 0, out: 3, note: "", volume: 1 }],
    } as unknown as ProjectDoc;
    await runTool("look", { times: [1] }, ctx);
    expect(stills()).toBe(1);
    const again = await runTool("look", { times: [1] }, ctx);
    expect(again.text).toContain("Nothing has changed since your last look");
    expect(stills()).toBe(1);
    await runTool("look", { times: [2] }, ctx);
    expect(stills()).toBe(2);
    scratch.doc = { ...scratch.doc };
    await runTool("look", { times: [2] }, ctx);
    expect(stills()).toBe(3);
  });
});
