/**
 * The project's history, as restore points: every request and every edit is a commit in the log, and
 * restoring one rewinds the log to it, diffs, and commits the difference (so a restore is undoable too).
 */
import type { CommitResult, HistoryEntry } from "@vedit/bridge";
import { diffDocs, type ProjectDoc, rewind } from "@vedit/project";
import { type ProjectStore, readLog } from "@vedit/project/node";

/** Everything except the footage itself: restoring never un-imports or re-indexes clips. */
const EDIT_ONLY = ["sources", "transcripts", "analyses", "meta"] as const;

export class History {
  constructor(private readonly store: () => ProjectStore | null) {}

  async list(): Promise<HistoryEntry[]> {
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
