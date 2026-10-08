import { fileURLToPath } from "node:url";
import { applyOps, emptyProject, type Op, type ProjectDoc } from "@vedit/project";
import { describe, expect, it, vi } from "vitest";

// Contact sheets that take until they're stopped the first time, and come back at once after that.
let sheetCalls = 0;
vi.mock("@vedit/media", async (real) => ({
  ...(await real<typeof import("@vedit/media")>()),
  contactSheets: (_video: string, _segments: unknown[], o: { signal?: AbortSignal }) => {
    sheetCalls++;
    if (sheetCalls > 1) return Promise.resolve([Buffer.from("sheet")]);
    return new Promise((_, no) => o.signal?.addEventListener("abort", () => no(new Error("aborted"))));
  },
}));
vi.mock("@vedit/agent", () => ({
  defaultBackend: () => "subscription",
  describeBatch: vi.fn(async (batch: { segments: unknown[] }) =>
    batch.segments.map((_, i) => ({
      n: i + 1,
      what: "a kitchen",
      shot: "medium",
      camera: "static",
      energy: 3,
    })),
  ),
}));
vi.mock("./settings.ts", () => ({ getSettings: async () => ({ describeShots: true }), paths: {} }));
vi.mock("./claude.ts", () => ({ claudeStatus: async () => ({ signedIn: true }) }));

const { Indexer } = await import("./indexer.ts");

/** A project with one indexed clip that hasn't been described (the file is this test, so it exists). */
function setup() {
  let doc: ProjectDoc = {
    ...emptyProject("t"),
    sources: [
      {
        id: "a",
        kind: "video",
        label: "a",
        path: fileURLToPath(import.meta.url),
        duration: 4,
        hdr: false,
        hasAudio: true,
        status: "ready",
        proxy: false,
        speech: true,
        summary: "",
        tags: [],
      },
    ],
    analyses: [{ id: "a", silences: [], shots: [2] }],
  };
  const events: { source: string; stage: string }[] = [];
  const store = {
    dir: "/project",
    get doc() {
      return doc;
    },
    commitAndBroadcast: ({ ops }: { ops: Op[] }) => {
      doc = applyOps(doc, ops).doc;
    },
  };
  const indexer = new Indexer({
    store: () => store as never,
    emitIndex: (e) => events.push({ source: e.source, stage: e.stage }),
    emitImportDone: () => {},
  });
  return { indexer, events, doc: () => doc };
}

describe("describing the shots", () => {
  it("starts again after a reset, and its badge always comes down", async () => {
    const { indexer, events, doc } = setup();
    // The project opens twice at once (the window's startup running twice): describing starts...
    void indexer.describeMissing();
    await vi.waitFor(() => expect(sheetCalls).toBe(1));
    expect(events.at(-1)).toEqual({ source: "a", stage: "describe" });
    // ...the second open stops it (its badge comes down) and asks again: a new run, not the stopped one.
    indexer.reset();
    expect(events.at(-1)).toEqual({ source: "a", stage: "ready" });
    await indexer.describeMissing();
    expect(sheetCalls).toBe(2);
    expect(doc().shotLogs.find((l) => l.id === "a")?.segments.length).toBeGreaterThan(0);
    // Nothing is left saying it's describing.
    const last = new Map(events.map((e) => [e.source, e.stage]));
    expect(last.get("a")).toBe("ready");
  });
});
