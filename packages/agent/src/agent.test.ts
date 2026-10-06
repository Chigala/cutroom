import {
  applyOps,
  type Commit,
  demoProject,
  emptyProject,
  type ProjectDoc,
  spokenWords,
} from "@vedit/project";
import { describe, expect, it } from "vitest";
import { API_TOOLS } from "./api.ts";
import { buildPrompt, handEdits } from "./context.ts";
import { runTool, type Scratch, type ToolContext } from "./tools.ts";
import { pictureView, projectView, searchFootage, transcriptView } from "./view.ts";

const words = "so today um so today I want to show you this".split(" ").map((text, i) => ({
  text,
  start: 0.5 + i * 0.4 + (i >= 3 ? 1 : 0),
  end: 0.8 + i * 0.4 + (i >= 3 ? 1 : 0),
}));

function talking(): ProjectDoc {
  return {
    ...emptyProject("Talk"),
    sources: [
      {
        id: "cam",
        kind: "video",
        label: "cam",
        path: "/cam.mov",
        duration: 8,
        hdr: false,
        hasAudio: true,
        status: "ready",
        proxy: false,
        speech: true,
        summary: "",
        tags: [],
      },
    ],
    transcripts: [{ id: "cam", language: "en", words }],
    scenes: [{ id: "sc1", source: "cam", in: 0, out: 8, note: "", volume: 1 }],
  };
}

function ctx(doc: ProjectDoc) {
  const steps: string[] = [];
  const scratch: Scratch = { doc, ops: [], groups: [] };
  const c: ToolContext = {
    scratch,
    host: { frame: async () => Buffer.from([0xff, 0xd8, 0xff]) },
    step: (t) => steps.push(t),
  };
  return { c, scratch, steps };
}

