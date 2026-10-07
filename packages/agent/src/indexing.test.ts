import { emptyProject, type Op, type ProjectDoc } from "@vedit/project";
import { describe, expect, it, vi } from "vitest";

const outputs: string[] = [];
vi.mock("./sdk.ts", () => ({
  // Claude measures the attached clip at once, while it's still being indexed.
  runWithSubscription: vi.fn(async (_run: unknown, ctx: never) => {
    const { runTool } = await import("./tools.ts");
    const out = await runTool("inspiration", { action: "measure", source: "ref" }, ctx);
    outputs.push(out.isError ? `error: ${out.text}` : out.text);
    return "Measured.";
  }),
}));

/** A project whose attached reference clip is still being indexed. */
function attached(): ProjectDoc {
  return {
    ...emptyProject("A"),
    sources: [
      {
        id: "ref",
        kind: "video",
        label: "ref",
        duration: 12,
        hdr: false,
        hasAudio: true,
        status: "indexing",
        proxy: false,
        speech: false,
        summary: "",
        tags: [],
      },
    ],
  };
}

describe("a clip indexed while a request runs", () => {
  it("reaches the request: a tool waiting for it carries on once it's done", async () => {
    const { runAgent } = await import("./agent.ts");
    const listeners = new Set<(ops: readonly Op[]) => void>();
    // Indexing finishes a moment into the request: its shots and the clip's status land in the project.
    const done: Op[] = [
      { op: "insert", coll: "analyses", item: { id: "ref", silences: [], shots: [3, 6.5, 9] } },
      { op: "update", coll: "sources", id: "ref", patch: { status: "ready" } },
    ];
    setTimeout(() => {
      for (const l of listeners) l(done);
    }, 700);
    const result = await runAgent({
      doc: attached(),
      prompt: "Edit it like this reference",
      attachments: ["ref"],
      host: { frame: async () => Buffer.alloc(0) },
      backend: "subscription",
      indexed: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    // The shots indexing found, measured.
    expect(outputs[0]).toMatch(/^ref \(ref\), 12s\.\nCutting: 4 shots/);
    // What indexing wrote isn't the agent's own change: the host already has it.
    expect(result.ops).toEqual([]);
    expect(result.doc.sources[0]!.status).toBe("ready");
    // The request stopped listening when it ended.
    expect(listeners.size).toBe(0);
  }, 20_000);
});
