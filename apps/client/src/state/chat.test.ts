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
  const discarded: string[] = [];
  /** Requests the app says are still running, for the next load. */
  const running: unknown[] = [];
  return {
    prompts,
    discarded,
    running,
    emit: (e: unknown) => {
      for (const l of listeners) l(e);
    },
    host: {
      agent: {
        run: async (req: { prompt: string }) => {
          prompts.push(req.prompt);
          return { runId: `r${++n}` };
        },
        cancel: async () => {},
        discard: async (runId: string) => void discarded.push(runId),
        active: async () => running.splice(0),
        status: async () => ({ backend: "subscription" }),
      },
      settings: { get: async () => ({ autoFirstCut: false }), set: async () => {} },
      project: {
        saveChat: async () => {},
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
    event({ runId, type: "usage", limits: { fiveHour: { pct: 40 }, plan: "max" } });
    event({ runId, type: "usage", limits: { weekly: { pct: 12 } } });
    event({ runId, type: "usage", context: { used: 50_000, window: 200_000 } });
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
