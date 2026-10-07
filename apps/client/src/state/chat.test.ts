import type { AgentEvent } from "@vedit/bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A host whose agent runs are driven by the test: run() answers with an id, events are sent by hand.
const fake = vi.hoisted(() => {
  const listeners: ((e: unknown) => void)[] = [];
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  let n = 0;
  const prompts: string[] = [];
  /** Which project each request was sent for, and each conversation saved into. */
  const runDirs: (string | undefined)[] = [];
  const saved: { dir: string | undefined; records: { kind: string; text?: string }[] }[] = [];
  const discarded: string[] = [];
  /** Requests the app says are still running, for the next load. */
  const running: unknown[] = [];
  return {
    prompts,
    runDirs,
    saved,
    discarded,
    running,
    emit: (e: unknown) => {
      for (const l of listeners) l(e);
    },
    host: {
      agent: {
        run: async (req: { prompt: string; dir?: string }) => {
          prompts.push(req.prompt);
          runDirs.push(req.dir);
          return { runId: `r${++n}` };
        },
        cancel: async () => {},
        discard: async (runId: string) => void discarded.push(runId),
        active: async () => running.splice(0),
        status: async () => ({ backend: "subscription" }),
      },
      settings: { get: async () => ({ autoFirstCut: false }), set: async () => {} },
      project: {
        saveChat: async (records: { kind: string; text?: string }[], dir?: string) =>
          void saved.push({ dir, records }),
        loadChat: async () => [],
        commit: async () => ({ ok: false, error: "not in tests" }),
      },
      on: (name: string, fn: (e: unknown) => void) => {
        if (name === "agent") listeners.push(fn);
        return () => {};
      },
    },
  };
});

vi.mock("../lib/host.ts", () => ({ host: fake.host, setMediaProject: () => {} }));

const chat = await import("./chat.ts");
const project = await import("./project.ts");
const { emptyProject } = await import("@vedit/project");
chat.connectChat();

const flush = () => new Promise((r) => setTimeout(r, 0));
const event = (e: AgentEvent) => fake.emit(e);
const done = (runId: string) => event({ runId, type: "done", commit: null, elapsedMs: 1, summary: "Done." });

beforeEach(() => {
  chat.useChat.setState({ items: [], queue: [], activeRun: null });
  fake.prompts.length = 0;
});

describe("queueing messages", () => {
  it("holds messages sent while busy, and sends them in order as each request finishes", async () => {
    await chat.send("first");
    await chat.send("second");
    await chat.send("third");
    expect(fake.prompts).toEqual(["first"]);
    expect(chat.useChat.getState().queue.map((q) => q.text)).toEqual(["second", "third"]);

    done(chat.useChat.getState().activeRun!);
    await flush();
    await flush();
    expect(fake.prompts).toEqual(["first", "second"]);
    expect(chat.useChat.getState().queue.map((q) => q.text)).toEqual(["third"]);
  });

  it("waits after a stop or an error, until asked to carry on", async () => {
    await chat.send("first");
    await chat.send("second");
    event({ runId: chat.useChat.getState().activeRun!, type: "error", message: "Stopped" });
    await flush();
    expect(fake.prompts).toEqual(["first"]);
    expect(chat.useChat.getState().activeRun).toBeNull();

    chat.sendNextQueued();
    await flush();
    expect(fake.prompts).toEqual(["first", "second"]);
    expect(chat.useChat.getState().queue).toEqual([]);
  });

  it("lets a waiting message be taken back", async () => {
    await chat.send("first");
    await chat.send("second");
    chat.removeQueued(chat.useChat.getState().queue[0]!.id);
    done(chat.useChat.getState().activeRun!);
    await flush();
    expect(fake.prompts).toEqual(["first"]);
  });
});

describe("usage", () => {
  it("keeps Claude's latest context and plan figures, merged, between launches", async () => {
    await chat.send("first");
    const runId = chat.useChat.getState().activeRun!;
    event({ runId, type: "usage", harness: "claude", limits: { fiveHour: { pct: 40 }, plan: "max" } });
    event({ runId, type: "usage", harness: "claude", limits: { weekly: { pct: 12 } } });
    event({ runId, type: "usage", harness: "claude", context: { used: 50_000, window: 200_000 } });
    expect(chat.useChat.getState().usage).toEqual({
      context: { used: 50_000, window: 200_000 },
      limits: { fiveHour: { pct: 40 }, weekly: { pct: 12 }, plan: "max" },
    });
    expect(JSON.parse(localStorage.getItem("cutroom.usage")!)).toEqual(chat.useChat.getState().usage);
  });
});

describe("the live draft", () => {
  const look = () => project.useProject.getState().draft?.doc.look;
  beforeEach(() => {
    project.load({ dir: "/p", doc: emptyProject("test"), head: null, commits: [] } as never);
  });

  it("shows the agent's changes as they come, over the user's own edits, and goes when the work lands", async () => {
    await chat.send("add a vignette");
    const runId = chat.useChat.getState().activeRun!;
    event({
      runId,
      type: "draft",
      label: "Vignette",
      ops: [{ op: "merge", key: "look", patch: { vignette: true } }],
      at: 0,
    });
    expect(look()?.vignette).toBe(true);
    // The project itself is untouched until the work lands.
    expect(project.useProject.getState().doc!.look.vignette).toBe(false);
    // The user edits meanwhile: the draft is rebuilt on top of their edit.
    project.edit([{ op: "merge", key: "look", patch: { vignetteStrength: 0.8 } }]);
    expect(look()).toMatchObject({ vignette: true, vignetteStrength: 0.8 });
    done(runId);
    expect(project.useProject.getState().draft).toBeNull();
  });

  it("holds the work of a stopped request until it's kept or thrown away", async () => {
    await chat.send("add a vignette");
    const runId = chat.useChat.getState().activeRun!;
    event({
      runId,
      type: "draft",
      label: "Vignette",
      ops: [{ op: "merge", key: "look", patch: { vignette: true } }],
      at: 0,
    });
    event({ runId, type: "error", message: "Stopped", kept: 1 });
    expect(project.useProject.getState().draft).toMatchObject({ runId, held: true });
    const run = chat.useChat.getState().items.find((m) => m.kind === "agent" && m.runId === runId);
    expect(run).toMatchObject({ status: "stopped", kept: 1 });
    chat.discardWork(runId);
    expect(project.useProject.getState().draft).toBeNull();
    expect(fake.discarded).toContain(runId);
  });
});

