import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyOps,
  type Commit,
  demoProject,
  diffCollection,
  diffDocs,
  makeCommit,
  nextId,
  type Op,
  OpError,
  parseOps,
  resolveAnchor,
  revertOps,
  rewind,
  sceneAt,
  summarize,
  timelineOf,
} from "./index.ts";
import { ProjectStore, readLog } from "./node/index.ts";

const doc = demoProject();

describe("ops", () => {
  it("round-trips through their inverse", () => {
    const ops: Op[] = [
      {
        op: "insert",
        coll: "zooms",
        item: {
          id: "zx",
          anchor: { scene: "sc2", at: 0.1 },
          duration: 1,
          scale: 1.3,
          focus: { x: 0.5, y: 0.5 },
          ease: "punch",
        },
      },
      { op: "update", coll: "scenes", id: "sc3", patch: { out: 2, note: "shorter" } },
      { op: "remove", coll: "scenes", id: "sc5" },
      { op: "move", coll: "scenes", id: "sc1", index: 4 },
      { op: "merge", key: "music", patch: { volume: 0.5 } },
      { op: "set", key: "style", value: "# New style\n" },
    ];
    const { doc: next, inverse } = applyOps(doc, ops);
    expect(next.scenes).toHaveLength(13);
    expect(next.scenes[4]!.id).toBe("sc1");
    expect(next.music.volume).toBe(0.5);
    expect(applyOps(next, inverse).doc).toEqual(doc);
  });

  it("keeps untouched collections by reference", () => {
    const { doc: next } = applyOps(doc, [{ op: "update", coll: "zooms", id: "z1", patch: { scale: 1.5 } }]);
    expect(next.scenes).toBe(doc.scenes);
    expect(next.zooms).not.toBe(doc.zooms);
    expect(next.zooms[1]).toBe(doc.zooms[1]);
  });

  it("is atomic and leaves the doc alone on failure", () => {
    const ops: Op[] = [
      { op: "update", coll: "zooms", id: "z1", patch: { scale: 1.5 } },
      { op: "remove", coll: "zooms", id: "nope" },
    ];
    expect(() => applyOps(doc, ops)).toThrow(OpError);
    expect(doc.zooms[0]!.scale).toBe(1.12);
  });

  it("validates items against the schema", () => {
    expect(() => applyOps(doc, [{ op: "update", coll: "zooms", id: "z1", patch: { scale: 9 } }])).toThrow(
      /scale/,
    );
    expect(() => applyOps(doc, [{ op: "update", coll: "scenes", id: "sc1", patch: { out: 0.1 } }])).toThrow(
      /out/,
    );
  });

  it("removes optional fields with null and restores them on undo", () => {
    const withPoint = applyOps(doc, [
      { op: "update", coll: "comments", id: "cm1", patch: { point: { x: 0.2, y: 0.3 } } },
    ]).doc;
    const { doc: cleared, inverse } = applyOps(withPoint, [
      { op: "update", coll: "comments", id: "cm1", patch: { point: null } },
    ]);
    expect(cleared.comments[0]!.point).toBeUndefined();
    expect(applyOps(cleared, inverse).doc.comments[0]!.point).toEqual({ x: 0.2, y: 0.3 });
  });

  it("parses untrusted ops with readable errors", () => {
    expect(parseOps([{ op: "remove", coll: "scenes", id: "sc1" }]).ok).toBe(true);
    expect(
      parseOps([{ op: "update", coll: "wordEdits", id: "clip_1:12", patch: { emphasis: true } }]).ok,
    ).toBe(true);
    expect(parseOps([{ op: "update", coll: "scenes", id: "sc:1", patch: {} }]).ok).toBe(false);
    const bad = parseOps([{ op: "explode", coll: "scenes" }]);
    expect(bad.ok).toBe(false);
  });
});

describe("commits", () => {
  it("undoes a single change group even after later edits", () => {
    const { doc: a, commit } = makeCommit(doc, null, {
      author: "agent",
      ops: [
        {
          op: "insert",
          coll: "zooms",
          item: {
            id: "n1",
            anchor: { scene: "sc2", at: 0 },
            duration: 1,
            scale: 1.2,
            focus: { x: 0.5, y: 0.5 },
            ease: "smooth",
          },
        },
        {
          op: "insert",
          coll: "zooms",
          item: {
            id: "n2",
            anchor: { scene: "sc3", at: 0 },
            duration: 1,
            scale: 1.2,
            focus: { x: 0.5, y: 0.5 },
            ease: "smooth",
          },
        },
        { op: "remove", coll: "scenes", id: "sc7" },
      ],
      groups: [
        { label: "+2 zooms", ops: [0, 1] },
        { label: "1 shot cut", ops: [2] },
      ],
    });
    const later = applyOps(a, [
      { op: "update", coll: "scenes", id: "sc1", patch: { note: "edited later" } },
    ]).doc;
    const undone = applyOps(later, revertOps(commit, 1)).doc;
    expect(undone.scenes.map((s) => s.id)).toEqual(doc.scenes.map((s) => s.id));
    expect(undone.scenes[0]!.note).toBe("edited later");
    expect(undone.zooms.map((z) => z.id)).toContain("n2");
  });

  it("summarizes ops into chip labels", () => {
    const labels = summarize([
      { op: "insert", coll: "zooms", item: doc.zooms[0]! },
      { op: "insert", coll: "zooms", item: doc.zooms[1]! },
      { op: "remove", coll: "scenes", id: "sc1" },
      { op: "remove", coll: "scenes", id: "sc2" },
      { op: "insert", coll: "titles", item: doc.titles[0]! },
      { op: "merge", key: "music", patch: { source: "clip_1" } },
    ]).map((g) => g.label);
    expect(labels).toEqual(["+2 zooms", "2 shots cut", "Hook title", "Music added"]);
  });
});