describe("agent tools", () => {
  it("expose object JSON schemas to the API", () => {
    for (const tool of API_TOOLS) {
      expect(tool.input_schema.type, tool.name).toBe("object");
      expect(JSON.stringify(tool.input_schema)).not.toContain("$schema");
    }
    expect(JSON.stringify(API_TOOLS).length).toBeLessThan(120_000);
  });

  it("looks at a graphic on its own without touching the timeline", async () => {
    const { c, scratch } = ctx(talking());
    const seen: ProjectDoc[] = [];
    const errors = ["kinetic: boom"];
    c.host.stills = async (doc, times) => {
      seen.push(doc);
      return { images: times.map(() => Buffer.from([0xff, 0xd8, 0xff])), errors };
    };
    const out = await runTool(
      "look",
      { graphic: "kinetic", params: { text: "Hi *there*" }, layout: "split", times: [0.2, 1, 99] },
      c,
    );
    expect(out.images).toHaveLength(2);
    expect(out.text).toContain("Errors: kinetic: boom");
    const doc = seen[0]!;
    expect(doc.scenes).toHaveLength(1);
    expect(doc.visuals).toEqual([
      expect.objectContaining({
        layout: "split",
        content: expect.objectContaining({ graphic: "kinetic", params: { text: "Hi *there*" } }),
      }),
    ]);
    expect(scratch.ops).toHaveLength(0);
    expect(scratch.graphicErrors?.get("kinetic")).toBe("boom");
    const checks = await runTool("run_checks", {}, c);
    expect(checks.text).toContain("- kinetic: boom");
  });

  it("tells the model what was attached, and that it isn't placed yet", () => {
    const doc = talking();
    const shot = { ...doc.sources[0]!, id: "clip_9", kind: "image" as const, label: "screenshot.png" };
    const prompt = buildPrompt(
      { ...doc, sources: [...doc.sources, shot] },
      "put this after scene one",
      undefined,
      [],
      [shot, doc.sources[0]!],
    );
    expect(prompt).toContain("<attachments>");
    expect(prompt).toContain('clip_9 "screenshot.png": a still image');
    expect(prompt).toMatch(/cam "cam": a 8\.0s clip/);
    expect(prompt.indexOf("<attachments>")).toBeLessThan(prompt.indexOf("put this after scene one"));
  });

  it("reads and searches the visual transcript", async () => {
    const doc: ProjectDoc = {
      ...talking(),
      shotLogs: [
        {
          id: "cam",
          segments: [
            {
              start: 0,
              end: 4,
              what: "Rocket waits on the pad",
              shot: "wide",
              camera: "static",
              energy: 1,
              quality: [],
              highlight: false,
              tags: ["rocket"],
            },
            {
              start: 4,
              end: 8,
              what: "Liftoff, huge flame and smoke",
              shot: "wide",
              camera: "tilt",
              energy: 5,
              quality: [],
              highlight: true,
              tags: ["launch", "flame"],
            },
          ],
          loud: [[4, 8]],
        },
      ],
    };
    const { c } = ctx(doc);
    const shots = await runTool("get_shots", { source: "cam" }, c);
    expect(shots.text).toContain(
      "0:04.0-0:08.0 wide · tilt · E5 ★ Liftoff, huge flame and smoke [launch, flame]",
    );
    expect(shots.text).toContain("Loud, no speech");
    const found = JSON.parse((await runTool("search_footage", { query: "flame" }, c)).text);
    expect(found.shown[0]).toMatchObject({ source: "cam", start: 4, highlight: true });
    expect(buildPrompt(doc, "make a sizzle", undefined, [])).toContain("<shots>");
  });

  it("reports each change as it's applied, for the editor's live draft", async () => {
    const { c } = ctx(talking());
    const drafts: { label: string; ops: number }[] = [];
    const watched: ToolContext = { ...c, draft: (label, ops) => drafts.push({ label, ops: ops.length }) };
    await runTool(
      "apply_ops",
      { label: "Vignette", ops: [{ op: "merge", key: "look", patch: { vignette: true } }] },
      watched,
    );
    // A change that doesn't apply isn't drafted.
    await runTool(
      "apply_ops",
      { label: "Nothing", ops: [{ op: "delete", coll: "titles", id: "nope" }] },
      watched,
    );
    expect(drafts).toEqual([{ label: "Vignette", ops: 1 }]);
  });

  it("can silence the music over a stretch of the cut", async () => {
    const { c, scratch } = ctx(talking());
    const out = await runTool(
      "apply_ops",
      {
        label: "No music on the walk-out",
        ops: [
          {
            op: "insert",
            coll: "musicCues",
            item: { id: "mc1", anchor: { scene: "sc1", at: 2 }, duration: 3, volume: 0, fade: 0.4 },
          },
        ],
      },
      c,
    );
    expect(out.isError).toBeFalsy();
    expect(scratch.doc.musicCues).toHaveLength(1);
    expect(JSON.parse(projectView(scratch.doc)).musicCues[0]).toMatchObject({
      id: "mc1",
      volume: 0,
      time: 2,
    });
  });

  it("rough_cut keeps the last take and reports what the cut says", async () => {
    const { c, scratch, steps } = ctx(talking());
    const out = await runTool(
      "rough_cut",
      { label: "Cut the false start", keep: [{ source: "cam", from: 3, to: 10 }] },
      c,
    );
    expect(out.isError).toBeFalsy();
    expect(
      spokenWords(scratch.doc)
        .map((w) => w.text)
        .join(" "),
    ).toBe("so today I want to show you this");
    expect(scratch.groups).toEqual([{ label: "Cut the false start", ops: scratch.ops.map((_, i) => i) }]);
    expect(steps).toEqual(["Cut the false start"]);
  });

  it("edit_words inserts, then updates, word edits", async () => {
    const { c, scratch } = ctx(talking());
    await runTool("edit_words", { label: "Emphasis", edits: [{ word: "cam:10", emphasis: true }] }, c);
    await runTool("edit_words", { label: "Fix", edits: [{ word: "cam:10", text: "THIS" }] }, c);
    expect(scratch.doc.wordEdits).toEqual([{ id: "cam:10", emphasis: true, text: "THIS" }]);
    const bad = await runTool("edit_words", { label: "x", edits: [{ word: "cam:99", emphasis: true }] }, c);
    expect(bad.isError).toBe(true);
  });

  it("apply_ops refuses to touch derived data and validates input", async () => {
    const { c } = ctx(talking());
    const derived = await runTool(
      "apply_ops",
      { label: "x", ops: [{ op: "remove", coll: "transcripts", id: "cam" }] },
      c,
    );
    expect(derived.isError).toBe(true);
    const invalid = await runTool("apply_ops", { label: "x", ops: [{ op: "explode" }] }, c);
    expect(invalid.isError).toBe(true);
  });

  it("look resolves output times to clip frames", async () => {
    const { c } = ctx(talking());
    const out = await runTool("look", { times: [1, 2] }, c);
    expect(out.images).toHaveLength(2);
    expect(out.text).toContain("sc1");
  });

  it("looks at a cut as one strip of the frames either side of it", async () => {
    const doc = talking();
    const { c } = ctx({
      ...doc,
      scenes: [
        { id: "sc1", source: "cam", in: 0, out: 4, note: "", volume: 1 },
        { id: "sc2", source: "cam", in: 4, out: 8, note: "", volume: 1 },
      ],
    });
    const { run } = await import("@vedit/media");
    const { stdoutBuffer: jpeg } = await run(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=216x384", "-frames:v", "1"].concat([
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-",
      ]),
      { binary: true },
    );
    const asked: number[][] = [];
    c.host.stills = async (_doc, times, options) => {
      asked.push([...times, options?.scale ?? 0]);
      return { images: times.map(() => jpeg), errors: [] };
    };
    // "Around 4.2" means the cut at 4s: four frames of the shot before it, four of the one after.
    const out = await runTool("look", { around: 4.2 }, c);
    expect(out.isError).toBeFalsy();
    expect(out.images).toHaveLength(1);
    expect(out.text).toContain("The cut at 4.00s from sc1 to sc2");
    expect(asked[0]!.slice(0, 8).map((t) => Math.round(t * 30))).toEqual([
      116, 117, 118, 119, 120, 121, 122, 123,
    ]);
    expect(asked[0]![8]).toBe(0.2);
    expect(out.text).toContain("4) 3.97s sc1; 5) 4.00s sc2");
  }, 30_000);

  it("says a silent clip has no sound, and hears a sound added this request", async () => {
    const doc = talking();
    const gif = { ...doc.sources[0]!, id: "gif", label: "Side-eye", hasAudio: false };
    const boom = { ...doc.sources[0]!, id: "boom", kind: "audio" as const, label: "Boom", duration: 1 };
    const { c } = ctx({ ...doc, sources: [...doc.sources, gif] });
    const asked: string[] = [];
    c.host.peaks = async (id, working) => {
      asked.push(id);
      // Only the agent's working copy knows the sound it just added.
      return working.sources.some((s) => s.id === id) ? new Uint8Array(50).fill(120) : null;
    };
    const silent = await runTool("listen", { source: "gif" }, c);
    expect(silent.isError).toBeFalsy();
    expect(silent.text).toContain("has no sound");
    expect(asked).toEqual([]);
    c.scratch.doc = { ...c.scratch.doc, sources: [...c.scratch.doc.sources, boom] };
    const heard = await runTool("listen", { source: "boom" }, c);
    expect(heard.isError).toBeFalsy();
    expect(heard.text).toContain('boom "Boom"');
  });

  it("stops changing the same shot after three tries with a look between each", async () => {
    const { c } = ctx(talking());
    c.host.stills = async (_doc, times) => ({ images: times.map(() => Buffer.from([0xff])), errors: [] });
    const change = (volume: number) =>
      runTool(
        "apply_ops",
        { label: "Volume", ops: [{ op: "update", coll: "scenes", id: "sc1", patch: { volume } }] },
        c,
      );
    const look = () => runTool("look", { times: [1] }, c);
    // Changes without looking in between are building, not going round in circles.
    await change(0.9);
    await change(0.8);
    await look();
    expect((await change(0.7)).text).not.toContain("third change");
    await look();
    const third = await change(0.6);
    expect(third.isError).toBeFalsy();
    expect(third.text).toContain("That's the third change to sc1");
    await look();
    const fourth = await change(0.5);
    expect(fourth.isError).toBe(true);
    expect(fourth.text).toContain("Not applied: you've changed sc1 3 times");
    expect(c.scratch.doc.scenes[0]!.volume).toBe(0.6);
  });
});

