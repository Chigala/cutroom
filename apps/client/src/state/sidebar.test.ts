import type { ProjectFolder, RecentProject } from "@vedit/bridge";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/host.ts", () => ({ host: {}, setMediaProject: () => {} }));

const { railOrder, sections } = await import("./projects.ts");
const { sentRequests } = await import("./chat.ts");

const video = (name: string, extra: Partial<RecentProject> = {}): RecentProject => ({
  dir: `/Movies/${name}`,
  name,
  openedAt: 0,
  ...extra,
});

describe("the sidebar's sections", () => {
  const teaser = video("Patek/teaser");
  const reel = video("Patek/reel", { pinned: true });
  const loose = video("IMG_9170");
  const folders: ProjectFolder[] = [{ dir: "/Movies/Patek", name: "Patek", videos: [teaser, reel] }];

  it("puts pinned videos first, each project's videos under it, and the rest in Videos", () => {
    const s = sections([loose, teaser, reel], folders);
    expect(s.pinned.videos.map((v) => v.name)).toEqual(["Patek/reel"]);
    expect(s.folders[0]!.videos.map((v) => v.name)).toEqual(["Patek/teaser"]);
    expect(s.loose.map((v) => v.name)).toEqual(["IMG_9170"]);
  });

  it("shows a project's video never opened here, and a pinned project in Pinned", () => {
    const synced = video("Patek/from another computer");
    const s = sections([loose], [{ ...folders[0]!, pinned: true, videos: [synced] }]);
    expect(s.pinned.folders.map((f) => f.name)).toEqual(["Patek"]);
    expect(s.folders).toEqual([]);
    expect(s.loose).toEqual([loose]);
  });

  it("numbers ⌘1–9 in the order shown, skipping folded projects", () => {
    expect(railOrder([loose, teaser, reel], folders, []).map((v) => v.name)).toEqual([
      "Patek/reel",
      "Patek/teaser",
      "IMG_9170",
    ]);
    expect(railOrder([loose, teaser, reel], folders, ["/Movies/Patek"]).map((v) => v.name)).toEqual([
      "Patek/reel",
      "IMG_9170",
    ]);
  });
});

describe("↑ in the chat box", () => {
  it("goes back through what was asked, newest first, each once in a row", () => {
    const items = [
      { kind: "user", text: "cut the intro" },
      { kind: "agent" },
      { kind: "user", text: "make the hook bigger" },
      { kind: "user", text: "make the hook bigger" },
      { kind: "note" },
    ];
    expect(sentRequests(items)).toEqual(["make the hook bigger", "cut the intro"]);
  });
});
