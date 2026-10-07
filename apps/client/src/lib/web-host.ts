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
import {
  type Commit,
  demoProject,
  diffDocs,
  type InspirationInfo,
  inspirationInfo,
  inspirationMeta,
  inspirationOps,
  makeCommit,
  type Op,
  OpError,
  type ProjectDoc,
  packFromProject,
  rewind,
  STARTER_INSPIRATIONS,
  stopInspirationOps,
} from "@vedit/project";

type Listeners = { [E in keyof EditorEvents]: Set<(p: EditorEvents[E]) => void> };

const DESKTOP_ONLY = "That needs the desktop app. Start it with pnpm dev.";

const SAMPLE_PROJECTS =
  import.meta.env.DEV && new URLSearchParams(location.search).has("projects")
    ? [
        "06-finance-creator",
        "05-cinematic-quote",
        "09-commercial-ad",
        "Mr beast",
        "IMG_4222",
        "07-hook-cliffhanger",
        "02-street-interview",
        "01-gym-tour",
        "08-recipe",
      ]
    : null;

/** In development with ?projects: a couple of projects (folders of videos) to work on the sidebar. */
const SAMPLE_FOLDERS = SAMPLE_PROJECTS
  ? [
      { name: "Patek campaign", videos: ["Patek teaser", "Patek reel", "Watch close-ups"] },
      { name: "Podcast clips", videos: ["Episode 12 hook", "Guest story"] },
    ]
  : [];