describe("agent context", () => {
  it("shows transcripts with indices, pauses and what is out of the cut", () => {
    let doc = talking();
    doc = applyOps(doc, [{ op: "update", coll: "scenes", id: "sc1", patch: { in: 2.2 } }]).doc;
    const view = transcriptView(doc, "cam");
    expect(view).toContain("[0]~so~");
    expect(view).toContain("[3]so");
    expect(view).toContain("⏸1.1s");
  });

  it("puts style, project, transcripts and history in the first message", () => {
    const prompt = buildPrompt(talking(), "make it tight", { time: 1.5 }, [{ user: "hi", agent: "hello" }]);
    expect(prompt).toContain("<style_md>");
    expect(prompt).toContain("<transcripts>");
    expect(prompt).toContain("<earlier_requests>");
    expect(prompt.endsWith("</focus>")).toBe(true);
  });

  it("never leaks file paths", () => {
    expect(projectView(talking())).not.toContain("/cam.mov");
    expect(projectView(demoProject())).not.toContain('"path"');
  });
});

describe("hand edits", () => {
  let n = 0;
  const commit = (author: Commit["author"], message: string, ops: Commit["ops"], reverts?: Commit) => ({
    id: `c${++n}`,
    parent: null,
    author,
    message,
    at: n,
    ops,
    undo: [],
    groups: [{ label: message, ops: ops.map((_, i) => i) }],
    ...(reverts && { reverts: { commit: reverts.id } }),
  });
  const trim = (id: string) =>
    [{ op: "update", coll: "scenes", id, patch: { in: 1, out: 3 } }] as Commit["ops"];

  it("lists what the user did by hand since the agent's last change, minus what they undid", () => {
    const old = commit("user", "Trimmed sc1", trim("sc1"));
    const cut = commit("agent", "Hook title", [
      { op: "insert", coll: "titles", item: { id: "t1" } } as Commit["ops"][number],
    ]);
    const sc2 = commit("user", "Trimmed sc2", trim("sc2"));
    const undoSc2 = commit("user", "Undo: Trimmed sc2", trim("sc2"), sc2);
    const sc3 = commit("user", "Trimmed sc3", trim("sc3"));
    const undoSc3 = commit("user", "Undo: Trimmed sc3", trim("sc3"), sc3);
    const redoSc3 = commit("user", "Trimmed sc3", trim("sc3"), undoSc3);
    const undoTitle = commit("user", "Undo: Hook title", [], cut);
    const drag = [1, 2, 3].map(() => commit("user", "Moved v2", trim("v2")));
    const imported = commit("user", "Imported 1 clip", [
      { op: "insert", coll: "sources", item: { id: "cam2" } } as Commit["ops"][number],
    ]);
    const log = [old, cut, sc2, undoSc2, sc3, undoSc3, redoSc3, undoTitle, ...drag, imported];
    // sc1 came before the agent's change (it has seen it since); sc2 was undone; sc3 was undone then
    // redone; the drag is one line; the import isn't an editing decision.
    expect(handEdits(log)).toEqual([
      "Trimmed sc3 (sc3: in, out)",
      "Undid your change: Hook title",
      "Moved v2 (v2: in, out)",
    ]);
    const prompt = buildPrompt(emptyProject("x"), "tighten it", undefined, [], [], handEdits(log));
    expect(prompt).toContain("<hand_edits>");
    expect(prompt).toContain("- Undid your change: Hook title");
    expect(buildPrompt(emptyProject("x"), "tighten it", undefined, [])).not.toContain("<hand_edits>");
  });
});

