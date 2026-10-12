import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyProject } from "@vedit/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexLimits, nearestEffort, runWithCodex } from "./codex.ts";
import { HARNESSES } from "./harness.ts";
import type { Scratch, ToolContext } from "./tools.ts";
import type { BackendRun } from "./types.ts";

const model = {
  model: "gpt-test",
  supportedReasoningEfforts: [
    { reasoningEffort: "low" },
    { reasoningEffort: "medium" },
    { reasoningEffort: "high" },
  ],
  defaultReasoningEffort: "medium",
};

describe("Codex's settings, from Cutroom's", () => {
  it("asks for the nearest effort a model offers", () => {
    expect(nearestEffort("medium", model)).toBe("medium");
    // Max isn't offered: the most it does.
    expect(nearestEffort("max", model)).toBe("high");
    expect(
      nearestEffort("low", { ...model, supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }),
    ).toBe("medium");
  });

  it("reads the plan's limits as the 5-hour and weekly windows", () => {
    expect(
      codexLimits({
        primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: null },
        planType: "plus",
      }),
    ).toEqual({
      fiveHour: { pct: 40, resetsAt: 1_800_000_000_000 },
      weekly: { pct: 10 },
      plan: "plus",
    });
    expect(codexLimits({ primary: null, secondary: null })).toBeUndefined();
  });

  it("is one of the agents", () => {
    expect(HARNESSES.codex.name).toBe("Codex");
    expect(HARNESSES.claude.name).toBe("Claude");
  });
});

function fakeCodex(mode?: string) {
  process.env.VEDIT_CODEX_BIN = process.execPath;
  process.env.VEDIT_CODEX_PREFIX = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "fake-codex.mjs",
  );
  process.env.VEDIT_CODEX_HOME = mkdtempSync(path.join(tmpdir(), "vedit-codex-home-"));
  if (mode) process.env.FAKE_CODEX_MODE = mode;
  else delete process.env.FAKE_CODEX_MODE;
}

const quiet = (over: Partial<BackendRun> = {}): BackendRun => ({
  prompt: "Trim it",
  model: "",
  effort: "medium",
  maxTurns: 10,
  thinking: "summarized",
  onText: () => {},
  onThinking: () => {},
  onActivity: () => {},
  ...over,
});

const context = (): ToolContext => ({
  scratch: { doc: emptyProject("Test"), ops: [], groups: [] },
  host: { frame: async () => Buffer.from([0xff, 0xd8]) },
  step: () => {},
});

describe("a request on Codex", () => {
  afterEach(() => {
    delete process.env.FAKE_CODEX_MODE;
  });

  it("fails, not hangs, when Codex dies mid-turn", async () => {
    fakeCodex("crash");
    await expect(runWithCodex(quiet(), context())).rejects.toThrow(/Codex/);
  });

  it("ends when stopped, even if Codex never answers the stop", async () => {
    fakeCodex("hang");
    const stop = new AbortController();
    let started!: () => void;
    const turn = new Promise<void>((r) => {
      started = r;
    });
    // The plan's limits are read once the turn is under way.
    const running = runWithCodex(quiet({ signal: stop.signal, onUsage: () => started() }), context()).catch(
      (err: Error) => err,
    );
    await turn;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      stop.abort();
      await vi.advanceTimersByTimeAsync(11_000);
      expect(((await running) as Error).message).toBe("Stopped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a reply that came whole, not streamed", async () => {
    fakeCodex("whole");
    const texts: string[] = [];
    const reply = await runWithCodex(
      quiet({ onText: (d, turn) => texts.push(`${turn ? "|" : ""}${d}`) }),
      context(),
    );
    expect(reply).toBe("All done.");
    expect(texts).toEqual(["|All done."]);
  });

  it("sends the agent back for another turn when the review finds something, then finishes", async () => {
    fakeCodex("whole");
    let reviews = 0;
    const reply = await runWithCodex(
      quiet({ review: async () => (++reviews === 1 ? "Fix the flicker at 2s." : null) }),
      context(),
    );
    // Asked after the first turn (sent back) and after the second (done).
    expect(reviews).toBe(2);
    expect(reply).toBe("All done.");
  });

  it("runs locked down with Cutroom's tools, answers a tool call, and streams the reply", async () => {
    process.env.VEDIT_CODEX_BIN = process.execPath;
    process.env.VEDIT_CODEX_PREFIX = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "fake-codex.mjs",
    );
    process.env.VEDIT_CODEX_HOME = mkdtempSync(path.join(tmpdir(), "vedit-codex-home-"));
    const scratch: Scratch = { doc: emptyProject("Test"), ops: [], groups: [] };
    const ctx: ToolContext = {
      scratch,
      host: { frame: async () => Buffer.from([0xff, 0xd8]) },
      step: () => {},
    };
    const texts: string[] = [];
    const usage: unknown[] = [];
    const reply = await runWithCodex(
      {
        prompt: "Make it pop",
        images: [{ data: "AAAA", mediaType: "image/jpeg" }],
        model: "",
        effort: "max",
        maxTurns: 10,
        thinking: "summarized",
        onText: (d, turn) => texts.push(`${turn ? "|" : ""}${d}`),
        onThinking: () => {},
        onActivity: () => {},
        onUsage: (u) => usage.push(u),
      },
      ctx,
    );
    const report = JSON.parse(reply.slice(reply.indexOf("{")));
    expect(report).toEqual({
      locked: true,
      tools: expect.any(Number),
      prompt: true,
      effort: "medium",
      model: "gpt-test",
      image: true,
      toolText: true,
      success: true,
    });
    expect(report.tools).toBeGreaterThan(30);
    // Each message starts its narration afresh.
    expect(texts.slice(0, 2)).toEqual(["|Looking ", "at it."]);
    expect(usage).toContainEqual({ context: { used: 5000, window: 400000 } });
  });
});