export function createWebHost(): EditorApi {
  // The sample sidebar's state, so pins and moves can be tried in the browser.
  const pins = new Set<string>();
  const inFolder = new Map<string, string>(
    SAMPLE_FOLDERS.flatMap((f) => f.videos.map((v) => [`(sample) ${v}`, `(folder) ${f.name}`] as const)),
  );
  const sampleVideos = [...(SAMPLE_PROJECTS ?? []), ...SAMPLE_FOLDERS.flatMap((f) => f.videos)].map(
    (name, i) => ({ dir: `(sample) ${name}`, name, openedAt: Date.now() - (i + 1) * 3_600_000 }),
  );
  const folders = SAMPLE_FOLDERS.map((f) => ({ dir: `(folder) ${f.name}`, name: f.name }));
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
    klipyKey: "",
    klipyUser: "",
    starterPack: 0,
    kit: "",
    style: "",
    showThinking: true,
    instantEdits: false,
    claudePath: "",
    libraryDir: "",
  };
  // Every event the host can send: TypeScript insists the list is complete, so a new one can't be missed.
  const events = {
    commit: true,
    agent: true,
    index: true,
    importDone: true,
    export: true,
    thumbnail: true,
    focusProject: true,
    claude: true,
    menu: true,
    library: true,
    downloads: true,
    reload: true,
    error: true,
  } satisfies Record<keyof EditorEvents, true>;
  const listeners = Object.fromEntries(
    Object.keys(events).map((k) => [k, new Set()]),
  ) as unknown as Listeners;
  const emit = <E extends keyof EditorEvents>(e: E, p: EditorEvents[E]) => {
    for (const l of listeners[e]) (l as (p: EditorEvents[E]) => void)(p);
  };
  const snapshot = (): ProjectSnapshot => ({ dir: "(in memory)", doc, head, commits });
  /** A change made here rather than by the renderer: committed, then broadcast like the desktop app does. */
  const local = (message: string, ops: Op[]) => {
    if (!ops.length) return Promise.resolve({ ok: false as const, error: "Nothing to change." });
    try {
      const result = makeCommit(doc, head, {
        author: "user",
        ops,
        message,
        groups: [{ label: message, ops: ops.map((_, i) => i) }],
      });
      doc = result.doc;
      head = result.commit.id;
      commits.push(result.commit);
      emit("commit", { commit: result.commit, head: result.commit.id });
      return Promise.resolve({ ok: true as const, commit: result.commit });
    } catch (err) {
      return Promise.resolve({ ok: false as const, error: (err as Error).message });
    }
  };

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
      // One project here: the demo (in development, ?projects lists a few more, to work on the rail).
      recent: async () =>
        [{ dir: "(in memory)", name: doc.meta.name, openedAt: Date.now() }, ...sampleVideos].map((v) =>
          pins.has(v.dir) ? { ...v, pinned: true } : v,
        ),
      folders: async () =>
        folders.map((f) => ({
          ...f,
          ...(pins.has(f.dir) && { pinned: true }),
          videos: sampleVideos
            .filter((v) => inFolder.get(v.dir) === f.dir)
            .map((v) => (pins.has(v.dir) ? { ...v, pinned: true } : v)),
        })),
      newFolder: async (name) => {
        const folder = { dir: `(folder) ${name}`, name };
        folders.unshift(folder);
        return { ...folder, videos: [] };
      },
      rename: async (dir, name) => {
        const folder = folders.find((f) => f.dir === dir);
        if (folder) folder.name = name;
        const video = sampleVideos.find((v) => v.dir === dir);
        if (video) video.name = name;
        if (dir === "(in memory)") doc = { ...doc, meta: { ...doc.meta, name } };
      },
      pin: async (dir, pinned) => {
        if (pinned) pins.add(dir);
        else pins.delete(dir);
      },
      move: async (dir, folder) => {
        if (folder) inFolder.set(dir, folder);
        else inFolder.delete(dir);
        return { dir, snapshot: null };
      },
      thumbnail: async () => null,
      duplicate: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      trash: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      showProject: async () => {},
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
          // In development, ?reply answers with a made-up reply and a suggested next request, to work on
          // the chat without the desktop app.
          if (import.meta.env.DEV && new URLSearchParams(location.search).has("reply"))
            send({
              runId,
              type: "done",
              commit: null,
              elapsedMs: 1200,
              summary: "Made the hook bigger and moved it up a little.",
              next: "Make the captions a bit bigger",
            });
          else send({ runId, type: "error", message: `The agent runs in the desktop app. ${DESKTOP_ONLY}` });
        }, 0);
        return { runId };
      },
      cancel: async () => {},
      keep: async () => ({ ok: false, error: `The agent runs in the desktop app. ${DESKTOP_ONLY}` }),
      discard: async () => {},
      active: async () => [],
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
    // Built-in inspirations work here (they're pure); the user's own live in the desktop app's library.
    inspirations: {
      list: async () =>
        [
          ...STARTER_INSPIRATIONS.flatMap((p) => {
            const info = inspirationInfo(p.id, p.md, "builtin");
            return info ? [info] : [];
          }),
          ...doc.inspirations.flatMap((i) => {
            const info = STARTER_INSPIRATIONS.some((p) => p.id === i.id)
              ? null
              : inspirationInfo(i.id, i.md, "project");
            return info ? [info] : [];
          }),
        ] satisfies InspirationInfo[],
      read: async (id) =>
        STARTER_INSPIRATIONS.find((p) => p.id === id)?.md ?? packFromProject(doc, id)?.md ?? null,
      apply: async (id, keepLook) => {
        const pack = STARTER_INSPIRATIONS.find((p) => p.id === id) ?? packFromProject(doc, id);
        if (!pack) return { ok: false, error: "That inspiration is gone." };
        return local(
          `Inspiration: ${inspirationMeta(pack.md)?.name ?? id}`,
          inspirationOps(doc, pack, { keepLook }),
        );
      },
      stop: async () => local("Stopped following the inspiration", stopInspirationOps(doc)),
      save: async () => {
        throw new Error(DESKTOP_ONLY);
      },
      remove: async () => {},
      reveal: async () => {},
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
    history: {
      list: async () =>
        commits.toReversed().map((c) => ({ id: c.id, author: c.author, message: c.message, at: c.at })),
      async restore(id) {
        // As on the desktop: rewind to just after that commit, and commit the difference.
        const at = commits.findIndex((c) => c.id === id);
        if (at < 0) return { ok: false, error: "That point is no longer in the history." };
        const past = rewind(doc, commits.slice(at + 1));
        const ops = diffDocs(doc, past, ["sources", "transcripts", "analyses", "meta"]);
        if (!ops.length) return { ok: false, error: "Nothing changed since then." };
        const when = new Date(commits[at]!.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return local(`Restored to ${when}`, ops);
      },
    },
    settings: {
      get: async () => settings,
      set: async (patch) => {
        settings = { ...settings, ...patch };
        return settings;
      },
      checkKey: async () => "offline",
    },
    pathForFile: () => "",
    on(event, listener) {
      const set = listeners[event] as Set<typeof listener>;
      set.add(listener);
      return () => set.delete(listener);
    },
  };
}
