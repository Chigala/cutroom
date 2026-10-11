/**
 * A project's cutouts, steadied shots and music separations are made when its edit lands, even when
 * another project is on screen by then, so opening it later doesn't start them; and opening the project
 * already on screen starts nothing again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentResult } from "@vedit/agent";
import { emptyProject } from "@vedit/project";
import { ProjectStore } from "@vedit/project/node";
import { afterAll, describe, expect, it, vi } from "vitest";

const data = mkdtempSync(path.join(tmpdir(), "vedit-bgmedia-"));
afterAll(() => rmSync(data, { recursive: true, force: true }));

const agent = vi.hoisted(() => ({ finish: [] as ((r: Omit<AgentResult, "doc">) => void)[] }));
/** Which project each pass of media work ran for. */
const made = vi.hoisted(() => ({ cutouts: [] as string[] }));

vi.mock("electron", () => ({
  app: {
    getPath: () => data,
    isPackaged: false,
    getVersion: () => "0.0.0",
    whenReady: () => Promise.resolve(),
    on: () => {},
  },
  dialog: {},
  shell: {},
  nativeImage: {},
  Notification: { isSupported: () => false },
}));
vi.mock("./claude.ts", () => ({ claudeStatus: async () => ({ signedIn: true }), claudeTasks: () => ({}) }));
vi.mock("@vedit/agent", async (load) => ({
  ...(await load<typeof import("@vedit/agent")>()),
  runAgent: (opts: { doc: unknown }) =>
    new Promise((resolve) => agent.finish.push((r) => resolve({ ...r, doc: opts.doc }))),
}));
vi.mock("./cutouts.ts", () => ({
  makeNeededCutouts: async (dir: string) => {
    made.cutouts.push(path.basename(dir));
    return [];
  },
}));
vi.mock("./footage.ts", () => ({ makeNeededFootage: async () => [] }));
vi.mock("./stems.ts", () => ({ makeNeededStems: async () => [] }));

const { ProjectService } = await import("./project-service.ts");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function project(name: string): Promise<string> {
  const dir = path.join(data, name);
  await (await ProjectStore.create(dir, emptyProject(name))).close();
  return dir;
}

describe("media work for a project working in the background", () => {
  it("runs when its edit lands, not the next time it's opened", async () => {
    const service = new ProjectService(() => null);
    const a = await project("A");
    const b = await project("B");
    await service.open(a);
    await service.runAgent({ prompt: "blur the background" });
    await wait(50);
    await service.open(b);
    made.cutouts.length = 0;
    // The edit lands in A while B is on screen.
    agent.finish.shift()!({
      ops: [{ op: "merge", key: "look", patch: { vignette: true } }],
      groups: [{ label: "Look", ops: [0] }],
      summary: "Done.",
    });
    await vi.waitFor(() => expect(made.cutouts).toContain("A"), { timeout: 3000 });
    // ...and A, its work recorded, is let go.
    await vi.waitFor(() => expect(service.activeRuns()).toEqual([]));
    await service.close();
  });
});

describe("opening the project already on screen", () => {
  it("starts nothing again", async () => {
    const service = new ProjectService(() => null);
    const c = await project("C");
    await service.open(c);
    const indexer = (service as unknown as { indexer: { resume(): void; reset(): void } }).indexer;
    const resume = vi.spyOn(indexer, "resume");
    const reset = vi.spyOn(indexer, "reset");
    await service.open(c);
    expect(resume).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    await service.close();
  });
});
