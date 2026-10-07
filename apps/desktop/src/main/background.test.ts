import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentResult } from "@vedit/agent";
import type { AgentEvent, ProjectSnapshot } from "@vedit/bridge";
import { emptyProject } from "@vedit/project";
import { ProjectStore } from "@vedit/project/node";
import { afterAll, describe, expect, it, vi } from "vitest";

const data = mkdtempSync(path.join(tmpdir(), "vedit-bg-"));
afterAll(() => rmSync(data, { recursive: true, force: true }));

// Claude, driven by the test: each request waits until the test finishes it.
const agent = vi.hoisted(() => ({
  finish: [] as ((r: Omit<AgentResult, "doc">) => void)[],
}));

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

const { ProjectService } = await import("./project-service.ts");

const flush = () => new Promise((r) => setTimeout(r, 50));
const vignette = {
  ops: [{ op: "merge" as const, key: "look" as const, patch: { vignette: true } }],
  groups: [{ label: "Vignette", ops: [0] }],
  summary: "Added a vignette.",
};

async function project(name: string): Promise<string> {
  const dir = path.join(data, name);
  await (await ProjectStore.create(dir, emptyProject(name))).close();
  return dir;
}

describe("Claude working in the background", () => {
  it("finishes a request in a project you left, there and only there, then lets it go", async () => {
    const service = new ProjectService(() => null);
    const commits: string[] = [];
    const agentEvents: AgentEvent[] = [];
    service.on("commit", ({ commit }) => void commits.push(commit.message));
    service.on("agent", (e) => void agentEvents.push(e));
    const a = await project("A");
    const b = await project("B");

    await service.open(a);
    const { runId } = await service.runAgent({ prompt: "add a vignette" });
    await flush();
    // To B while Claude works in A: B is on screen, A carries on.
    const shown = (await service.open(b)) as ProjectSnapshot;
    expect(shown.doc.meta.name).toBe("B");
    expect(service.activeRuns().map((r) => r.dir)).toEqual([a]);

    commits.length = 0;
    agent.finish.shift()!(vignette);
    await flush();
    // Its change landed in A (on disk), not in B, and the window (showing B) wasn't sent it.
    expect(agentEvents.find((e) => e.runId === runId && e.type === "done")).toBeTruthy();
    expect(commits).toEqual([]);
    expect(service.currentDoc()?.look.vignette).not.toBe(true);
    expect(JSON.parse(readFileSync(path.join(a, "look.json"), "utf8")).vignette).toBe(true);
    expect(service.activeRuns()).toEqual([]);

    // Back in A: the change is there, in its history too.
    const back = (await service.open(a)) as ProjectSnapshot;
    expect(back.doc.look.vignette).toBe(true);
    expect(back.commits.some((c) => c.message === "Added a vignette.")).toBe(true);
    await service.close();
  });

  it("sends a waiting message to its own project while another is on screen", async () => {
    const service = new ProjectService(() => null);
    const c = await project("C");
    const d = await project("D");
    await service.open(c);
    await service.open(d);
    // The request after one that ended in C (now closed): C opens in the background for it.
    await service.runAgent({ prompt: "and a vignette", dir: c });
    await flush();
    expect(service.activeRuns().map((r) => r.dir)).toEqual([c]);
    agent.finish.shift()!(vignette);
    await flush();
    expect(JSON.parse(readFileSync(path.join(c, "look.json"), "utf8")).vignette).toBe(true);
    expect(service.currentDoc()?.meta.name).toBe("D");
    await service.close();
  });
});
