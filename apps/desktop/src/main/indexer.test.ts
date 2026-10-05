import { applyOps, emptyProject, type Op, type ProjectDoc } from "@vedit/project";
import { describe, expect, it, vi } from "vitest";

// Indexing work that runs until it is stopped, recording what started and what was stopped.
const started: string[] = [];
const stopped: string[] = [];
vi.mock("@vedit/media", async (real) => ({
  ...(await real<typeof import("@vedit/media")>()),
  makeProxy: (_in: string, out: string, o: { signal?: AbortSignal }) =>
    new Promise((_, no) => {
      const id = out.split("/").pop()!.replace(".mp4", "");
      started.push(id);
      o.signal?.addEventListener("abort", () => {
        stopped.push(id);
        no(new Error("aborted"));
      });
    }),
}));
vi.mock("@vedit/agent", () => ({ defaultBackend: () => "api", describeBatch: vi.fn() }));
vi.mock("./settings.ts", () => ({ getSettings: async () => ({ describeShots: false }), paths: {} }));

const { Indexer } = await import("./indexer.ts");

const clip = (id: string) => ({
  id,
  kind: "video" as const,
  label: id,
  path: `/footage/${id}.mp4`,
  duration: 10,
  hdr: false,
  hasAudio: true,
  status: "pending" as const,
  proxy: false,
  speech: false,
  summary: "",
  tags: [],
});

function setup(ids: string[]) {
  let doc: ProjectDoc = { ...emptyProject("t"), sources: ids.map(clip) };
  const events: { source: string; label: string }[] = [];
  const done = vi.fn();
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
    emitIndex: (e) => events.push({ source: e.source, label: e.label }),
    emitImportDone: done,
  });
  const remove = (id: string) => {
    doc = applyOps(doc, [{ op: "remove", coll: "sources", id }]).doc;
    indexer.prune(doc);
  };
  return { indexer, events, done, remove, doc: () => doc };
}

describe("indexing a clip that is removed", () => {
  it("stops it mid-way, drops it from the queue, and starts the next", async () => {
    started.length = 0;
    stopped.length = 0;
    const { indexer, events, done, remove } = setup(["a", "b", "c"]);
    indexer.enqueue(["a", "b", "c"], { firstImport: true });
    await vi.waitFor(() => expect(started).toEqual(["a", "b"])); // two at a time; c waits
    remove("c"); // queued: never starts
    remove("a"); // running: stopped
    await vi.waitFor(() => expect(stopped).toEqual(["a"]));
    expect(
      events
        .filter((e) => e.label === "Cancelled")
        .map((e) => e.source)
        .sort(),
    ).toEqual(["a", "c"]);
    // Nothing else starts in their place, and no import-done (b is still going).
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual(["a", "b"]);
    expect(done).not.toHaveBeenCalled();
  });

  it("doesn't announce an import whose clips were all removed (no first cut on nothing)", async () => {
    started.length = 0;
    stopped.length = 0;
    const { indexer, done, remove } = setup(["x"]);
    indexer.enqueue(["x"], { firstImport: true });
    await vi.waitFor(() => expect(started).toEqual(["x"]));
    remove("x");
    await vi.waitFor(() => expect(stopped).toEqual(["x"]));
    expect(done).not.toHaveBeenCalled();
  });
});
