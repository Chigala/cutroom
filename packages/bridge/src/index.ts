/**
 * The contract between the UI and whatever hosts the project. Today the host is Electron's main process
 * (projects are real folders on disk, footage is processed locally). Tomorrow it can be a cloud service
 * for the web and phone apps, and the UI won't change: it only ever talks to `EditorApi`.
 *
 * Invoke payloads are validated with zod on the host side, since the renderer is untrusted.
 */
import type { AssetEntry, ChangeGroup, Commit, KitInfo, Op, ProjectDoc } from "@vedit/project";
import { OpSchema } from "@vedit/project";
import { z } from "zod";

export interface ProjectSnapshot {
  readonly dir: string;
  readonly doc: ProjectDoc;
  readonly head: string | null;
  /** Recent commits, oldest first, so chips survive a reload. */
  readonly commits: readonly Commit[];
}

export interface RecentProject {
  readonly dir: string;
  readonly name: string;
  readonly openedAt: number;
}

export type CommitResult = { ok: true; commit: Commit } | { ok: false; error: string };

/** What the agent is told about the user's focus when they send a message. */
export const AgentContext = z.object({
  time: z.number().nonnegative().optional().describe("Playhead, in seconds"),
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  scenes: z.array(z.string()).max(50).optional(),
  comments: z.array(z.string()).max(50).optional(),
  words: z.array(z.string()).max(500).optional().describe('Selected words, "<clip id>:<word index>"'),
  range: z
    .object({ start: z.number().nonnegative(), end: z.number().nonnegative() })
    .optional()
    .describe("A stretch of the video selected on the timeline, in seconds"),
});
export type AgentContext = z.infer<typeof AgentContext>;

export const AgentRequest = z.object({
  prompt: z.string().min(1).max(8000),
  context: AgentContext.default({}),
  /** Earlier requests and replies in this project, for follow-ups. */
  history: z
    .array(z.object({ user: z.string().max(8000), agent: z.string().max(8000) }))
    .max(20)
    .default([]),
  /** A first cut after import deserves more thought than a tweak. */
  depth: z.enum(["quick", "thorough"]).default("quick"),
  /** Media the user attached to this request (from attach/attachData): what they mean by "this". */
  attachments: z
    .array(z.object({ source: z.string().max(64) }))
    .max(10)
    .default([]),
});
export type AgentRequest = z.input<typeof AgentRequest>;

export type AttachResult =
  | { readonly ok: true; readonly sources: string[] }
  | { readonly ok: false; readonly error: string };

export type AgentEvent =
  | { readonly runId: string; readonly type: "start"; readonly backend: Backend }
  /** One line of visible progress: "Cut 4 retakes", "+3 zooms". */
  | { readonly runId: string; readonly type: "step"; readonly text: string; readonly status: "done" | "warn" }
  /** `turn`: the first text of a new turn, replacing the last turn's narration (which is done). */
  | { readonly runId: string; readonly type: "text"; readonly delta: string; readonly turn?: boolean }
  /** Its thinking, summarized, as it streams. `block`: the start of a new stretch of thinking. */
  | { readonly runId: string; readonly type: "thinking"; readonly delta: string; readonly block?: boolean }
  /** What it's doing right now (thinking, which tool, a retry): replaced by the next one. */
  | { readonly runId: string; readonly type: "activity"; readonly text: string }
  /** A tool call: sent when it starts (running) and again when it ends, with what it returned. */
  | ({ readonly runId: string; readonly type: "tool" } & ToolCall)
  | {
      readonly runId: string;
      readonly type: "done";
      readonly commit: Commit | null;
      readonly elapsedMs: number;
      readonly summary: string;
      /** What the editor might ask for next, in their words: offered in the composer (Tab takes it). */
      readonly next?: string;
    }
  | { readonly runId: string; readonly type: "error"; readonly message: string };

export type Backend = "api" | "subscription";

export interface CommitRequest {
  readonly ops: readonly Op[];
  readonly message?: string;
  readonly groups?: readonly ChangeGroup[];
  readonly reverts?: { readonly commit: string; readonly group?: number };
  /** The renderer's head when it made the change; lets the host detect drift. */
  readonly parent: string | null;
}

export const CommitRequestSchema = z.object({
  ops: z.array(OpSchema).max(5000),
  message: z.string().max(500).optional(),
  groups: z
    .array(z.object({ label: z.string().max(120), ops: z.array(z.number().int().nonnegative()) }))
    .optional(),
  reverts: z.object({ commit: z.string(), group: z.number().int().nonnegative().optional() }).optional(),
  parent: z.string().nullable(),
});

