import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyOps, emptyProject, type ProjectDoc, type Source } from "@vedit/project";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }));

const { copyProject, footageOps, relinkOps } = await import("./projects.ts");

const clip = (id: string, extra: Partial<Source> = {}): Source => ({
  id,
  kind: "video",
  label: id,
  path: `/footage/${id}.mov`,
  duration: 12.5,
  hdr: false,
  hasAudio: true,
  status: "ready",
  proxy: true,
  speech: true,
  summary: "",
  tags: [],
  ...extra,
});

describe("starting over from the footage", () => {
  it("clears the edit and puts each imported clip back whole, keeping the analysis and the taste", () => {
    const dir = "/projects/Weekend";
    const base = emptyProject("Weekend");
    const doc: ProjectDoc = {
      ...base,
      sources: [
        clip("clip_1"),
        clip("clip_2", { duration: 4 }),
        clip("stock_1", { origin: { url: "https://x", provider: "pexels", license: "", author: "" } }),
        // Pasted into a request, never on the timeline: not footage.
        clip("att_1", { path: `${dir}/media/attachments/ref.mov` }),
        // Dragged in from a temporary folder (kept in attachments too), and cut into the edit: footage.
        clip("att_2", { path: `${dir}/media/attachments/drop.mov`, duration: 3 }),
        clip("song", { kind: "audio" }),
      ],
      scenes: [
        { id: "sc1", source: "clip_2", in: 1, out: 2, note: "", volume: 1 },
        { id: "sc2", source: "stock_1", in: 0, out: 1, note: "", volume: 1 },
        { id: "sc3", source: "att_2", in: 0, out: 1, note: "", volume: 1 },
      ] as ProjectDoc["scenes"],
      cover: { ...base.cover, at: { scene: "sc2", at: 0.5 } },
      music: { ...base.music, source: "song", label: "Song", volume: 0.4 },
      style: "Warm, no zooms.",
    };
    const next = applyOps(doc, footageOps(dir, doc)).doc;
    expect(next.scenes.map((s) => [s.source, s.in, s.out])).toEqual([
      ["clip_1", 0, 12.5],
      ["clip_2", 0, 4],
      ["att_2", 0, 3],
    ]);
    expect(next.cover.at).toBeNull();
    // The song is unchosen, but how music sits in the mix is the user's taste and stays.
    expect(next.music.source).toBeNull();
    expect(next.music.volume).toBe(0.4);
    expect(next.sources).toHaveLength(6);
    expect(next.style).toBe("Warm, no zooms.");
  });

  it("points a copy's own files (attachments, stock) at the copy, and leaves footage elsewhere alone", () => {
    const doc: ProjectDoc = {
      ...emptyProject("A"),
      sources: [clip("cam"), clip("att", { path: "/p/A/media/attachments/x.png" })],
    };
    const next = applyOps(doc, relinkOps(doc, "/p/A", "/p/A copy")).doc;
    expect(next.sources.map((s) => s.path)).toEqual([
      "/footage/cam.mov",
      "/p/A copy/media/attachments/x.png",
    ]);
    // Not fooled by a sibling folder whose name starts the same.
    expect(relinkOps({ sources: [clip("b", { path: "/p/AB/x.mov" })] }, "/p/A", "/p/C")).toEqual([]);
  });

  it("copies a project without its history, old versions or exports", async () => {
    const from = mkdtempSync(path.join(tmpdir(), "vedit-copy-"));
    for (const f of [
      "project.json",
      ".history/log.jsonl",
      "versions/a.json",
      "exports/v.mp4",
      ".cache/proxy/c.mp4",
    ]) {
      mkdirSync(path.dirname(path.join(from, f)), { recursive: true });
      writeFileSync(path.join(from, f), f);
    }
    const to = `${from} copy`;
    await copyProject(from, to);
    expect(readFileSync(path.join(to, "project.json"), "utf8")).toBe("project.json");
    expect(readFileSync(path.join(to, ".cache/proxy/c.mp4"), "utf8")).toBe(".cache/proxy/c.mp4");
    for (const gone of [".history", "versions", "exports"])
      expect(existsSync(path.join(to, gone))).toBe(false);
  });
});
