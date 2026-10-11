import type { AgentUsage } from "@vedit/bridge";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Which Claude the agent runs on. */
export type Backend = "api" | "subscription";

export class AgentError extends Error {
  override name = "AgentError";
}

/** The request used every turn it had. What it did so far is kept (see runAgent). */
export class StepLimit extends AgentError {
  override name = "StepLimit";
  constructor(
    readonly partial = "",
    message = "Gave up after too many steps. Try a smaller request.",
  ) {
    super(message);
  }
}

/** The agent kept repeating a call that failed the same way: stopped early, keeping what it did. */
export class Stuck extends StepLimit {
  override name = "Stuck";
  constructor(
    partial: string,
    readonly why: string,
  ) {
    super(partial, `Stopped: ${why}.`);
  }
}

/** Claude went silent mid-request (a stalled connection). What it did so far is kept, like StepLimit. */
export class Stalled extends StepLimit {
  override name = "Stalled";
  constructor(partial = "") {
    super(partial, "Claude stopped responding partway through.");
  }
}

/** How long Claude may be silent (no stream events, no tool running) before the request is called stalled. */
export const STALL_MS = 8 * 60_000;

/**
 * Notices a stalled request: nothing streamed from Claude for `ms` while none of our tools is running
 * (a tool may legitimately take a minute; Claude is quiet meanwhile). Calls `onStall` once.
 */
export class Watchdog {
  private last = Date.now();
  private busy = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  stalled = false;

  constructor(ms: number, onStall: () => void) {
    this.timer = setInterval(() => {
      if (this.busy || Date.now() - this.last < ms) return;
      this.stalled = true;
      this.stop();
      onStall();
    }, 5_000);
    this.timer.unref?.();
  }

  /** Something arrived from Claude. */
  beat(): void {
    this.last = Date.now();
  }

  tool(running: boolean): void {
    this.busy += running ? 1 : -1;
    this.last = Date.now();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

/** Turns kept back for the editor's review rounds (review.ts), on top of the request's own. */
export const REVIEW_TURNS = 16;

/** What a backend needs for one request. */
export interface BackendRun {
  readonly prompt: string;
  /** Images that go with the prompt: attached stills, and a frame of each attached clip. */
  readonly images?: readonly { readonly data: string; readonly mediaType: "image/jpeg" }[];
  readonly model: string;
  readonly effort: Effort;
  /** Model turns before it has to stop. */
  readonly maxTurns: number;
  /** Stream its thinking (summarized), or leave it out. */
  readonly thinking: "summarized" | "omitted";
  readonly signal?: AbortSignal;
  /** Text as it streams. `turn`: the first text of a new turn, which replaces the last turn's narration. */
  onText(delta: string, turn?: boolean): void;
  /** Its thinking (a summary of it) as it streams. `block`: the first words of a new stretch of thinking. */
  onThinking(delta: string, block?: boolean): void;
  /** What it's doing right now, before a step lands: thinking, running a tool, waiting on a retry. */
  onActivity(text: string): void;
  /** Context and plan-limit figures, as Claude reports them. */
  onUsage?(usage: AgentUsage): void;
  /**
   * Asked each time the agent wants to stop (review.ts): what it should fix first, sent back to it in the
   * same conversation, or null to let it finish.
   */
  review?(): Promise<string | null>;
}

/** What each tool is doing, as a status line while it runs. */
export const TOOL_ACTIVITY: Record<string, string> = {
  get_project: "Reading the project",
  get_transcript: "Reading the transcript",
  get_shots: "Reading the shot log",
  search_footage: "Searching the footage",
  rough_cut: "Cutting",
  edit_words: "Editing the words",
  search_library: "Looking through your library",
  add_from_library: "Adding from your library",
  update_library: "Updating your library",
  keep_in_library: "Keeping it in your library",
  transcribe_again: "Listening to the words again",
  clean_cuts: "Cleaning the cuts",
  apply_ops: "Making changes",
  fields: "Checking the fields",
  read_graphic: "Reading a graphic",
  guide: "Reading the guide",
  update_plan: "Planning",
  design: "Deciding the design",
  write_graphic: "Designing a graphic",
  edit_graphic: "Refining a graphic",
  make_graphics: "Designing the graphics",
  graphics_ready: "Waiting for the graphics",
  read_caption_look: "Reading the caption look",
  write_caption_look: "Designing the captions",
  read_style: "Reading a style",
  write_style: "Writing a style",
  look: "Rendering frames to look at",
  watch: "Watching it play",
  compare: "Comparing with the reference",
  track: "Tracking faces",
  find_music: "Finding music",
  find_stock: "Searching stock footage",
  listen: "Listening",
  fit_music: "Fitting the music",
  run_script: "Working it out",
  cutout: "Cutting out the person",
  add_stock: "Downloading stock footage",
  capture_page: "Capturing the page",
  find_sound: "Searching the sound library",
  find_font: "Looking through Google Fonts",
  add_font: "Adding the font",
  find_meme: "Searching KLIPY for memes",
  add_meme: "Downloading the meme",
  inspect_motion: "Measuring the motion",
  inspect_joins: "Listening to the cuts",
  add_sound: "Downloading the sound",
  remember: "Remembering that",
  brand_kit: "Working on the brand kit",
  inspiration: "Working on the inspiration",
  WebSearch: "Searching the web",
  WebFetch: "Reading a page",
  web_search: "Searching the web",
  web_fetch: "Reading a page",
  undo: "Undoing",
  run_checks: "Running checks",
  apply_fix: "Fixing",
};

/** The status line for a tool call, whatever prefix the backend gives its name. */
export const toolActivity = (name: string) =>
  `${TOOL_ACTIVITY[name.replace(/^mcp__[^_]+__/, "")] ?? "Working"}…`;
