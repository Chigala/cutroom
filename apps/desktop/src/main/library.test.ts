import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assetId, keepable, kindFromFolder, nameFromFile, searchAssets } from "@vedit/project";
import { describe, expect, it, vi } from "vitest";

const data = mkdtempSync(path.join(tmpdir(), "vedit-lib-data-"));
const libDir = mkdtempSync(path.join(tmpdir(), "vedit-lib-"));
// The tools the app ships (ffmpeg, the sound classifier), as the app finds them.
process.env.VEDIT_TOOLS ??= path.resolve(import.meta.dirname, "../../resources/tools/darwin-arm64");

vi.mock("electron", () => ({ app: { getPath: () => data, isPackaged: false } }));
vi.mock("./settings.ts", () => ({
  getSettings: async () => ({ libraryDir: libDir, describeShots: false, backend: "auto" }),
  paths: { cache: () => path.join(data, "cache"), hear: () => path.join(data, "hear") },
}));
vi.mock("./claude.ts", () => ({ claudeStatus: async () => ({}) }));

const { Library } = await import("./library.ts");

const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

describe("library helpers", () => {
  it("names, ids and kinds from files", () => {
    expect(nameFromFile("Sounds/vine_boom-final.wav")).toBe("vine boom final");
    expect(assetId("Sounds/Vine Boom.wav", "library")).toBe("sounds/vine-boom");
    expect(assetId("Memes/Kai shocked.png", "project")).toBe("project/memes/kai-shocked");
    expect(kindFromFolder("SFX/x.wav")).toBe("sound");
    expect(kindFromFolder("Stickers/x.webm")).toBe("meme");
    expect(kindFromFolder("x.wav")).toBeNull();
    // Songs, sounds, images and short clips can be kept; footage can't.
    expect(keepable({ kind: "audio", duration: 200, path: "/a.mp3" })).toBe(true);
    expect(keepable({ kind: "video", duration: 4, path: "/meme.mp4" })).toBe(true);
    expect(keepable({ kind: "video", duration: 120, path: "/talk.mov" })).toBe(false);
  });
});

describe("library", () => {
  it("catalogues dropped files, keeps what people write, and finds things by role", async () => {
    const lib = new Library(() => {});
    await lib.start();
    // A boom, a minute of music, a see-through sticker.
    const src = mkdtempSync(path.join(tmpdir(), "vedit-lib-src-"));
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=55:duration=1.2", path.join(src, "big boom.wav"));
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=60", path.join(src, "chill bed.mp3"));
    ffmpeg(
      "-f",
      "lavfi",
      "-i",
      "color=c=red@0.0:s=64x64,format=rgba",
      "-frames:v",
      "1",
      path.join(src, "kai.png"),
    );
    expect(
      await lib.add(
        [path.join(src, "big boom.wav"), path.join(src, "chill bed.mp3"), path.join(src, "kai.png")],
        "library",
      ),
    ).toHaveLength(3);

    const { assets } = lib.entries();
    const byFile = Object.fromEntries(assets.map((a) => [a.file, a]));
    expect(byFile["Sounds/big boom.wav"]).toMatchObject({
      kind: "sound",
      name: "big boom",
      id: "sounds/big-boom",
    });
    expect(byFile["Music/chill bed.mp3"]?.kind).toBe("music");
    expect(byFile["Music/chill bed.mp3"]?.duration).toBeCloseTo(60, 0);
    expect(byFile["Memes/kai.png"]).toMatchObject({ kind: "meme", alpha: true });

    // Roles and edits are kept in library.json, and edits survive a rescan.
    await lib.setRole("impact", "sounds/big-boom");
    await lib.update("memes/kai", { name: "Kai shocked", tags: ["kai", "shocked"] });
    const saved = JSON.parse(readFileSync(path.join(libDir, "library.json"), "utf8"));
    expect(saved.roles).toEqual({ impact: "sounds/big-boom" });
    const again = new Library(() => {});
    await again.start();
    const entries = again.entries().assets;
    expect(entries.find((a) => a.id === "memes/kai")).toMatchObject({ name: "Kai shocked", edited: true });
    expect(searchAssets(entries, "impact")[0]?.id).toBe("sounds/big-boom");
    expect(searchAssets(entries, "shocked")[0]?.id).toBe("memes/kai");
    expect(again.resolve("sounds/big-boom")).toBe(path.join(libDir, "Sounds", "big boom.wav"));
    lib.close();
    again.close();
  }, 120_000);
});
