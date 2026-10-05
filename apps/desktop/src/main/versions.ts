/**
 * Versions are whole alternatives of the edit, saved as files in the project's versions/ folder.
 * "Make 3 versions" runs the agent three times in parallel, each pushed in a different direction, on
 * copies of the current edit; using one is a single undoable commit. History restore works the same
 * way: rewind the log to a point, diff, commit.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentHost } from "@vedit/agent";
import { runAgent } from "@vedit/agent";
import type { CommitResult, HistoryEntry, VersionEvent, VersionInfo } from "@vedit/bridge";
import {
  diffDocs,
  newId,
  type ProjectDoc,
  ProjectDocSchema,
  rewind,
  timelineOf,
  VERSIONS_DIR,
} from "@vedit/project";
import { type ProjectStore, readLog } from "@vedit/project/node";
import { z } from "zod";
import type { AgentSettings } from "./project-service.ts";

const VersionFile = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string().default(""),
  createdAt: z.number(),
  doc: ProjectDocSchema,
});
type VersionFile = z.infer<typeof VersionFile>;

/** Everything except the footage itself: switching versions never un-imports or re-indexes clips. */
const EDIT_ONLY = ["sources", "transcripts", "analyses", "meta"] as const;

const DIRECTIONS = [
  {
    name: "Fast and punchy",
    brief: "Fast and punchy: tight cuts, quick zooms on every punchline, high energy.",
  },
  {
    name: "Story first",
    brief: "Story first: let it breathe, clear beginning-middle-end, keep the most human moments.",
  },
  {
    name: "Music-led",
    brief: "Music-led: cut to the rhythm, find music if there is none, let the beat carry the edit.",
  },
  {
    name: "Short",
    brief: "As short as possible without losing the point: under 30 seconds if the content allows.",
  },
];

export class Versions {
  constructor(
    private readonly store: () => ProjectStore | null,
    private readonly emit: (e: VersionEvent) => void,
    private readonly agent: () => Promise<AgentSettings & { host: AgentHost }>,
  ) {}

  private dir(): string {
    const store = this.store();
    if (!store) throw new Error("no project is open");
    return path.join(store.dir, VERSIONS_DIR);
  }

  private async read(id: string): Promise<VersionFile | null> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    try {
      return VersionFile.parse(JSON.parse(await readFile(path.join(this.dir(), `${id}.json`), "utf8")));
    } catch {
      return null;
    }
  }

  private async write(name: string, note: string, doc: ProjectDoc): Promise<VersionInfo> {
    const file: VersionFile = { id: newId("v"), name, note, createdAt: Date.now(), doc };
    await mkdir(this.dir(), { recursive: true });
    await writeFile(path.join(this.dir(), `${file.id}.json`), JSON.stringify(file));
    this.emit({ type: "changed" });
    return info(file);
  }

  async list(): Promise<VersionInfo[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.dir())).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
    const files = await Promise.all(names.map((n) => this.read(n.slice(0, -5))));
    return files
      .filter((f): f is VersionFile => f !== null)
      .map(info)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  save(name: unknown): Promise<VersionInfo> {
    const store = this.store();
    if (!store) throw new Error("no project is open");
    const label =
      typeof name === "string" && name.trim()
        ? name.trim().slice(0, 80)
        : `Saved ${new Date().toLocaleString()}`;
    return this.write(label, "", store.doc);
  }

  async doc(id: unknown): Promise<ProjectDoc | null> {
    return typeof id === "string" ? ((await this.read(id))?.doc ?? null) : null;
  }

  async use(id: unknown): Promise<CommitResult> {
    const store = this.store();
    const version = typeof id === "string" ? await this.read(id) : null;
    if (!store || !version) return { ok: false, error: "That version no longer exists." };
    const ops = diffDocs(store.doc, version.doc, EDIT_ONLY);
    if (!ops.length) return { ok: false, error: "That version is the same as the current edit." };
    const commit = store.commitAndBroadcast({
      author: "user",
      message: `Switched to ${version.name}`,
      ops,
      groups: [{ label: `Switched to ${version.name}`, ops: ops.map((_, i) => i) }],
    });
    return { ok: true, commit };
  }

  async remove(id: unknown): Promise<void> {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) return;
    await rm(path.join(this.dir(), `${id}.json`), { force: true });
    this.emit({ type: "changed" });
  }

  /** Runs the agent `count` times in parallel, each in its own direction, and saves every result. */
  async generate(prompt: unknown, count: unknown): Promise<void> {
    const store = this.store();
    if (!store) throw new Error("no project is open");
    const n = Math.max(1, Math.min(DIRECTIONS.length, Number(count) || 3));
    const ask = typeof prompt === "string" && prompt.trim() ? prompt.trim() : "Make a version of this edit.";
    const base = store.doc;
    const settings = await this.agent();
    let done = 0;
    this.emit({ type: "generating", total: n, done, label: "Starting" });
    const results = await Promise.allSettled(
      DIRECTIONS.slice(0, n).map(async (dir, i) => {
        const letter = String.fromCharCode(65 + i);
        const result = await runAgent({
          doc: base,
          prompt: `${ask}\n\nDirection for this version: ${dir.brief}`,
          host: settings.host,
          backend: settings.backend,
          model: settings.model,
          effort: settings.effort,
        });
        done++;
        this.emit({ type: "generating", total: n, done, label: `${letter} · ${dir.name} ready` });
        return this.write(`${letter} · ${dir.name}`, result.summary, result.doc);
      }),
    );
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.id] : []));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (!ok.length && failed) this.emit({ type: "error", message: (failed.reason as Error).message });
    else this.emit({ type: "generated", ids: ok });
  }

  async history(): Promise<HistoryEntry[]> {
    const store = this.store();
    if (!store) return [];
    const log = await readLog(store.dir);
    return log
      .filter((c) => c.author !== "index")
      .slice(-300)
      .reverse()
      .map((c) => ({
        id: c.id,
        author: c.author,
        message: c.message,
        at: c.at,
        ...(c.groups?.length && { changes: c.groups.map((g) => g.label) }),
      }));
  }

  async restore(commitId: unknown): Promise<CommitResult> {
    const store = this.store();
    if (!store || typeof commitId !== "string") return { ok: false, error: "No project is open." };
    await store.flush();
    const log = await readLog(store.dir);
    const at = log.findIndex((c) => c.id === commitId);
    if (at < 0) return { ok: false, error: "That point is no longer in the history." };
    let past: ProjectDoc;
    try {
      past = rewind(store.doc, log.slice(at + 1));
    } catch {
      return {
        ok: false,
        error: "The history was edited outside the app, so that point can't be restored exactly.",
      };
    }
    const ops = diffDocs(store.doc, past, EDIT_ONLY);
    if (!ops.length) return { ok: false, error: "Nothing changed since then." };
    const when = new Date(log[at]!.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const commit = store.commitAndBroadcast({
      author: "user",
      message: `Restored to ${when}`,
      ops,
      groups: [{ label: `Restored to ${when}`, ops: ops.map((_, i) => i) }],
    });
    return { ok: true, commit };
  }
}

function info(f: VersionFile): VersionInfo {
  const tl = timelineOf(f.doc);
  return {
    id: f.id,
    name: f.name,
    note: f.note,
    createdAt: f.createdAt,
    duration: tl.duration,
    scenes: tl.scenes.length,
  };
}