describe("a reload mid-request", () => {
  it("brings back the running request and its whole draft, each change once", async () => {
    chat.useChat.setState({ items: [], queue: [], activeRun: null });
    fake.running.push({
      runId: "r-live",
      dir: "/reloaded",
      prompt: "grade it warm",
      startedAt: Date.now() - 5000,
      ops: [
        { op: "merge", key: "look", patch: { vignette: true } },
        { op: "merge", key: "look", patch: { vignetteStrength: 0.7 } },
      ],
    });
    project.load({ dir: "/reloaded", doc: emptyProject("test"), head: null, commits: [] } as never);
    await flush();
    await flush();
    expect(chat.useChat.getState().activeRun).toBe("r-live");
    const run = chat.useChat.getState().items.find((m) => m.kind === "agent" && m.runId === "r-live");
    expect(run).toMatchObject({ status: "running" });
    expect(project.useProject.getState().draft?.ops).toHaveLength(2);
    // The next change continues the draft; one it already has isn't applied twice.
    event({
      runId: "r-live",
      type: "draft",
      label: "Warm",
      ops: [{ op: "merge", key: "look", patch: {} }],
      at: 2,
    });
    event({
      runId: "r-live",
      type: "draft",
      label: "Warm",
      ops: [{ op: "merge", key: "look", patch: {} }],
      at: 2,
    });
    expect(project.useProject.getState().draft?.ops).toHaveLength(3);
    done("r-live");
    expect(project.useProject.getState().draft).toBeNull();
  });
});

describe("Claude working in the background", () => {
  it("keeps working in a project you leave: its events, reply and queue stay with it", async () => {
    const finished: [string, boolean][] = [];
    const off = chat.onFinishedAway((dir, ok) => void finished.push([dir, ok]));
    project.load({ dir: "/a", doc: emptyProject("A"), head: null, commits: [] } as never);
    await flush();
    await chat.send("make it punchy");
    await chat.send("then shorter");
    const runA = chat.useChat.getState().activeRun!;
    expect(fake.runDirs.at(-1)).toBe("/a");

    // To project B: its own, empty conversation, free for a request of its own.
    project.load({ dir: "/b", doc: emptyProject("B"), head: null, commits: [] } as never);
    await flush();
    expect(chat.useChat.getState().items).toEqual([]);
    expect(chat.useChat.getState().activeRun).toBeNull();
    expect(chat.useWorking.getState().dirs).toEqual(["/a"]);
    await chat.send("add captions");
    expect(fake.runDirs.at(-1)).toBe("/b");
    const runB = chat.useChat.getState().activeRun!;

    // A's request ends while B is on screen: its reply goes to A, saved into A's folder, and it's said.
    fake.saved.length = 0;
    event({ runId: runA, type: "text", delta: "Tightened it." });
    done(runA);
    expect(chat.useChat.getState().items.some((m) => m.kind === "agent" && m.runId === runA)).toBe(false);
    expect(finished).toEqual([["/a", true]]);
    // A's waiting message goes, still to A.
    await flush();
    await flush();
    expect(fake.prompts.at(-1)).toBe("then shorter");
    expect(fake.runDirs.at(-1)).toBe("/a");
    await new Promise((r) => setTimeout(r, 450));
    const intoA = fake.saved.filter((x) => x.dir === "/a");
    expect(intoA.at(-1)?.records.map((r) => r.kind)).toEqual(["user", "agent", "user"]);
    // B saves its own conversation, never A's.
    const intoB = fake.saved.filter((x) => x.dir === "/b").flatMap((x) => x.records);
    expect(intoB.some((r) => r.text === "make it punchy" || r.text === "Tightened it.")).toBe(false);

    // B's own request is untouched, and back in A its conversation is as it is now.
    expect(chat.useChat.getState().activeRun).toBe(runB);
    project.load({ dir: "/a", doc: emptyProject("A"), head: null, commits: [] } as never);
    await flush();
    const items = chat.useChat.getState().items;
    expect(items.filter((m) => m.kind === "user").map((m) => (m as { text: string }).text)).toEqual([
      "make it punchy",
      "then shorter",
    ]);
    expect(items.find((m) => m.kind === "agent" && m.runId === runA)).toMatchObject({ status: "done" });
    expect(chat.useChat.getState().activeRun).not.toBeNull();
    expect(chat.useWorking.getState().dirs).toEqual(expect.arrayContaining(["/a", "/b"]));
    off();
  });

  it("doesn't put a background request's draft on the project on screen", async () => {
    project.load({ dir: "/c", doc: emptyProject("C"), head: null, commits: [] } as never);
    await flush();
    await chat.send("grade it");
    const runC = chat.useChat.getState().activeRun!;
    project.load({ dir: "/d", doc: emptyProject("D"), head: null, commits: [] } as never);
    await flush();
    event({
      runId: runC,
      type: "draft",
      label: "Warm",
      ops: [{ op: "merge", key: "look", patch: {} }],
      at: 0,
    });
    expect(project.useProject.getState().draft).toBeNull();
  });
});