describe("diffCollection", () => {
  it("produces ops that turn one list into another", () => {
    const after = [...doc.scenes.slice(1, 6)]
      .reverse()
      .map((s, i) => (i === 0 ? { ...s, note: "changed" } : s));
    after.splice(2, 0, { id: "new", source: "clip_01", in: 0, out: 1, note: "", volume: 1 });
    const ops = diffCollection("scenes", doc.scenes, after);
    expect(applyOps(doc, ops).doc.scenes).toEqual(after);
  });
});

describe("time", () => {
  it("lays scenes back to back and resolves anchors", () => {
    const tl = timelineOf(doc);
    expect(tl.duration).toBeCloseTo(30, 5);
    expect(tl.byId.get("sc2")!.start).toBeCloseTo(2.2, 5);
    expect(resolveAnchor(tl, { scene: "sc2", at: 0.5 })).toBeCloseTo(2.7, 5);
    expect(resolveAnchor(tl, { scene: "gone", at: 0 })).toBeNull();
    expect(sceneAt(tl, 2.3)!.scene.id).toBe("sc2");
    expect(sceneAt(tl, 0)!.scene.id).toBe("sc1");
    expect(timelineOf(doc)).toBe(tl);
  });
});

describe("ProjectStore", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes the folder, logs commits, and reopens identically", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vedit-"));
    const store = await ProjectStore.create(dir, doc);
    const { commit } = store.commit({ author: "user", ops: [{ op: "remove", coll: "zooms", id: "z1" }] });
    await store.close();

    const zooms = JSON.parse(await readFile(path.join(dir, "motion/zooms.json"), "utf8"));
    expect(zooms).toHaveLength(3);
    const log: Commit[] = await readLog(dir);
    expect(log.map((c) => c.id)).toEqual([commit.id]);

    const reopened = await ProjectStore.open(dir);
    expect(reopened.doc).toEqual(store.doc);
    expect(reopened.head).toBe(commit.id);
  });

  it("turns outside edits into commits", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vedit-"));
    const seen: Commit[] = [];
    const store = await ProjectStore.create(dir, doc, { onCommit: (c) => seen.push(c) });
    store.watch();
    // FSEvents starts asynchronously on macOS: a write in the first moments can go unseen.
    await new Promise((ok) => setTimeout(ok, 500));
    const file = path.join(dir, "comments/comments.json");
    const comments = JSON.parse(await readFile(file, "utf8"));
    comments[0].status = "resolved";
    await writeFile(file, JSON.stringify(comments, null, 2));
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBe(1);
    expect(seen[0]!.author).toBe("file");
    expect(store.doc.comments[0]!.status).toBe("resolved");
    await store.close();
  }, 20_000); // the file watcher can be slow on a busy machine
});

describe("nextId", () => {
  it("counts past existing ids", () => {
    expect(nextId("sc", doc.scenes)).toBe("sc15");
    expect(nextId("clip_", [{ id: "clip_2" }])).toBe("clip_3");
  });
});

describe("history and diffs", () => {
  it("rewinds through commits and diffs back to any point", () => {
    const a = makeCommit(doc, null, { author: "user", ops: [{ op: "remove", coll: "zooms", id: "z1" }] });
    const b = makeCommit(a.doc, a.commit.id, {
      author: "agent",
      ops: [{ op: "merge", key: "look", patch: { grade: "warm" } }],
    });
    const c = makeCommit(b.doc, b.commit.id, {
      author: "user",
      ops: [{ op: "move", coll: "scenes", id: "sc1", index: 5 }],
    });
    // Back to right after commit a:
    const past = rewind(c.doc, [b.commit, c.commit]);
    expect(past).toEqual(a.doc);
    const ops = diffDocs(c.doc, past);
    expect(applyOps(c.doc, ops).doc).toEqual(a.doc);
  });
});

describe("media visuals", () => {
  it("fill in a box, a card style and looping", async () => {
    const { Visual } = await import("./schema.ts");
    const v = Visual.parse({
      id: "m1",
      anchor: { scene: "sc1", at: 1 },
      duration: 2,
      content: { kind: "media", source: "clip_2" },
    });
    expect(v.content).toEqual({
      kind: "media",
      source: "clip_2",
      in: 0,
      loop: true,
      box: { x: 0.5, y: 0.3, width: 0.62 },
      rotate: 0,
      style: "card",
    });
  });
});