describe("what the picture holds, for the agent", () => {
  it("lists words on screen, flags captions already burned in, and the best and weak moments", () => {
    const doc = talking();
    const lines = Array.from({ length: 7 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 2,
      text: `line ${i}`,
      x: 0.1,
      y: 0.78,
      w: 0.6,
      h: 0.05,
    }));
    const analysis = {
      id: "cam",
      silences: [],
      shots: [],
      text: [{ start: 0, end: 9, text: "OPEN DAILY", x: 0.3, y: 0.1, w: 0.4, h: 0.06 }, ...lines],
      quality: [0, 1, 2, 3, 4].map((t) => ({ t, face: t === 2 ? 0.1 : 0.6, look: t === 4 ? 0.6 : 0.2 })),
    };
    const withSeen = { ...doc, analyses: [...doc.analyses.filter((a) => a.id !== "cam"), analysis] };
    const view = pictureView(withSeen as ProjectDoc, "cam");
    expect(view).toContain('"OPEN DAILY" (top)');
    expect(view).toContain("captions burned in");
    expect(view).toMatch(/Best-looking moments[^\n]*0:04/);
    expect(view).toMatch(/Weak face moments[^\n]*0:02/);
    expect(searchFootage(withSeen as ProjectDoc, "open daily").onScreen?.[0]).toMatchObject({
      text: "OPEN DAILY",
    });
  });
});