/** Indexing progress for one clip. */
export interface IndexEvent {
  readonly source: string;
  readonly stage:
    | "queued"
    | "setup"
    | "preview"
    | "audio"
    | "transcribe"
    | "analyze"
    | "describe"
    | "ready"
    | "failed";
  /** 0..1 for this clip. */
  readonly fraction: number;
  readonly label: string;
  readonly error?: string;
}

/** Fired when every clip from one import has been indexed. */
export interface ImportDoneEvent {
  readonly sources: readonly string[];
  /** The project was empty before this import: the moment for an automatic first cut. */
  readonly firstImport: boolean;
}

export type ExportEvent =
  | {
      readonly jobId: string;
      readonly type: "progress";
      readonly stage: string;
      readonly label: string;
      readonly fraction: number;
    }
  | { readonly jobId: string; readonly type: "done"; readonly file: string; readonly elapsedMs: number }
  | { readonly jobId: string; readonly type: "error"; readonly message: string };

export interface VersionInfo {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly createdAt: number;
  readonly duration: number;
  readonly scenes: number;
}

export type VersionEvent =
  | { readonly type: "changed" }
  | { readonly type: "generating"; readonly total: number; readonly done: number; readonly label: string }
  | { readonly type: "generated"; readonly ids: readonly string[] }
  | { readonly type: "error"; readonly message: string };

export interface HistoryEntry {
  readonly id: string;
  readonly author: Commit["author"];
  readonly message: string;
  readonly at: number;
  /** The change's parts, as named in the chat ("Silk caption look"): a short title for it. */
  readonly changes?: readonly string[];
}

export const Settings = z.object({
  /** "auto" uses the API key when there is one, otherwise the Claude subscription. */
  backend: z.enum(["auto", "api", "subscription"]).default("auto"),
  model: z.string().min(1).max(80).default("claude-opus-5-5"),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  whisperModel: z.enum(["small.en", "medium.en", "large-v3-turbo"]).default("large-v3-turbo"),
  language: z.string().min(2).max(8).default("en"),
  /** Words whisper should spell right: brand names, people, jargon. */
  glossary: z.array(z.string().max(60)).max(200).default([]),
  /** After the first import into an empty project, ask the agent for a first cut automatically. */
  autoFirstCut: z.boolean().default(true),
  /** Index what every clip shows with a vision model (the visual transcript). Uses the agent's backend. */
  describeShots: z.boolean().default(true),
  /** Free API keys for stock footage (pexels.com/api, pixabay.com/api/docs). */
  pexelsKey: z.string().max(200).default(""),
  pixabayKey: z.string().max(200).default(""),
  /** Optional: Freesound's own search (freesound.org/apiv2/apply); without it, sounds come through Openverse. */
  freesoundKey: z.string().max(500).default(""),
  /** KLIPY (klipy.com): reaction GIFs, stickers, clips and memes for the agent. Empty: KLIPY_API_KEY. */
  klipyKey: z.string().max(500).default(""),
  /** An anonymous id KLIPY asks for with each search (the same for this install), made on first use. */
  klipyUser: z.string().max(64).default(""),
  /** The brand kit new projects start with (its id), or none. */
  kit: z.string().max(64).default(""),
  /** Show the agent's thinking (a summary of it) in the chat as it works. */
  showThinking: z.boolean().default(true),
  /** Claude Code to run the agent with. Empty: the one installed on this computer, else the app's own. */
  claudePath: z.string().max(1000).default(""),
  /** The shared asset library (sounds, music, memes). Empty: Cutroom Library in the videos folder. */
  libraryDir: z.string().max(1000).default(""),
});
export type Settings = z.infer<typeof Settings>;

export interface AgentStatus {
  readonly backend: Backend;
  readonly model: string;
  readonly apiKey: boolean;
  /**
   * Where each media key comes from (never its value): saved in the app (kept in the keychain), the
   * environment or a .env file, or nowhere.
   */
  readonly keys?: Readonly<Record<"klipy" | "pexels" | "pixabay" | "freesound", "saved" | "env" | null>>;
}

/** A warning or error the app logged this session (API keys taken out). */
export interface DiagnosticProblem {
  readonly at: number;
  readonly level: "warn" | "error";
  /** "main", or "window" for the editor's page. */
  readonly from: string;
  readonly text: string;
}

/** What Settings → Diagnostics shows, and what a bug report carries. */
export interface Diagnostics {
  readonly version: string;
  readonly electron: string;
  readonly os: string;
  readonly logsDir: string;
  readonly problems: readonly DiagnosticProblem[];
}

/** The asset library as the editor shows it: the shared folder's assets and the open project's own. */
export interface LibraryState {
  /** The shared library folder. */
  readonly dir: string;
  /** The open project's assets/ folder (it may not exist yet). */
  readonly projectDir: string | null;
  readonly assets: readonly AssetEntry[];
  /** Role → asset id, the project's roles over the library's. */
  readonly roles: Readonly<Record<string, string>>;
  /** Files still being looked at (sounds heard, tempo measured, memes described). */
  readonly pending: number;
}

