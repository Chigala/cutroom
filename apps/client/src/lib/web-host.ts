/**
 * An in-memory host for running the UI in a plain browser (`pnpm dev:web`). Same contract as the desktop
 * host, minus the disk, the footage pipeline and the agent. It is what makes UI work fast: no Electron
 * restart, just HMR.
 */
import type {
  AgentEvent,
  ChatRecord,
  EditorApi,
  EditorEvents,
  ProjectSnapshot,
  Settings,
} from "@vedit/bridge";
import { type Commit, demoProject, makeCommit, OpError, type ProjectDoc } from "@vedit/project";

type Listeners = { [E in keyof EditorEvents]: Set<(p: EditorEvents[E]) => void> };

const DESKTOP_ONLY = "That needs the desktop app. Start it with pnpm dev.";

export function createWebHost(): EditorApi {
  let doc: ProjectDoc = demoProject();
  let head: string | null = null;
  const commits: Commit[] = [];
  let chat: ChatRecord[] = [];
  let settings: Settings = {
    backend: "auto",
    model: "claude-opus-5-5",
    effort: "medium",
    whisperModel: "large-v3-turbo",
    transcriber: "local",
    groqKey: "",
    // The browser demo has nothing to set up.
    onboarded: true,
    language: "en",
    glossary: [],
    autoFirstCut: true,
    describeShots: true,
    pexelsKey: "",
    pixabayKey: "",
    freesoundKey: "",
    klipyKey: "",
    klipyUser: "",
    kit: "",
    showThinking: true,
    claudePath: "",
    libraryDir: "",
  };
  const listeners = Object.fromEntries(
    [
      "commit",
      "agent",
      "index",
      "importDone",
      "export",
      "versions",
      "claude",
      "menu",
      "library",
      "reload",
      "error",
    ].map((k) => [k, new Set()]),
  ) as unknown as Listeners;
  const emit = <E extends keyof EditorEvents>(e: E, p: EditorEvents[E]) => {
    for (const l of listeners[e]) (l as (p: EditorEvents[E]) => void)(p);
  };
  const snapshot = (): ProjectSnapshot => ({ dir: "(in memory)", doc, head, commits });

  return {
    kind: "web",
    project: {
      restore: async () => snapshot(),
      open: async () => snapshot(),
      create: async () => snapshot(),
      openDemo: async () => {
        doc = demoProject();
        head = null;
        commits.length = 0;
        return snapshot();
      },
      recent: async () => [],
      async commit(req) {
        try {
          const result = makeCommit(doc, head, {
            author: "user",
            ops: req.ops,
            ...(req.message && { message: req.message }),
            ...(req.groups && { groups: req.groups }),
            ...(req.reverts && { reverts: req.reverts }),
          });
          doc = result.doc;
          head = result.commit.id;
          commits.push(result.commit);
          return { ok: true, commit: result.commit };
        } catch (err) {
          if (err instanceof OpError) return { ok: false, error: err.message };
          throw err;
        }
      },
      importFiles: async () => ({ ok: false, error: DESKTOP_ONLY }),
      pickAndImport: async () => ({ ok: false, error: DESKTOP_ONLY }),
      newFromVideos: async () => null,
      attach: async () => ({ ok: false, error: DESKTOP_ONLY }),
      attachData: async () => ({ ok: false, error: DESKTOP_ONLY }),
      reveal: async () => {},
      showFile: async () => {},
      loadChat: async () => chat,
      saveChat: async (records) => {
        chat = records;
      },
    },
    index: { peaks: async () => null, retry: async () => {}, describe: async () => {} },
    agent: {
      async run() {
        const runId = `web-${Date.now()}`;
        const send = (e: AgentEvent) => emit("agent", e);
        setTimeout(() => {
          send({ runId, type: "start", backend: "subscription" });
          send({ runId, type: "error", message: `The agent runs in the desktop app. ${DESKTOP_ONLY}` });
        }, 0);
        return { runId };
      },
      cancel: async () => {},
      status: async () => ({ backend: "subscription", model: settings.model, apiKey: false }),
    },
    downloads: {
      state: async () => [],
      prepare: async () => {},
    },
    library: {
      state: async () => ({ dir: "", projectDir: null, assets: [], roles: {}, pending: 0 }),
      add: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      pickAndAdd: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      reveal: async () => {},
      update: async () => {},
      setRole: async () => {},
      place: async () => ({ ok: false, error: DESKTOP_ONLY }),
      pickDir: async () => {},
      keep: async () => {
        throw new Error(DESKTOP_ONLY);
      },
    },
    app: {
      diagnostics: async () => ({
        version: "web",
        electron: "",
        os: navigator.userAgent,
        logsDir: "",
        problems: [],
      }),
      openLogs: async () => {},
    },
    claude: {
      status: async () => ({ source: "missing", recommended: "", versionState: "ok", signedIn: null }),
      install: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      login: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      update: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      cancel: async () => {},
    },
    kits: {
      list: async () => [],
      save: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      apply: async () => ({ ok: false, error: DESKTOP_ONLY }),
      remove: async () => {},
    },
    exporter: {
      async start() {
        const jobId = `web-${Date.now()}`;
        setTimeout(() => emit("export", { jobId, type: "error", message: DESKTOP_ONLY }), 0);
        return { jobId };
      },
      cancel: async () => {},
    },
    versions: {
      list: async () => [],
      save: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      generate: async () => {
        emit("versions", { type: "error", message: DESKTOP_ONLY });
      },
      doc: async () => null,
      use: async () => ({ ok: false, error: DESKTOP_ONLY }),
      remove: async () => {},
    },
    history: {
      list: async () =>
        commits.toReversed().map((c) => ({ id: c.id, author: c.author, message: c.message, at: c.at })),
      restore: async () => ({ ok: false, error: DESKTOP_ONLY }),
    },
    settings: {
      get: async () => settings,
      set: async (patch) => {
        settings = { ...settings, ...patch };
        return settings;
      },
    },
    pathForFile: () => "",
    on(event, listener) {
      const set = listeners[event] as Set<typeof listener>;
      set.add(listener);
      return () => set.delete(listener);
    },
  };
}
