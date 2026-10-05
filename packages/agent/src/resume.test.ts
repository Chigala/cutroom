import { emptyProject } from "@vedit/project";
import { describe, expect, it, vi } from "vitest";

const prompts: string[] = [];
vi.mock("./sdk.ts", () => ({
  runWithSubscription: vi.fn(
    async (run: { prompt: string }, ctx: { scratch: { ops: unknown[]; groups: unknown[] } }) => {
      prompts.push(run.prompt);
      const { Stalled } = await import("./types.ts");
      if (prompts.length === 1) {
        // Work done before the connection stalls.
        ctx.scratch.ops.push({ op: "merge", key: "look", patch: { vignette: true } });
        ctx.scratch.groups.push({ label: "Cut the retakes", ops: [0] });
        throw new Stalled("Halfway there.");
      }
      return "Finished the edit.";
    },
  ),
}));

describe("a stalled request", () => {
  it("picks up where it stopped, keeping the work so far", async () => {
    const { runAgent } = await import("./agent.ts");
    const steps: string[] = [];
    const result = await runAgent({
      doc: emptyProject("t"),
      prompt: "Make a first cut",
      host: { frame: async () => Buffer.alloc(0) },
      backend: "subscription",
      onStep: (text) => steps.push(text),
    });
    expect(result.summary).toBe("Finished the edit.");
    expect(result.ops).toHaveLength(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("stalled");
    expect(prompts[1]).toContain("Cut the retakes");
    expect(steps).toContain("Claude stalled; picking up where it stopped");
  });
});