/** What the app menu asks of the editor. */
export type MenuAction = "settings" | "diagnostics" | "openProject" | "projects";

/**
 * The Claude Code the agent runs on (the subscription backend): which one, which version, and who it's
 * signed in as. Its login is the user's own (`claude auth login`), shared with Claude Code itself.
 */
export interface ClaudeStatus {
  /**
   * custom: the path in Settings. installed: the user's own install. bundled: the copy inside the app, used
   * when there's no usable install. missing: none at all.
   */
  readonly source: "custom" | "installed" | "bundled" | "missing";
  readonly path?: string;
  readonly version?: string;
  /** The version the editor was built against. */
  readonly recommended: string;
  /** ok; old: works, but update for the newest models; unsupported: too old to run the editor's agent. */
  readonly versionState: "ok" | "old" | "unsupported";
  /** A usable install that was passed over (too old), so the bundled copy is in use instead. */
  readonly skipped?: { readonly path: string; readonly version: string };
  /** Null when it couldn't tell (an old Claude Code without `auth status`). */
  readonly signedIn: boolean | null;
  /** "Claude Max", "API key", "Amazon Bedrock"... */
  readonly method?: string;
  readonly email?: string;
  readonly org?: string;
}

/** Installing, signing in to or updating Claude Code, as it goes. */
export interface ClaudeTask {
  readonly kind: "install" | "login" | "update";
  readonly state: "running" | "done" | "failed";
  /** The latest line of its output, or why it failed. */
  readonly message?: string;
  /** Signing in, when no terminal could be opened: the command to run in one. */
  readonly command?: string;
}

/** One message in the persisted conversation. */
/** One tool call the agent made, as the chat shows it (input and output trimmed for display). */
export interface ToolCall {
  /** Unique within the run. */
  readonly id: string;
  readonly name: string;
  /** In plain words: "Listening to the cuts". */
  readonly label: string;
  /** JSON, trimmed. */
  readonly input: string;
  readonly status: "running" | "done" | "error";
  /** What the tool told the agent, trimmed. */
  readonly output?: string;
  readonly ms?: number;
  /** A picture the agent saw (a frame strip at a cut), as a media key. */
  readonly image?: string;
  /** The loop guard stopped the agent changing something again: its reply says what's left. */
  readonly stuck?: boolean;
}

/** The agent's work on a request, in order: its narration between tools, tool calls and change steps. */
export type WorkEntry =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | ({ readonly kind: "tool" } & ToolCall)
  | { readonly kind: "step"; readonly text: string; readonly status: "done" | "warn" };

export type ChatRecord =
  | {
      readonly kind: "user";
      readonly text: string;
      readonly at: number;
      /** Source ids attached to the request. */
      readonly attachments?: readonly string[];
    }
  | {
      readonly kind: "agent";
      readonly at: number;
      readonly steps: readonly { text: string; status: "done" | "warn" }[];
      readonly text: string;
      /** The work behind the reply, in order (older records have only steps). */
      readonly work?: readonly WorkEntry[];
      readonly next?: string;
      readonly status: "done" | "error" | "stopped";
      readonly commitId: string | null;
      readonly elapsedMs: number | null;
      readonly error: string | null;
    }
  | { readonly kind: "note"; readonly at: number; readonly commitId: string };

