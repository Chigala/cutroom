/**
 * Opening a project never redoes work it already did. A clip interrupted mid-index (the app quit, the
 * project switched) keeps what it finished: its preview copy, and once transcribed, its words, so only
 * describing its shots is left. Describing that fails the same way every time isn't tried on every open.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyOps, emptyProject, type Op, type ProjectDoc } from "@vedit/project";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const calls = { proxy: 0, transcribe: 0, sheets: 0 };
/** What the next steps do: hang until stopped, fail, or go through. */
const mode = { transcribe: "go" as "go" | "hang", sheets: "go" as "go" | "hang" | "fail" | "offline" };

const hang = (signal?: AbortSignal) =>
  new Promise<never>((_, no) => signal?.addEventListener("abort", () => no(new Error("aborted"))));

vi.mock("@vedit/media", async (real) => ({
  ...(await real<typeof import("@vedit/media")>()),
  seeThrough: async () => false,
  makeProxy: async (_in: string, out: string) => {
    calls.proxy++;
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, "preview");
  },
  detectShots: async () => [4],
  detectFace: async () => null,
  pictureProfile: async () => null,
  extractSpeechWav: async (_in: string, out: string) => {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, "");
  },
  detectSilences: async () => [],
  waveformPeaks: async () => Buffer.from([1, 2, 3]),
  measureLoudness: async () => null,
  voiceProfile: async () => null,
  ensureHear: async () => {
    throw new Error("no ear here");
  },
  ensureWhisper: async () => {},
  voiceEnvelope: async () => null,
  wordStress: async () => null,
  transcribeWords: async (_wav: string, _setup: unknown, o: { signal?: AbortSignal }) => {
    calls.transcribe++;
    if (mode.transcribe === "hang") return hang(o.signal);
    return {
      language: "en",
      words: "so this is what we built today".split(" ").map((text, i) => ({ text, start: i, end: i + 0.8 })),
    };
  },
  contactSheets: async (_proxy: string, _segments: unknown, o: { signal?: AbortSignal }) => {
    calls.sheets++;
    if (mode.sheets === "hang") return hang(o.signal);
    if (mode.sheets === "fail") throw new Error("ffmpeg exited with 234: Error initializing output stream");
    if (mode.sheets === "offline") throw new Error("Claude is unreachable: network offline");
    return [];
  },
}));
vi.mock("@vedit/agent", () => ({ defaultBackend: () => "api", describeBatch: vi.fn(async () => []) }));
vi.mock("./claude.ts", () => ({ claudeStatus: async () => ({}) }));
const settings = { describeShots: true, glossary: [] };
vi.mock("./settings.ts", () => ({
  getSettings: async () => settings,
  whisperSetup: () => ({}),
  paths: { hear: () => "/nowhere", cache: () => "/nowhere" },
}));

const { Indexer, passing } = await import("./indexer.ts");

const root = mkdtempSync(path.join(tmpdir(), "vedit-resume-"));
// Retried: on Windows a file stays locked for a moment after the process reading it ends.
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const clip = (id: string, dir: string) => {
  const file = path.join(dir, `${id}.mp4`);
  writeFileSync(file, "footage");
  return {
    id,
    kind: "video" as const,
    label: id,
    path: file,
    duration: 10,
    hdr: false,
    hasAudio: true,
    status: "pending" as const,
    proxy: false,
    speech: false,
    summary: "",
    tags: [],
  };
};

function setup() {
  const dir = mkdtempSync(path.join(root, "p-"));
  let doc: ProjectDoc = { ...emptyProject("t"), sources: [clip("a", dir)] };
  const store = {
    dir,
    get doc() {
      return doc;
    },
    commitAndBroadcast: ({ ops }: { ops: Op[] }) => {
      doc = applyOps(doc, ops).doc;
    },
  };
  const indexer = new Indexer({
    store: () => store as never,
    emitIndex: () => {},
    emitImportDone: () => {},
  });
  return { indexer, doc: () => doc };
}

beforeEach(() => {
  calls.proxy = calls.transcribe = calls.sheets = 0;
  mode.transcribe = "go";
  mode.sheets = "go";
});

describe("opening a project after an interruption", () => {
  it("keeps a transcribed clip's words: only describing its shots is left to do", async () => {
    mode.sheets = "hang";
    const { indexer, doc } = setup();
    indexer.enqueue(["a"]);
    // Transcribed and saved while it's still describing.
    await vi.waitFor(() => expect(doc().transcripts.some((t) => t.id === "a")).toBe(true));
    expect(doc().sources[0]!.status).toBe("ready");
    // The app quits, or the project switches, mid-describe; then the project opens again.
    indexer.reset();
    await indexer.settled();
    mode.sheets = "go";
    indexer.resume();
    await indexer.settled();
    expect(calls.proxy).toBe(1);
    expect(calls.transcribe).toBe(1);
  });

  it("reuses a preview copy made before the interruption", async () => {
    mode.transcribe = "hang";
    const { indexer, doc } = setup();
    indexer.enqueue(["a"]);
    await vi.waitFor(() => expect(calls.transcribe).toBe(1));
    indexer.reset();
    await indexer.settled();
    expect(doc().sources[0]!.status).toBe("indexing");
    mode.transcribe = "go";
    indexer.resume();
    await vi.waitFor(() => expect(doc().sources[0]!.status).toBe("ready"));
    expect(calls.proxy).toBe(1);
  });
});

describe("describing shots that keep failing", () => {
  it("isn't tried again when it fails the same way every time, but is when Claude was unreachable", async () => {
    mode.sheets = "fail";
    const { indexer, doc } = setup();
    indexer.enqueue(["a"]);
    await vi.waitFor(() => expect(doc().sources[0]!.status).toBe("ready"));
    await indexer.settled();
    const after = calls.sheets;
    await indexer.describeMissing();
    expect(calls.sheets).toBe(after + 1);
    // Noted as failing for good: the next open doesn't try.
    await indexer.describeMissing();
    expect(calls.sheets).toBe(after + 1);

    mode.sheets = "offline";
    const other = setup();
    other.indexer.enqueue(["a"]);
    await vi.waitFor(() => expect(other.doc().sources[0]!.status).toBe("ready"));
    await other.indexer.settled();
    const before = calls.sheets;
    await other.indexer.describeMissing();
    await other.indexer.describeMissing();
    expect(calls.sheets).toBe(before + 2);
  });

  it("tells a failure that passes from one that doesn't", () => {
    expect(passing("Claude is unreachable: network offline")).toBe(true);
    expect(passing("Not signed in to Claude")).toBe(true);
    expect(passing("You've hit your Claude usage limit")).toBe(true);
    expect(passing("ffmpeg exited with 234: Error initializing output stream")).toBe(false);
  });
});
