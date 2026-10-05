import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LibraryCatalog } from "@vedit/project";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ starterPack: 0 }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => path.resolve(__dirname, "../..") },
}));
vi.mock("./settings.ts", () => ({
  getSettings: async () => settings,
  setSettings: async (patch: { starterPack: number }) => Object.assign(settings, patch),
}));

const { addStarterPack, starterDir } = await import("./starter-pack.ts");

beforeEach(() => {
  settings.starterPack = 0;
});

describe("the starter pack", () => {
  it("arrives in a new library once: every sound copied, named and tagged, with the credits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cutroom-pack-"));
    const pack = JSON.parse(await readFile(path.join(starterDir(), "pack.json"), "utf8"));
    const catalog = await addStarterPack(dir, LibraryCatalog.parse({}));
    expect(catalog?.assets).toHaveLength(pack.items.length);
    expect(pack.items.length).toBeGreaterThan(90);
    for (const a of catalog!.assets) {
      expect(existsSync(path.join(dir, a.file))).toBe(true);
      expect(a.kind).toBe("sound");
      expect(a.edited).toBe(true);
      expect(a.tags).toContain("starter");
      expect(a.description.length).toBeGreaterThan(10);
    }
    expect(catalog!.assets.find((a) => a.name === "Whoosh 1")?.id).toBe("sounds/starter-pack/whoosh-1");
    expect(await readFile(path.join(dir, "Starter pack credits.txt"), "utf8")).toContain("CC0");
    expect(settings.starterPack).toBe(pack.version);

    // Added once: what was deleted since stays deleted.
    await rm(path.join(dir, "Sounds", "Starter pack", "Whoosh 1.mp3"));
    expect(await addStarterPack(dir, catalog!)).toBeNull();
    expect(existsSync(path.join(dir, "Sounds", "Starter pack", "Whoosh 1.mp3"))).toBe(false);
    await rm(dir, { recursive: true });
  });

  it("never replaces a file that's already there", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cutroom-pack-"));
    await mkdir(path.join(dir, "Sounds", "Starter pack"), { recursive: true });
    await writeFile(path.join(dir, "Sounds", "Starter pack", "Pop 1.mp3"), "mine");
    await addStarterPack(dir, LibraryCatalog.parse({}));
    expect(await readFile(path.join(dir, "Sounds", "Starter pack", "Pop 1.mp3"), "utf8")).toBe("mine");
    await rm(dir, { recursive: true });
  });
});
