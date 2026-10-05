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
  return {
    prompts,
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
        status: async () => ({ backend: "subscription" }),
      },
      settings: { get: async () => ({ autoFirstCut: false }), set: async () => {} },
      project: { saveChat: async () => {}, loadChat: async () => [] },
      on: (name: string, fn: (e: unknown) => void) => {
        if (name === "agent") listeners.push(fn);
        return () => {};
      },
    },
  };
});

vi.mock("../lib/host.ts", () => ({ host: fake.host }));
vi.mock("./project.ts", async () => {
  const { create } = await import("zustand");
  return { useProject: create(() => ({ dir: null, doc: null })) };
});

const chat = await import("./chat.ts");
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