export interface EditorApi {
  readonly kind: "desktop" | "web";
  readonly project: {
    /** Re-opens the last project, or the demo the first time. */
    restore(): Promise<ProjectSnapshot>;
    /** Shows a folder picker unless `dir` is given. Null when the user cancels. */
    open(dir?: string): Promise<ProjectSnapshot | null>;
    /** New empty project in a folder the user picks. */
    create(name: string): Promise<ProjectSnapshot | null>;
    openDemo(): Promise<ProjectSnapshot>;
    recent(): Promise<RecentProject[]>;
    commit(req: CommitRequest): Promise<CommitResult>;
    /** Reads files in place (nothing is copied), adds them to the cut, and starts indexing them. */
    importFiles(paths: string[]): Promise<CommitResult>;
    /** Asks for clips with the system file picker, then imports them. Null when the user cancels. */
    pickAndImport(): Promise<CommitResult | null>;
    /** Picks clips and starts a new project with them. Null when the user cancels. */
    newFromVideos(): Promise<ProjectSnapshot | null>;
    /**
     * Adds reference media for a request ("put this after scene one"): clips go in the library and get
     * indexed, but nothing goes on the timeline. Files are read in place, like imports.
     */
    attach(paths: string[]): Promise<AttachResult>;
    /** The same for media with no file, like a pasted screenshot: saved into media/attachments/. */
    attachData(name: string, bytes: Uint8Array): Promise<AttachResult>;
    /** Opens the project folder, or shows a file in it, in the system file manager. */
    reveal(relativePath?: string): Promise<void>;
    /** Shows any absolute file in the file manager (exports). */
    showFile(file: string): Promise<void>;
    loadChat(): Promise<ChatRecord[]>;
    saveChat(records: ChatRecord[]): Promise<void>;
  };
  readonly index: {
    /** Loudness envelope of a clip, 50 values per second, for drawing waveforms. */
    peaks(source: string): Promise<Uint8Array | null>;
    /** Indexes a clip again (after a failure, or a new speech model). */
    retry(source: string): Promise<void>;
    /** Describes the shots of clips that have none yet (Claude was unreachable when they indexed). */
    describe(): Promise<void>;
  };
  readonly agent: {
    run(req: AgentRequest): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    status(): Promise<AgentStatus>;
  };
  readonly library: {
    state(): Promise<LibraryState>;
    /** Copies files into the shared library (or the project's assets/), each into its kind's folder. */
    add(paths: string[], scope: "library" | "project"): Promise<void>;
    /** The system file picker, then add. */
    pickAndAdd(scope: "library" | "project"): Promise<void>;
    /** Shows the folder in Finder (created if missing). */
    reveal(scope: "library" | "project"): Promise<void>;
    update(id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<void>;
    /** Gives a role ("impact", "sting.awkward") to an asset, or takes it away (null). */
    setRole(role: string, id: string | null): Promise<void>;
    /** Adds it to the edit at a time: a sound effect, the music, or a meme over the video. */
    place(id: string, at: number): Promise<CommitResult>;
    /**
     * Copies clips the project uses (a dropped song, sound or meme) into the shared library, each into
     * its kind's folder, so every project can use them. Returns their asset ids.
     */
    keep(sourceIds: string[]): Promise<string[]>;
    /** Moves the shared library to another folder (picked); its catalogue goes with it. */
    pickDir(): Promise<void>;
  };
  readonly app: {
    diagnostics(): Promise<Diagnostics>;
    /** Shows the logs folder in Finder. */
    openLogs(): Promise<void>;
  };
  readonly claude: {
    /** Where Claude Code is and who it's signed in as; `refresh` looks again instead of answering from cache. */
    status(refresh?: boolean): Promise<ClaudeStatus>;
    /** Each starts a task reported through the `claude` event; one at a time. */
    install(): Promise<void>;
    login(): Promise<void>;
    update(): Promise<void>;
    cancel(): Promise<void>;
  };
  readonly kits: {
    list(): Promise<KitInfo[]>;
    /** Saves this project's taste as a kit (over the kit `id` when given) and links the project to it. */
    save(name: string, id?: string): Promise<KitInfo>;
    /** Brings a kit's taste into this project (one undoable commit). */
    apply(id: string): Promise<CommitResult>;
    remove(id: string): Promise<void>;
  };
  readonly exporter: {
    start(): Promise<{ jobId: string }>;
    cancel(jobId: string): Promise<void>;
  };
  readonly versions: {
    list(): Promise<VersionInfo[]>;
    /** Saves the current edit as a version. */
    save(name: string): Promise<VersionInfo>;
    /** Runs the agent several times in parallel, each in a different direction, and saves each result. */
    generate(prompt: string, count: number): Promise<void>;
    doc(id: string): Promise<ProjectDoc | null>;
    /** Makes a version the current edit (one undoable commit). */
    use(id: string): Promise<CommitResult>;
    remove(id: string): Promise<void>;
  };
  readonly history: {
    list(): Promise<HistoryEntry[]>;
    /** Puts the project back the way it was right after `commitId` (one undoable commit). */
    restore(commitId: string): Promise<CommitResult>;
  };
  readonly settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  /** Absolute path of a file dropped onto the window. Empty on the web. */
  pathForFile(file: File): string;
  on<E extends keyof EditorEvents>(event: E, listener: (payload: EditorEvents[E]) => void): () => void;
}

export interface EditorEvents {
  /** A commit made by the host (agent, file watcher, import, indexing). */
  commit: { commit: Commit; head: string };
  agent: AgentEvent;
  index: IndexEvent;
  importDone: ImportDoneEvent;
  export: ExportEvent;
  versions: VersionEvent;
  claude: ClaudeTask;
  menu: { action: MenuAction };
  library: LibraryState;
  /** The host's doc diverged from ours; replace local state. */
  reload: ProjectSnapshot;
  error: { message: string };
}

export { Channel, type EditorEventName } from "./channels.ts";

export type { Commit, Op, ProjectDoc };
