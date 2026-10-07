import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isProjectFolder,
  makeProjectFolder,
  moveVideo,
  projectName,
  projectOf,
  samePath,
  videosIn,
} from "./folders.ts";

const root = () => mkdtempSync(path.join(tmpdir(), "vedit-folders-"));

function video(parent: string, folder: string, name = folder): string {
  const dir = path.join(parent, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "project.json"), JSON.stringify({ schema: 1, name }));
  return dir;
}

describe("projects: folders of videos", () => {
  it("makes a project folder, named, with a free name when it's taken", async () => {
    const movies = root();
    const a = await makeProjectFolder(movies, "Patek: campaign");
    const b = await makeProjectFolder(movies, "Patek: campaign");
    expect(path.basename(a.dir)).toBe("Patek campaign");
    expect(path.basename(b.dir)).toBe("Patek campaign 2");
    expect(isProjectFolder(a.dir)).toBe(true);
    expect(isProjectFolder(movies)).toBe(false);
    expect(await projectName(a.dir)).toBe("Patek campaign");
  });

  it("lists the videos inside, by their own names, and nothing else", async () => {
    const { dir } = await makeProjectFolder(root(), "Podcast");
    video(dir, "ep1", "Episode one");
    video(dir, "ep2");
    mkdirSync(path.join(dir, "notes"));
    const videos = await videosIn(dir);
    expect(videos.map((v) => v.name).sort()).toEqual(["Episode one", "ep2"]);
  });

  it("keeps videos in the order they were made, whichever was opened last", async () => {
    const { dir } = await makeProjectFolder(root(), "Trips");
    const made = (folder: string, at: string) => {
      const v = path.join(dir, folder);
      mkdirSync(v);
      writeFileSync(path.join(v, "project.json"), JSON.stringify({ schema: 1, name: folder, createdAt: at }));
    };
    made("lisbon", "2026-10-01T10:00:00Z");
    made("porto", "2026-10-03T10:00:00Z");
    const videos = await videosIn(dir);
    expect(videos.find((v) => v.name === "porto")!.createdAt).toBe(Date.parse("2026-10-03T10:00:00Z"));
    expect(videos.find((v) => v.name === "lisbon")!.createdAt).toBe(Date.parse("2026-10-01T10:00:00Z"));
  });

  it("knows which project a video is in, however the path is written", async () => {
    const { dir } = await makeProjectFolder(root(), "Reels");
    const clip = video(dir, "teaser");
    expect(projectOf(clip, [{ dir }])?.dir).toBe(dir);
    expect(projectOf(clip, [{ dir: `${dir}${path.sep}` }])?.dir).toBe(`${dir}${path.sep}`);
    expect(projectOf(path.join(root(), "loose"), [{ dir }])).toBeUndefined();
    expect(samePath(dir, `${dir}${path.sep}`)).toBe(true);
  });

  it("moves a video in and out, keeping its name unless it's taken", async () => {
    const movies = root();
    const { dir } = await makeProjectFolder(movies, "Ads");
    const clip = video(movies, "teaser");
    const inside = await moveVideo(clip, dir);
    expect(inside).toBe(path.join(dir, "teaser"));
    expect(existsSync(clip)).toBe(false);
    // Already there: nothing moves.
    expect(await moveVideo(inside, dir)).toBe(inside);
    // A second "teaser" coming in gets a free name.
    const other = video(movies, "teaser");
    expect(await moveVideo(other, dir)).toBe(path.join(dir, "teaser 2"));
    // And back out.
    expect(await moveVideo(inside, movies)).toBe(path.join(movies, "teaser"));
  });
});
