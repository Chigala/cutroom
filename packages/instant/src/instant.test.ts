import { applyOps, CollectionSchemas, emptyProject, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { ask, UNCLEAR } from "./ask.ts";
import { type Answer, decode } from "./decode.ts";
import { precheck, tryInstant } from "./index.ts";
import { evaluate, JEV_MODEL, JevError } from "./jev.ts";
import { numbersIn } from "./numbers.ts";
import { plan } from "./plan.ts";

const source = {
  id: "cam",
  kind: "video",
  label: "cam",
  path: "/cam.mov",
  duration: 20,
  hdr: false,
  hasAudio: true,
  status: "ready",
  proxy: false,
  speech: true,
  summary: "",
  tags: [] as string[],
} satisfies ProjectDoc["sources"][number];

function project(): ProjectDoc {
  const at = (scene: string, t: number) => ({ scene, at: t });
  return {
    ...emptyProject("Test"),
    sources: [source],
    scenes: [
      { id: "sc1", source: "cam", in: 0, out: 5, note: "intro to camera", volume: 1 },
      { id: "sc2", source: "cam", in: 5, out: 12, note: "pouring the coffee", volume: 1 },
    ],
    titles: [
      CollectionSchemas.titles.parse({
        id: "t1",
        role: "hook",
        anchor: at("sc1", 0),
        duration: 3,
        text: "Stop scrolling",
      }),
      CollectionSchemas.titles.parse({
        id: "t2",
        role: "label",
        anchor: at("sc2", 1),
        duration: 2,
        text: "Day 1",
        size: 64,
      }),
    ],
    zooms: [
      CollectionSchemas.zooms.parse({
        id: "z1",
        anchor: at("sc1", 2),
        duration: 1,
        scale: 1.15,
        focus: { x: 0.5, y: 0.4 },
      }),
      CollectionSchemas.zooms.parse({
        id: "z2",
        anchor: at("sc2", 1.5),
        duration: 1,
        scale: 1.3,
        focus: { x: 0.5, y: 0.4 },
      }),
    ],
    sfx: [
      CollectionSchemas.sfx.parse({ id: "s1", anchor: at("sc1", 0), name: "whoosh" }),
      CollectionSchemas.sfx.parse({ id: "s2", anchor: at("sc2", 1), name: "pop" }),
    ],
  };
}

/** Answers as Jev gives them: a pick with its probability, the rest spread over the other options. */
const pick = (choice: string, p = 0.96): Answer => ({
  type: "choice",
  choice,
  probabilities: { [choice]: p, [UNCLEAR]: 1 - p },
});
const noul = (v: number): Answer => ({ type: "noul", noul: v });
const plain = {
  is_instruction: noul(0.97),
  adds_new: noul(0.05),
  to_taste: noul(0.05),
  several: noul(0.05),
  part_only: noul(0.05),
};

function run(doc: ProjectDoc, request: string, answers: Record<string, Answer>) {
  const { asked } = ask(doc, request);
  return decode(doc, request, { ...plain, ...answers }, asked);
}

describe("the plan, read off the schema", () => {
  const field = (target: string, key: string) =>
    plan()
      .find((t) => t.id === target)
      ?.fields.find((f) => f.key === key);

  it("offers choices, switches, ranged numbers and picks from other collections", () => {
    expect(field("captionStyle", "preset")).toMatchObject({
      kind: "enum",
      values: ["karaoke", "pop", "plain"],
    });
    expect(field("captionStyle", "size")).toMatchObject({ kind: "number", min: 16, max: 160, unit: "px" });
    expect(field("titles", "size")).toMatchObject({ kind: "number", min: 16, max: 200, unit: "px" });
    expect(field("music", "volume")).toMatchObject({ kind: "number", min: 0, max: 1, unit: "fraction" });
    expect(field("look", "grade")).toMatchObject({ kind: "ref", coll: "grades" });
    expect(field("look", "vignette")).toMatchObject({ kind: "bool" });
    // A sticker's size, two levels into its content.
    expect(field("visuals", "content.box.width")).toMatchObject({ kind: "number" });
  });

  it("leaves text, placement and open-ended numbers to the agent", () => {
    expect(field("titles", "text")).toBeUndefined();
    expect(field("titles", "anchor")).toBeUndefined();
    expect(field("scenes", "in")).toBeUndefined();
    expect(field("titles", "keyframes")).toBeUndefined();
  });
});

describe("numbers in a request", () => {
  it("reads values with their units, and skips times", () => {
    expect(numbersIn("hook 75px, music at 10%, 1.5x speed, 2 seconds, at 0:09")).toEqual([
      { text: "75px", value: 75, unit: "px" },
      { text: "10%", value: 10, unit: "percent" },
      { text: "1.5x", value: 1.5, unit: "times" },
      { text: "2 seconds", value: 2, unit: "seconds" },
    ]);
  });
});

describe("the questions", () => {
  it("puts can't-tell first and marks what the user is pointing at", () => {
    const doc = project();
    const { body } = ask(doc, "make this bigger", {
      focus: { selection: { coll: "titles", id: "t2" }, time: 6.2 },
    });
    const items = body.questions["item.titles"]!;
    expect(Object.keys(items.criteria!)[0]).toBe(UNCLEAR);
    expect(Object.keys(body.questions.target!.criteria!)[0]).toBe(UNCLEAR);
    expect(items.criteria!.t2).toContain("selected");
    expect(items.criteria!.t1).not.toContain("selected");
    expect(JSON.stringify(body.state)).toContain("t2 (titles) is selected");
  });

  it("stays well inside Jev's request size", () => {
    const { body } = ask(project(), "make the hook bigger");
    // About 4 characters a token: far below the 64k-token limit.
    expect(JSON.stringify(body).length).toBeLessThan(120_000);
  });
});

describe("answers into edits", () => {
  it("makes the hook a step bigger", () => {
    const doc = project();
    const out = run(doc, "make the hook bigger", {
      verb: pick("change"),
      target: pick("titles"),
      "item.titles": pick("t1"),
      "field.titles": pick("size"),
      direction: pick("increase"),
      amount: pick("a_little", 0.8),
    });
    expect(out).toMatchObject({
      kind: "edit",
      ops: [{ op: "update", coll: "titles", id: "t1", patch: { size: 101 } }],
    });
    expect(out.kind === "edit" && out.label).toBe("Title size 84 → 101");
  });

  it("sets the music to the level written in the request", () => {
    const doc = project();
    const out = run(doc, "turn the music down to 10%", {
      verb: pick("change"),
      target: pick("music"),
      "field.music": pick("volume"),
      direction: pick("set"),
      number: pick("n0"),
    });
    expect(out).toMatchObject({ kind: "edit", ops: [{ op: "merge", key: "music", patch: { volume: 0.1 } }] });
  });

  it("takes a written size over a step, but not when it contradicts the words", () => {
    const doc = project();
    const answers = {
      verb: pick("change"),
      target: pick("titles"),
      "item.titles": pick("t1"),
      "field.titles": pick("size"),
      direction: pick("increase", 0.7),
      number: pick("n0"),
    };
    // The hook is 84px: 75 would make it smaller, though they said bigger.
    expect(run(doc, "make the hook bigger, it should be 75px", answers)).toMatchObject({ kind: "agent" });
    // At 64px, 75 is bigger: done.
    const smaller = { ...doc, titles: doc.titles.map((t) => (t.id === "t1" ? { ...t, size: 64 } : t)) };
    expect(run(smaller, "make the hook bigger, it should be 75px", answers)).toMatchObject({
      kind: "edit",
      ops: [{ patch: { size: 75 } }],
    });
  });

  it("hands over a written number outside the range rather than clamping it", () => {
    const out = run(project(), "hook to 300px", {
      verb: pick("change"),
      target: pick("titles"),
      "item.titles": pick("t1"),
      "field.titles": pick("size"),
      direction: pick("set"),
      number: pick("n0"),
    });
    expect(out).toMatchObject({ kind: "agent" });
  });

  it("hands over when two settings are about as likely", () => {
    const out = run(project(), "make the second zoom punchier", {
      verb: pick("change"),
      target: pick("zooms"),
      "item.zooms": pick("z2"),
      "field.zooms": {
        type: "choice",
        choice: "ease",
        probabilities: { ease: 0.52, scale: 0.41, [UNCLEAR]: 0.07 },
      },
    });
    expect(out).toMatchObject({ kind: "agent" });
  });

  it("picks from the project's own options", () => {
    const doc = project();
    const grade = doc.grades.find((g) => g.id !== doc.look.grade)!.id;
    const out = run(doc, `use the ${grade} grade`, {
      verb: pick("change"),
      target: pick("look"),
      "field.look": pick("grade"),
      "value.look.grade": pick(grade),
    });
    expect(out).toMatchObject({ kind: "edit", ops: [{ op: "merge", key: "look", patch: { grade } }] });
  });

  it("says when it's already that way", () => {
    const doc = project();
    const out = run(doc, "use the karaoke captions", {
      verb: pick("change"),
      target: pick("captionStyle"),
      "field.captionStyle": pick("preset"),
      "value.captionStyle.preset": pick(doc.captionStyle.preset),
    });
    expect(out.kind).toBe("same");
  });

  it("changes every item when asked for all", () => {
    const doc = project();
    const out = run(doc, "make all the zooms smooth", {
      verb: pick("change"),
      target: pick("zooms"),
      "item.zooms": pick("all"),
      "field.zooms": pick("ease"),
      "value.zooms.ease": pick("punch"),
    });
    expect(out.kind === "edit" && out.ops).toHaveLength(2);
    if (out.kind === "edit") expect(() => applyOps(doc, out.ops)).not.toThrow();
  });

  it("removes only when very sure", () => {
    const answers = { verb: pick("remove"), target: pick("sfx"), "item.sfx": pick("s1") };
    expect(run(project(), "remove the whoosh at the start", answers)).toMatchObject({
      kind: "edit",
      ops: [{ op: "remove", coll: "sfx", id: "s1" }],
    });
    expect(
      run(project(), "remove the whoosh at the start", { ...answers, "item.sfx": pick("s1", 0.9) }),
    ).toMatchObject({ kind: "agent" });
  });

  it("never removes every shot", () => {
    const out = run(project(), "delete all the shots", {
      verb: pick("remove"),
      target: pick("scenes"),
      "item.scenes": pick("all"),
    });
    expect(out).toMatchObject({ kind: "agent" });
  });

  it("undoes a named change", () => {
    const doc = project();
    const recent = [
      { id: "c2", label: "Music quieter" },
      { id: "c1", label: "Added zooms" },
    ];
    const { asked } = ask(doc, "undo the zooms", { recent });
    expect(
      decode(
        doc,
        "undo the zooms",
        { ...plain, verb: pick("undo"), undo_named: noul(0.9), undo: pick("c1") },
        asked,
      ),
    ).toEqual({ kind: "undo", commit: "c1" });
    // "Restore it back" names no change: the last one.
    expect(
      decode(
        doc,
        "restore it back",
        { ...plain, verb: pick("undo"), undo_named: noul(0.1), undo: pick(UNCLEAR, 0.4) },
        asked,
      ),
    ).toEqual({ kind: "undo", commit: "last" });
  });

  it("hands over anything new, creative or in several parts", () => {
    const doc = project();
    expect(run(doc, "add a title that says hi", { adds_new: noul(0.9) })).toMatchObject({ kind: "agent" });
    expect(run(doc, "hook 75px and move it up", { several: noul(0.8) })).toMatchObject({ kind: "agent" });
    expect(run(doc, "what do you think?", { is_instruction: noul(0.1) })).toMatchObject({ kind: "agent" });
  });
});

describe("before asking Jev", () => {
  it("does a bare undo with no model, and sends links, code and attachments to the agent", () => {
    expect(precheck("undo")).toEqual({ kind: "undo", commit: "last" });
    expect(precheck("Undo that pls")).toEqual({ kind: "undo", commit: "last" });
    expect(precheck("grade it like this: ```.grade{filter:sepia(1)}```")?.kind).toBe("agent");
    expect(precheck("use https://youtu.be/x as the meme")?.kind).toBe("agent");
    expect(precheck("use this music", 1)?.kind).toBe("agent");
    expect(precheck("make the hook bigger")).toBeNull();
  });
});

describe("the call", () => {
  it("pins the model and turns a slow reply into a clear error", async () => {
    let sent: { model?: string } = {};
    const ok = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ model: JEV_MODEL, answers: { verb: pick("change") } }));
    }) as unknown as typeof fetch;
    const reply = await evaluate(
      { url: "https://proxy", headers: {} },
      { state: {}, questions: {} },
      { fetch: ok },
    );
    expect(sent.model).toBe(JEV_MODEL);
    expect(reply.answers.verb).toBeDefined();

    const slow = ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
      )) as unknown as typeof fetch;
    await expect(
      evaluate(
        { url: "https://proxy", headers: {} },
        { state: {}, questions: {} },
        { fetch: slow, timeoutMs: 20 },
      ),
    ).rejects.toThrow(JevError);
  });

  it("skips the call for what plain code can decide", async () => {
    const out = await tryInstant({
      doc: project(),
      request: "undo",
      endpoint: { url: "https://unused.invalid", headers: {} },
    });
    expect(out).toEqual({ instant: { kind: "undo", commit: "last" } });
  });
});
