import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Design } from "@vedit/project";
import { afterAll, describe, expect, it } from "vitest";
import { recentDesigns, recordDesign } from "./designs.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-designs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = path.join(dir, "designs.json");
const design = (idea: string) => Design.parse({ idea, display: "Inter Tight", palette: ["#e8743b"] });

describe("recent designs", () => {
  it("keeps one per project, newest first, and leaves out the project asking", async () => {
    await Promise.all([
      recordDesign(file, "/p/soup", "Soup", design("Warm kitchen")),
      recordDesign(file, "/p/markets", "Markets", design("Cold ticker")),
    ]);
    await recordDesign(file, "/p/soup", "Soup", design("Warmer kitchen"));
    const others = await recentDesigns(file, "/p/markets");
    expect(others.map((d) => d.design.idea)).toEqual(["Warmer kitchen"]);
    expect((await recentDesigns(file, "/elsewhere")).map((d) => d.name)).toEqual(["Soup", "Markets"]);
  });

  it("skips a design that was never set", async () => {
    await recordDesign(file, "/p/blank", "Blank", Design.parse({}));
    expect((await recentDesigns(file, "/x")).some((d) => d.name === "Blank")).toBe(false);
  });
});
