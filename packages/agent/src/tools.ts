/**
 * The agent's tools, defined once and served to both backends (the Claude API loop and the Claude
 * Agent SDK). Mutating tools work on a scratch copy of the project; each call becomes one labelled,
 * separately undoable change. Inputs are zod schemas, validated before anything runs.
 */

import type { ToolCall } from "@vedit/bridge";
import { beatCutOps, runChecks } from "@vedit/checks";
import type {
  FontQuery,
  GoogleFamily,
  JoinReport,
  MemeCandidate,
  MemeKind,
  SoundCandidate,
  StockCandidate,
  StockKind,
  StockOrientation,
} from "@vedit/media";
import { frameStrip } from "@vedit/media";
import type { PastDesign } from "@vedit/project";
import {
  type AssetEntry,
  applyOps,
  assetLine,
  BUNDLED_FONTS,
  beatLength,
  bestStretch,
  type ChangeGroup,
  cleanCutOps,
  cutReport,
  DERIVED,
  describeSound,
  designEchoes,
  fontFromFile,
  gradeColorOf,
  graphicPreviewDoc,
  type InspirationInfo,
  type InspirationPack,
  inspirationBrief,
  inspirationInfo,
  inspirationMeta,
  inspirationOps,
  type KitInfo,
  lintGraphic,
  lintView,
  lookDefaults,
  looseOpSchemaFor,
  type MotionTrack,
  measureReference,
  musicBeats,
  type Op,
  OpError,
  ProcessRecipe,
  type ProjectDoc,
  packFromProject,
  parseWordRef,
  type ReferenceStudy,
  rangesFromKeeps,
  referenceText,
  rememberIn,
  replaceTimelineOps,
  replaceWordsOps,
  type SeenText,
  SHAPES,
  SINGLETONS,
  type Source,
  STARTER_INSPIRATIONS,
  sceneAt,
  searchAssets,
  shapeSize,
  soundShape,
  sourceTime,
  spokenWords,
  stopInspirationOps,
  type TimedWord,
  timelineOf,
  validateCaptionLook,
  validateGraphic,
  validateInspiration,
  validateStyle,
} from "@vedit/project";
import { z } from "zod";
import { compactFields, EDITABLE, fieldsOf, unknownFields } from "./fields.ts";
import { GUIDE_TOPICS, GUIDES, type GuideTopic } from "./guides.ts";
import { runScript } from "./script.ts";
import { toolActivity } from "./types.ts";
import { checkStep, checksView, projectView, searchFootage, shotsView, transcriptView } from "./view.ts";

/** What measuring the rendered motion found (sense.ts in @vedit/render). */
export interface MotionReport {
  readonly issues: readonly {
    readonly kind: string;
    readonly start: number;
    readonly end: number;
    readonly items: readonly string[];
    readonly detail: string;
  }[];
  readonly metrics: {
    readonly entries: number;
    readonly onBeat: number | null;
    readonly faceCovered: number;
    readonly graphicSeconds: number;
    readonly faces: boolean;
  };
}

/** What the host (the desktop app) provides: things that need the disk or the network. */
export interface AgentHost {
  /** A JPEG of a clip (or photo) at a source time, 512 pixels wide unless asked otherwise. */
  frame(sourceId: string, time: number, width?: number): Promise<Buffer>;
  /** Faces and people tracked over [from, to) of a clip, in source time (track ids prefixed `idPrefix`). */
  track?(sourceId: string, from: number, to: number, idPrefix: string): Promise<MotionTrack[]>;
  /** JPEGs of the finished video at output times (graphics, captions and all), and graphic runtime errors. */
  stills?(
    doc: ProjectDoc,
    times: readonly number[],
    options?: { composition?: "Video" | "Cover"; scale?: number },
  ): Promise<{ images: Buffer[]; errors: string[] }>;
  /** Finds a track for a mood, imports it into the project, and returns the ops that add it. */
  findMusic?(mood: string, doc: ProjectDoc): Promise<{ ops: Op[]; title: string; bpm: number | null } | null>;
  /**
   * Transcribes [from, to) of a clip again (seconds in the clip): guided by `hint` (names, "singing"),
   * or, given `text` (what's known to be said), those words timed to the voice. Words in clip time.
   */
  transcribe?(
    sourceId: string,
    from: number,
    to: number,
    guide: { text?: string; hint?: string },
  ): Promise<TimedWord[]>;
  /**
   * A clip's waveform, 50 peaks a second (what the timeline draws), measured on the spot when it hasn't
   * been yet. `doc` is the agent's working copy, which holds clips it just added. Null without sound.
   */
  peaks?(sourceId: string, doc: ProjectDoc): Promise<Uint8Array | null>;
  /** Makes the cutouts `doc` needs (the person separated from the background); ops record new ones. */
  cutouts?(doc: ProjectDoc): Promise<Op[]>;
  /** Makes what steadied and slowed shots need (camera paths, in-between frames); ops record them. */
  footage?(doc: ProjectDoc): Promise<Op[]>;
  /** Searches Pexels and Pixabay: candidates and a contact sheet of them. */
  findStock?(
    query: string,
    kind: StockKind,
    orientation: StockOrientation,
  ): Promise<{ candidates: StockCandidate[]; sheet: Buffer | null }>;
  /** The designs of the user's recent videos (other projects), newest first. */
  recentDesigns?(): Promise<PastDesign[]>;
  /** Measures the motion of the rendered video: flicker, pops, dead stops, graphics over faces, and more. */
  senseMotion?(doc: ProjectDoc): Promise<MotionReport>;
  /** Measures how every dialogue cut sounds: level, pitch and room either side, the pause, mid-sound. */
  measureJoins?(doc: ProjectDoc): Promise<JoinReport[]>;
  /** Searches Freesound's sound effects licensed for any use (CC0, CC BY). */
  findSounds?(query: string, maxSeconds: number): Promise<SoundCandidate[]>;
  /** Downloads a sound into the project; the ops add it as an audio clip. Hit: its loudest moment, seconds in. */
  addSound?(
    candidate: SoundCandidate,
    label: string,
    doc: ProjectDoc,
  ): Promise<{ ops: Op[]; id: string; hit: number; tail: number }>;
  /** Downloads a stock candidate into the project; the ops add it as a source. */
  addStock?(candidate: StockCandidate, label: string, doc: ProjectDoc): Promise<{ ops: Op[]; id: string }>;
  /** Searches KLIPY for reaction GIFs, stickers, clips or memes; a contact sheet of them to look at. */
  findMemes?(query: string, kind: MemeKind): Promise<{ candidates: MemeCandidate[]; sheet: Buffer | null }>;
  /** Downloads a meme candidate into the project; the ops add it as a clip (or image). */
  addMeme?(candidate: MemeCandidate, label: string, doc: ProjectDoc): Promise<{ ops: Op[]; id: string }>;
  /** Brand kits: the user's saved taste, shared across projects. */
  /** The user's asset library (shared folder and the project's assets/): their own sounds, music, memes. */
  library?: {
    search(): Promise<{ assets: AssetEntry[]; roles: Record<string, string> }>;
    /** Adds an asset to the project as a clip (copied in); the ops add it. */
    use(id: string, doc: ProjectDoc): Promise<{ ops: Op[]; id: string }>;
    update(id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<void>;
    setRole(role: string, id: string | null): Promise<void>;
    /** Copies project clips (a dropped song, sound, meme) into the shared library; their new asset ids. */
    keep(sourceIds: string[], doc: ProjectDoc): Promise<string[]>;
  };
  /**
   * The words on screen in a clip, read `rate` times a second (indexing reads them once a second): for a
   * reference's captions, whose pages come and go faster than that. Null where it can't be read here.
   */
  readText?(sourceId: string, rate: number): Promise<readonly SeenText[] | null>;
  /**
   * A reference studied: how the frame moves in each shot and what each cut is, the beat and the hits
   * (from its sound without the voice when that can be taken out). A minute or so for a long one.
   */
  study?(sourceId: string, onProgress?: (fraction: number) => void): Promise<ReferenceStudy | null>;
  /** Google Fonts: the open families, and fetching some into the project's fonts/ folder. */
  fonts?: {
    find(q: FontQuery): Promise<GoogleFamily[]>;
    /** Fetches a family's weights (and their italics) into fonts/; returns the files written. */
    add(family: string, weights: readonly number[], italic: boolean): Promise<string[]>;
  };
  kits?: {
    list(): Promise<KitInfo[]>;
    /** Saves `doc`'s taste as a kit (over `id` when given). */
    save(doc: ProjectDoc, name: string, id?: string): Promise<KitInfo>;
    /** The ops that bring a kit into `doc` (its fonts are copied into the project). */
    apply(id: string, doc: ProjectDoc): Promise<{ ops: Op[]; name: string } | null>;
    /** Adds a learned preference to a kit's STYLE.md. */
    remember(id: string, note: string): Promise<boolean>;
  };
  /** The user's own inspirations (the built-in ones come with the project package). */
  inspirations?: {
    list(): Promise<InspirationInfo[]>;
    get(id: string): Promise<InspirationPack | null>;
    /** Saves one to the user's inspirations (replacing one with the same id). */
    save(pack: InspirationPack): Promise<InspirationInfo>;
  };
  /**
   * Runs an ffmpeg filter graph on the project's clips (process.ts in @vedit/media): makes a clip,
   * which the ops add (the same recipe reuses the clip it made before), or measures and reports.
   */
  makeMedia?(recipe: ProcessRecipe, name: string, doc: ProjectDoc): Promise<{ ops: Op[]; source: Source }>;
  measureMedia?(recipe: ProcessRecipe, doc: ProjectDoc): Promise<string>;
  /** Keeps a picture the agent saw for the chat to show; its media key. */
  keepPicture?(jpeg: Buffer): Promise<string>;
  /** Screenshots a web page into the project; the ops add it as a source. */
  capturePage?(
    url: string,
    options: { find?: string; device?: "phone" | "desktop"; label: string },
    doc: ProjectDoc,
  ): Promise<{ ops: Op[]; id: string; image: Buffer; title: string; found: boolean }>;
}

export interface ToolImage {
  readonly data: string;
  readonly mediaType: "image/jpeg";
}

export interface ToolResult {
  readonly text: string;
  readonly images?: readonly ToolImage[];
  readonly isError?: boolean;
  /** A picture to show the user in the chat too (a media key from host.keepPicture). */
  readonly shown?: string;
  /** The loop guard fired. */
  readonly stuck?: boolean;
}

export interface Scratch {
  doc: ProjectDoc;
  /** Sounds from find_sound this run, by id, for add_sound. */
  sounds?: Map<string, SoundCandidate>;
  /** Stock candidates from find_stock this run, by id, for add_stock. */
  memes?: Map<string, MemeCandidate>;
  stock?: Map<string, StockCandidate>;
  readonly ops: Op[];
  readonly groups: ChangeGroup[];
  /** Scripted graphics that threw when last rendered, by graphic id. */
  graphicErrors?: Map<string, string>;
  /** Looks taken this request, and how often each item was changed again after a look (the loop guard). */
  looks?: number;
  /** Words on screen read again densely this request (inspiration measure), by clip. */
  read?: Map<string, { readonly text: readonly SeenText[]; readonly rate: number }>;
  /** References studied this request (inspiration measure), by clip. */
  studied?: Map<string, ReferenceStudy>;
  revisions?: Map<string, { count: number; looks: number }>;
  /** The guides read this request (guide), so a tool that needs one asks only once. */
  guides?: Set<GuideTopic>;
  /** This request's changes that undo can take back, newest last: each one's label and the ops that undo it. */
  undoable?: { label: string; inverse: Op[] }[];
}

export interface ToolContext {
  readonly scratch: Scratch;
  readonly host: AgentHost;
  /** A change group just applied to the scratch copy: the editor's live draft follows along. */
  draft?(label: string, ops: readonly Op[]): void;
  step(text: string, status?: "done" | "warn"): void;
  /** What's running right now, for the status line (tools run one at a time). */
  activity?(text: string): void;
  /** A tool started or finished (the backends' stall watchdog doesn't count a long tool as silence). */
  running?(busy: boolean): void;
  /** A tool call started or ended, for the chat's record of the work. */
  tool?(call: ToolCall): void;
  /** Indexing reaches the scratch copy as it lands (runAgent), so a clip being indexed is worth waiting for. */
  readonly followsIndexing?: boolean;
}

/** How long a tool waits for a clip that's still being indexed (an attachment, usually under a minute). */
const INDEX_WAIT = 90_000;

/**
 * The clip once indexing is done with it: at once when it is, or after waiting for it (up to
 * INDEX_WAIT) when this request's copy follows indexing. Null when there's no such clip.
 */
async function indexedClip(ctx: ToolContext, id: string | undefined): Promise<Source | null> {
  const clip = () => ctx.scratch.doc.sources.find((s) => s.id === id) ?? null;
  const busy = () => clip()?.status === "pending" || clip()?.status === "indexing";
  if (busy() && ctx.followsIndexing) {
    ctx.activity?.(`Waiting for ${id} to finish indexing…`);
    const until = Date.now() + INDEX_WAIT;
    while (busy() && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  }
  return clip();
}

let calls = 0;
/** Trimmed for the chat: enough to see what happened without shipping a transcript per call. */
const clip = (s: string, n = 3000) =>
  s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s;

/** The status line while a tool runs, with what it's working on where that helps. */
function activityFor(name: string, input: Record<string, unknown>): string {
  const base = toolActivity(name).replace(/…$/, "");
  const host = (u: unknown) => {
    try {
      return new URL(String(u)).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  if (name === "find_stock" && input.query) return `${base}: "${String(input.query).slice(0, 40)}"…`;
  if (name === "capture_page" && input.url) return `Capturing ${host(input.url)}…`;
  if (name === "add_stock" && input.id) return `${base} (${String(input.id)})…`;
  return `${base}…`;
}

export interface AgentTool<S extends z.ZodObject = z.ZodObject> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

const tool = <S extends z.ZodObject>(t: AgentTool<S>) => t as unknown as AgentTool;

/**
 * The ops apply_ops takes, on everything but what indexing writes and the inspirations (the inspiration
 * tool manages those). Items go as plain objects; their fields are listed once in the description, and
 * checked when applied.
 */
const AGENT_OPS = looseOpSchemaFor(EDITABLE);

/** Fields an op names that its collection or setting doesn't have, one line each (none: empty). */
function unknownIn(ops: readonly Op[]): string[] {
  return ops.flatMap((o, i) => {
    const name = "coll" in o ? o.coll : o.key;
    const value = o.op === "insert" ? o.item : o.op === "set" ? o.value : "patch" in o ? o.patch : undefined;
    return unknownFields(name, value).map(
      (u) => `ops[${i}] (${o.op} ${name}): no field "${u.path}"; it takes ${u.known.join(", ")}`,
    );
  });
}

const STYLE_COLLECTION = { effect: "effectKinds", transition: "transitionKinds", grade: "grades" } as const;
const STYLE_DIR = { effect: "effects", transition: "transitions", grade: "grades" } as const;

/** The most frames watch takes in one call: four sheets of twelve. */
const WATCH_FRAMES = 48;

/** Pictures in a strip at a cut: enough either side to see a flash, a black frame or a jump. */
const STRIP_FRAMES = 8;

/**
 * Consecutive frames of the finished video either side of `around` (snapped to a cut within half a
 * second), as one picture with a red bar where the cut falls.
 */
async function lookAround(
  ctx: ToolContext,
  doc: ProjectDoc,
  around: number,
  step: number,
): Promise<ToolResult> {
  const tl = timelineOf(doc);
  const { fps, width, height } = doc.meta.format;
  let cut: (typeof tl.scenes)[number] | null = null;
  for (const p of tl.scenes.slice(1))
    if (
      Math.abs(p.start - around) <= 0.5 &&
      (!cut || Math.abs(p.start - around) < Math.abs(cut.start - around))
    )
      cut = p;
  const center = Math.round((cut?.start ?? around) * fps);
  const last = Math.max(0, Math.ceil(tl.duration * fps) - 1);
  const frames = Array.from(
    { length: STRIP_FRAMES },
    (_, k) => center + (k - STRIP_FRAMES / 2) * step,
  ).filter((f) => f >= 0 && f <= last);
  if (!frames.length) return { text: `The video is ${tl.duration.toFixed(2)}s long.`, isError: true };
  const times = frames.map((f) => f / fps);
  const { images, errors } = await ctx.host.stills!(doc, times, { scale: 0.2 });
  noteErrors(ctx, errors);
  if (!images.length)
    return {
      text: `The frames didn't render.${errors.length ? ` ${errors.join("; ")}` : ""}`,
      isError: true,
    };
  const shown = frames.slice(0, images.length);
  const cutAfter = cut ? shown.findIndex((f) => f >= center) - 1 : -1;
  const portrait = height >= width;
  const strip = await frameStrip(images, {
    width: portrait ? 200 : 300,
    columns: portrait ? STRIP_FRAMES : STRIP_FRAMES / 2,
    cutAfter: cutAfter >= 0 ? cutAfter : null,
  });
  const labels = shown.map((f, i) =>
    `${i + 1}) ${(f / fps).toFixed(2)}s ${sceneAt(tl, f / fps)?.scene.id ?? ""}`.trim(),
  );
  const spacing = step === 1 ? "every frame" : `every ${step} frames`;
  const before = cut ? tl.scenes[cut.index - 1]!.scene.id : null;
  ctx.step(
    `Looked at ${cut ? `the cut at ${cut.start.toFixed(2)}s` : `${around.toFixed(2)}s`} frame by frame`,
  );
  // The user sees what the agent saw, under the call in the chat.
  const picture = await ctx.host.keepPicture?.(strip).catch(() => undefined);
  return {
    ...(picture && { shown: picture }),
    text:
      (cut
        ? `The cut at ${cut.start.toFixed(2)}s from ${before} to ${cut.scene.id}: ${shown.length} frames (${spacing}), left to right${portrait ? "" : " then the second row"}, the red bar where the cut falls.`
        : `${shown.length} frames (${spacing}) around ${around.toFixed(2)}s, left to right${portrait ? "" : " then the second row"} (no cut within half a second).`) +
      ` ${labels.join("; ")}.` +
      (images.length < frames.length ? " The rest didn't render." : "") +
      (errors.length ? ` Graphic errors: ${errors.join("; ")}` : ""),
    images: [{ data: strip.toString("base64"), mediaType: "image/jpeg" }],
  };
}

/**
 * The loop guard. Changing an item, looking, and changing it again is how a fix converges; doing it a
 * third time on the same shot is how a request spends minutes going round in circles. The third
 * revision is applied with a stop sign; a fourth isn't applied at all, and the agent asks the user.
 */
const MAX_REVISIONS = 3; // "the third change" below

const touched = (ops: readonly Op[]) => [
  ...new Set(
    ops.flatMap((o) =>
      "coll" in o ? [`${o.coll}:${o.op === "insert" ? (o.item as { id: string }).id : o.id}`] : [],
    ),
  ),
];
const itemName = (key: string) => key.slice(key.indexOf(":") + 1);

/** Items this change would revise past the limit (changed after looking, MAX_REVISIONS times already). */
function overRevised(ctx: ToolContext, ops: readonly Op[]): string[] {
  const looks = ctx.scratch.looks ?? 0;
  return touched(ops).filter((k) => {
    const r = ctx.scratch.revisions?.get(k);
    return r && looks > r.looks && r.count + 1 > MAX_REVISIONS;
  });
}

/** Counts a change; returns the items it just revised for the last time. */
function countRevisions(ctx: ToolContext, ops: readonly Op[]): string[] {
  const looks = ctx.scratch.looks ?? 0;
  ctx.scratch.revisions ??= new Map();
  const last: string[] = [];
  for (const k of touched(ops)) {
    const r = ctx.scratch.revisions.get(k);
    if (!r) ctx.scratch.revisions.set(k, { count: 1, looks });
    else if (looks > r.looks) {
      r.count++;
      r.looks = looks;
      if (r.count === MAX_REVISIONS) last.push(k);
    }
  }
  return last;
}

const STOP_AND_ASK = `finish the rest of the request without touching it again, then end your reply by telling the user plainly what's still wrong with it, what you tried, and two or three options (one of them can be a quick fix by hand on the timeline). They can answer in a word, or tell you to keep trying.`;

/** Remembers graphics that threw while rendering, for run_checks. */
function noteErrors(ctx: ToolContext, errors: readonly string[]): void {
  ctx.scratch.graphicErrors ??= new Map();
  for (const e of errors) {
    const at = e.indexOf(": ");
    ctx.scratch.graphicErrors.set(e.slice(0, at), e.slice(at + 2));
  }
}

/** Applies ops to the scratch doc as one change group. */
function commit(ctx: ToolContext, label: string, ops: readonly Op[], undoable = true): ToolResult {
  if (!ops.length) return { text: "Nothing to change." };
  try {
    const applied = applyOps(ctx.scratch.doc, ops);
    ctx.scratch.doc = applied.doc;
    if (undoable)
      ctx.scratch.undoable = [...(ctx.scratch.undoable ?? []), { label, inverse: applied.inverse }];
  } catch (err) {
    if (err instanceof OpError) {
      const at = ops.indexOf(err.op);
      return {
        text: `Not applied: ${at >= 0 && ops.length > 1 ? `ops[${at}] ` : ""}${err.message}`,
        isError: true,
      };
    }
    throw err;
  }
  const start = ctx.scratch.ops.length;
  ctx.scratch.ops.push(...ops);
  ctx.scratch.groups.push({ label, ops: ops.map((_, i) => start + i) });
  ctx.step(label);
  // The editor shows the work as a live draft while the request runs.
  ctx.draft?.(label, ops);
  return { text: "Applied." };
}

/** The music fitted to the video's current length (fit_music), as ops; or why it can't be. */
async function fitMusic(
  ctx: ToolContext,
  mode: "auto" | "part" | "loop",
): Promise<{ ops: Op[]; text: string } | { error: string }> {
  const doc = ctx.scratch.doc;
  const src = doc.music.source ? doc.sources.find((s) => s.id === doc.music.source) : undefined;
  if (!src) return { error: "There's no music track set (music.source)." };
  if (!ctx.host.peaks) return { error: "Not available here." };
  const peaks = await ctx.host.peaks(src.id, doc);
  if (!peaks?.length) return { error: `${src.id} couldn't be measured.` };
  const a = doc.analyses.find((x) => x.id === src.id);
  const length = timelineOf(doc).duration;
  const s = bestStretch(peaks, length, {
    duration: src.duration,
    ...(a?.downbeats && { downbeats: a.downbeats }),
    ...(a?.beats && { beats: a.beats }),
    mode,
  });
  if (!s)
    return { error: `No ${mode === "part" ? `${length.toFixed(1)}s stretch` : "loop"} found in this track.` };
  const len = s.end - s.start;
  return {
    ops: [
      {
        op: "merge",
        key: "music",
        patch: {
          section: { start: s.start, end: s.end },
          loop: s.loop || doc.music.loop,
          fitted: Math.round(length * 100) / 100,
        },
      },
    ],
    text: s.loop
      ? `Looping ${s.start}-${s.end}s (${len.toFixed(2)}s, about ${(length / len).toFixed(1)} times over the ${length.toFixed(1)}s video). Its quietest moments sit ${Math.abs(s.floor)} dB under its loud end.`
      : `Using ${s.start}-${s.end}s of the track for the ${length.toFixed(1)}s video. Its quietest moments sit ${Math.abs(s.floor)} dB under its loud end.`,
  };
}

/**
 * At the end of a request that changed the cut or the music (music.lockCuts): every cut after a shot
 * nobody talks in moves onto the nearest beat, as one change the user can undo. A request that left them
 * alone leaves them alone, so cuts the user placed by hand stay where they are.
 */
export function snapCutsToBeat(ctx: ToolContext): void {
  const doc = ctx.scratch.doc;
  if (!doc.music.lockCuts) return;
  const touched = ctx.scratch.ops.some(
    (o) => ("coll" in o && o.coll === "scenes") || ("key" in o && o.key === "music"),
  );
  if (!touched) return;
  const ops = beatCutOps(doc);
  if (!ops.length) return;
  const result = commit(ctx, "Cuts on the beat", ops);
  if (!result.isError) ctx.step(`Moved ${ops.length} cut${ops.length === 1 ? "" : "s"} onto the beat`);
}

/**
 * At the end of a request: music fitted (fit_music) for a length the cut no longer has is fitted again,
 * so the agent never has to remember to.
 */
export async function refitMusic(ctx: ToolContext): Promise<void> {
  const m = ctx.scratch.doc.music;
  if (!m.source || m.fitted === undefined) return;
  if (Math.abs(timelineOf(ctx.scratch.doc).duration - m.fitted) <= 1) return;
  const fit = await fitMusic(ctx, "auto").catch(() => null);
  if (fit && "ops" in fit) commit(ctx, "Fitted the music to the final length", fit.ops);
}

/** apply_ops's checks and commit, shared with run_script: the ops as one change the user can undo. */
function applyAgentOps(ctx: ToolContext, label: string, ops: Op[]): ToolResult {
  const derived = ops.find((o) => "coll" in o && DERIVED.includes(o.coll));
  if (derived)
    return {
      text: "Transcripts and analysis are written by indexing; use edit_words for captions.",
      isError: true,
    };
  const unknown = unknownIn(ops);
  if (unknown.length)
    return {
      text: `Not applied: ${unknown.slice(0, 8).join("\n")}${unknown.length > 8 ? `\n(and ${unknown.length - 8} more)` : ""}`,
      isError: true,
    };
  const stuck = overRevised(ctx, ops);
  if (stuck.length)
    return {
      stuck: true,
      text: `Not applied: you've changed ${stuck.map(itemName).join(", ")} ${MAX_REVISIONS} times after looking at it this request, and it still isn't right. Stop changing it (undo can still take back your changes): ${STOP_AND_ASK}`,
      isError: true,
    };
  const result = commit(ctx, label, ops);
  if (result.isError)
    return /invalid \w+/.test(result.text)
      ? { ...result, text: `${result.text}\nThe fields tool has what each field takes.` }
      : result;
  const last = countRevisions(ctx, ops);
  return {
    ...(last.length > 0 && { stuck: true }),
    text:
      `Applied. Project now:\n${projectView(ctx.scratch.doc)}` +
      (last.length
        ? `\n\nThat's the third change to ${last.map(itemName).join(", ")} after looking at it. Check it once more; if it still isn't right, ${STOP_AND_ASK}`
        : ""),
  };
}

const Label = z
  .string()
  .min(1)
  .max(80)
  .describe('Short human label for this change, e.g. "+3 zooms" or "Cut the retakes"');

/** A tool whose job needs a guide asks for it first, once a request: the refusal says which. */
function needsGuide(ctx: ToolContext, topic: GuideTopic): ToolResult | null {
  if (ctx.scratch.guides?.has(topic)) return null;
  return {
    text: `Read the ${topic} guide first (guide {"topic": "${topic}"}): it has the craft this needs. Then do this again.`,
    isError: true,
  };
}

export const TOOLS: readonly AgentTool[] = [
  tool({
    name: "guide",
    description: "The craft for a kind of job (the topics are in the system prompt). Read it before the job.",
    input: z.object({ topic: z.enum(GUIDE_TOPICS) }),
    async run({ topic }, ctx) {
      ctx.scratch.guides ??= new Set();
      ctx.scratch.guides.add(topic);
      return { text: GUIDES[topic] };
    },
  }),
  tool({
    name: "get_transcript",
    description:
      "Read what is said in a clip, word by word, with word indices, pauses, and which words are currently in the cut. Use the indices with rough_cut and edit_words. Omit source to get every clip with speech.",
    input: z.object({
      source: z.string().optional().describe("Clip id; omit for all clips with speech"),
      from: z.number().int().min(0).optional().describe("First word index"),
      to: z.number().int().min(0).optional().describe("Last word index"),
    }),
    async run({ source, from, to }, ctx) {
      const doc = ctx.scratch.doc;
      const ids = source ? [source] : doc.transcripts.filter((t) => t.words.length).map((t) => t.id);
      if (!ids.length) return { text: "No clip has a transcript yet." };
      return { text: ids.map((id) => transcriptView(doc, id, from, to)).join("\n\n") };
    },
  }),
  tool({
    name: "rough_cut",
    description:
      "Rebuild the whole timeline from the words to keep, in the order given. Each keep is a word range of one clip; pauses longer than max_pause are cut out automatically and every take gets clean padding. Use this to cut retakes, false starts, filler and dead air, or to reorder what is said. Titles, zooms, effects and manual captions are cleared (comments are kept); add them back afterwards.",
    input: z.object({
      label: Label,
      keep: z
        .array(
          z.object({
            source: z.string(),
            from: z.number().int().min(0).describe("First word index to keep"),
            to: z.number().int().min(0).describe("Last word index to keep (inclusive)"),
          }),
        )
        .min(1)
        .max(400),
      max_pause: z
        .number()
        .min(0.15)
        .max(3)
        .optional()
        .describe("Pauses longer than this are cut. Default 0.4s; use 0.25 for a fast, punchy pace"),
    }),
    async run({ label, keep, max_pause }, ctx) {
      let ranges: ReturnType<typeof rangesFromKeeps>;
      // Each clip's waveform, so every cut lands on the breath between words, not on the transcript's
      // (often early) word edges.
      const waves = new Map<string, Uint8Array | null>();
      for (const id of new Set(keep.map((k) => k.source)))
        waves.set(id, ctx.host.peaks ? await ctx.host.peaks(id, ctx.scratch.doc).catch(() => null) : null);
      try {
        ranges = rangesFromKeeps(ctx.scratch.doc, keep, {
          ...(max_pause !== undefined && { maxGap: max_pause }),
          levels: (id) => waves.get(id),
          pauses: ctx.scratch.doc.mix.pauses,
        });
      } catch (err) {
        return { text: (err as Error).message, isError: true };
      }
      const result = commit(ctx, label, replaceTimelineOps(ctx.scratch.doc, ranges));
      if (result.isError) return result;
      const doc = ctx.scratch.doc;
      const said = spokenWords(doc)
        .map((w) => w.text)
        .join(" ");
      return {
        text: `Cut is ${timelineOf(doc).duration.toFixed(1)}s in ${doc.scenes.length} shots (${doc.scenes.map((s) => s.id).join(", ")}). It now says:\n${said}${cutNotes(doc, (id) => waves.get(id))}`,
      };
    },
  }),
  tool({
    name: "clean_cuts",
    description:
      "Move every shot's in and out points onto the breath: the quietest moment between words, from the waveform, so no cut clips the start or the tail of a word (the transcript's word edges are often off by a tenth or two). After a sentence it lets the pause breathe (mix.pauses.sentence) while the room stays quiet, and a cut that still lands in sound gets a longer crossfade (mix.speechFade; a crossfade already set on a shot stays). Everything anchored to a shot stays on the same words. rough_cut already cuts this way; run this after trimming shots by hand, or on an edit where words sound clipped.",
    input: z.object({ label: Label }),
    async run({ label }, ctx) {
      if (!ctx.host.peaks) return { text: "Not available here.", isError: true };
      const waves = new Map<string, Uint8Array | null>();
      for (const id of new Set(ctx.scratch.doc.scenes.map((sc) => sc.source)))
        waves.set(id, await ctx.host.peaks(id, ctx.scratch.doc).catch(() => null));
      const { ops, moved, blended } = cleanCutOps(ctx.scratch.doc, (id) => waves.get(id));
      if (!ops.length)
        return {
          text: `Every cut already sits on a breath.${cutNotes(ctx.scratch.doc, (id) => waves.get(id))}`,
        };
      const result = commit(ctx, label, ops);
      return result.isError
        ? result
        : {
            text: `Moved ${moved} cut edges onto the breath between words${blended ? `; ${blended} cuts with no breath to land on now crossfade over mix.speechFade` : ""}.${cutNotes(ctx.scratch.doc, (id) => waves.get(id))}`,
          };
    },
  }),
  tool({
    name: "edit_words",
    description:
      'Fix misheard words and choose which words the captions emphasize. Words are "<clip id>:<word index>". Emphasize the 1-2 words that carry each sentence (names, numbers, strong verbs). hidden keeps the audio but leaves the word out of captions (for filler you could not cut).',
    input: z.object({
      label: Label,
      edits: z
        .array(
          z.object({
            word: z.string().describe('"<clip id>:<word index>"'),
            text: z.string().max(80).optional().describe("Corrected text"),
            emphasis: z.boolean().optional(),
            hidden: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(500),
    }),
    async run({ label, edits }, ctx) {
      const doc = ctx.scratch.doc;
      const existing = new Map(doc.wordEdits.map((e) => [e.id, e]));
      const ops: Op[] = [];
      for (const e of edits) {
        const ref = parseWordRef(e.word);
        const words = ref && doc.transcripts.find((t) => t.id === ref.source)?.words;
        if (!ref || !words?.[ref.index]) return { text: `No word ${e.word}`, isError: true };
        const patch = {
          ...(e.text !== undefined && { text: e.text }),
          ...(e.emphasis !== undefined && { emphasis: e.emphasis }),
          ...(e.hidden !== undefined && { hidden: e.hidden }),
        };
        if (existing.has(e.word)) ops.push({ op: "update", coll: "wordEdits", id: e.word, patch });
        else ops.push({ op: "insert", coll: "wordEdits", item: { id: e.word, ...patch } });
      }
      return commit(ctx, label, ops);
    },
  }),
  tool({
    name: "transcribe_again",
    description:
      'Listen again to a stretch the transcript missed or misheard (singing, a mumble, music or noise over the voice, a fast name) and put the new words in its place; the captions follow. When you know what\'s said (the user told you, or the lyrics), give text: those exact words are timed to the voice. Otherwise the recognizer listens again, guided by hint ("singing", names, the topic). from/to are seconds in the video, like the times the user points at; give source to use seconds in that clip instead. Fixes and emphasis on the words around the stretch stay. For one or two misspelled words, edit_words is enough.',
    input: z.object({
      label: Label,
      from: z
        .number()
        .min(0)
        .describe("Start of the stretch, in seconds (the video's, or the clip's with source)"),
      to: z.number().min(0).describe("End of the stretch"),
      source: z.string().optional().describe("A clip id: from/to are then seconds in that clip"),
      text: z
        .string()
        .max(2000)
        .optional()
        .describe("The words actually said or sung in the stretch, when known"),
      hint: z
        .string()
        .max(300)
        .optional()
        .describe('What to listen for, when the words aren\'t known: "singing", names, the topic'),
    }),
    async run({ label, from, to, source, text, hint }, ctx) {
      if (!ctx.host.transcribe) return { text: "Transcribing isn't available here.", isError: true };
      const doc = ctx.scratch.doc;
      if (to <= from) return { text: "to must be after from.", isError: true };
      if (to - from > 120) return { text: "At most two minutes at a time.", isError: true };
      // Video times: the clip under the stretch's start, and its times in that clip.
      let id = source;
      let lo = from;
      let hi = to;
      if (!source) {
        const tl = timelineOf(doc);
        const placed = sceneAt(tl, from);
        if (!placed) return { text: `Nothing plays at ${from.toFixed(1)}s.`, isError: true };
        id = placed.scene.source;
        lo = sourceTime(placed, from);
        hi = sourceTime(placed, Math.min(to, placed.start + placed.duration - 0.001));
      }
      const src = doc.sources.find((s) => s.id === id);
      if (!src) return { text: `No clip "${id}".`, isError: true };
      if (src.kind !== "video" && src.kind !== "audio")
        return { text: `${src.id} has no sound.`, isError: true };
      const words = await ctx.host.transcribe(src.id, lo, hi, {
        ...(text?.trim() && { text: text.trim() }),
        ...(hint?.trim() && { hint: hint.trim() }),
      });
      if (!words.length)
        return {
          text: `Heard no words in ${src.id} between ${lo.toFixed(1)}s and ${hi.toFixed(1)}s. If you know what's said there, give it as text.`,
        };
      const { ops, first, replaced } = replaceWordsOps(doc, src.id, lo, hi, words);
      // Words in a clip indexing heard nobody talk in: it has speech after all.
      if (!src.speech) ops.push({ op: "update", coll: "sources", id: src.id, patch: { speech: true } });
      const result = commit(ctx, label, ops);
      if (result.isError) return result;
      return {
        text: `${src.id} ${lo.toFixed(2)}-${hi.toFixed(2)}s: ${replaced} word${replaced === 1 ? "" : "s"} replaced by ${words.length}, now words [${first}]-[${first + words.length - 1}]: ${words.map((w) => `${w.text} (${w.start.toFixed(2)})`).join(" ")}`,
      };
    },
  }),
  tool({
    name: "apply_ops",
    description: `Apply a group of edits to the project. All ops apply or none do. Returns the updated project, or an error to fix and retry. Each call is one change the user can undo on its own.
Ops:
{op: "insert", coll, item, index?}: add an item (index: its position; appends when omitted)
{op: "update", coll, id, patch}: change an item's fields (only those that change; null removes an optional one)
{op: "remove", coll, id} / {op: "move", coll, id, index}
{op: "set", key, value} / {op: "merge", key, patch}: replace a setting, or change some of its fields
Fields (? optional; a bare name is a string; the fields tool has what each does and its default):
${compactFields()}`,
    input: z.object({ label: Label, ops: z.array(AGENT_OPS).min(1).max(400) }),
    async run({ label, ops }, ctx) {
      return applyAgentOps(ctx, label, ops);
    },
  }),
  tool({
    name: "run_script",
    description: `Work something out over the project with JavaScript, instead of doing the arithmetic yourself: shot lengths that land cuts on the beat, spacing visuals evenly, finding every place a word is said, the same change to many items. The code is a function body: return the answer (any JSON), and console.log what helps. Return { ops: [...] } with a label to apply them as one change, exactly as apply_ops would (same ops, same checks, undoable).
It sees, read-only:
- project: the project (scenes, visuals, titles, zooms, sfx, music, sources... everything but transcripts and analysis)
- timeline: { duration, scenes: [{ id, source, in, out, speed, start, duration, index }] } (start and duration in output seconds)
- beats: the music's beats in output seconds ([] without music); bpm (null without one)
- transcript(clipId): its words [{ text, start, end, ... }] in the clip's own time; analysis(clipId): { beats, bpm, shots, silences, speech, face, ... }; shotLog(clipId): { segments, loud }
A sandbox: plain JavaScript, no files, network, timers or modules, stopped after 5 seconds or 64 MB. It reads; only returned ops change the project.`,
    input: z.object({
      code: z.string().min(1).max(20_000).describe("A function body that returns the answer"),
      label: Label.optional().describe("Needed when it returns ops: the change's label"),
    }),
    async run({ code, label }, ctx) {
      const doc = ctx.scratch.doc;
      const tl = timelineOf(doc);
      const project = Object.fromEntries(Object.entries(doc).filter(([k]) => !DERIVED.includes(k as never)));
      const run = await runScript(
        code,
        {
          project,
          timeline: {
            duration: tl.duration,
            scenes: tl.scenes.map(({ scene, start, duration, index }) => ({
              id: scene.id,
              source: scene.source,
              in: scene.in,
              out: scene.out,
              speed: scene.speed ?? 1,
              start,
              duration,
              index,
            })),
          },
          beats: musicBeats(doc, tl.duration),
          bpm: beatLength(doc) ? 60 / beatLength(doc)! : null,
        },
        {
          transcript: (id) => doc.transcripts.find((t) => t.id === id)?.words ?? null,
          analysis: (id) => doc.analyses.find((a) => a.id === id) ?? null,
          shotLog: (id) => doc.shotLogs.find((l) => l.id === id) ?? null,
        },
      );
      const log = run.logs.length ? `\nLogged:\n${clip(run.logs.join("\n"))}` : "";
      if (run.error) return { text: `The script failed: ${run.error}${log}`, isError: true };
      const value: unknown = run.json === undefined ? undefined : JSON.parse(run.json);
      const ops =
        value && typeof value === "object" && "ops" in value ? (value as { ops: unknown }).ops : undefined;
      if (ops === undefined)
        return { text: `${run.json === undefined ? "It returned nothing." : clip(run.json, 20_000)}${log}` };
      const parsed = z.array(AGENT_OPS).min(1).max(400).safeParse(ops);
      if (!parsed.success)
        return {
          text: `Not applied: the ops it returned aren't valid: ${z.prettifyError(parsed.error).slice(0, 1500)}${log}`,
          isError: true,
        };
      if (!label)
        return { text: `Not applied: give a label to apply the ops it returns.${log}`, isError: true };
      const applied = applyAgentOps(ctx, label, parsed.data as Op[]);
      return { ...applied, text: `${applied.text}${log}` };
    },
  }),
  tool({
    name: "fields",
    description:
      "What each field of a collection or setting does, its range and its default (apply_ops lists them by name). Look one up before using fields you haven't, or when an edit is refused.",
    input: z.object({
      names: z
        .array(z.enum([...EDITABLE, ...SINGLETONS] as [string, ...string[]]))
        .min(1)
        .max(8),
    }),
    async run({ names }) {
      return { text: names.map((n) => fieldsOf(n)).join("\n\n") };
    },
  }),
  tool({
    name: "read_graphic",
    description:
      "Read a graphic's HTML and CSS, to adapt it or to learn the format before writing a new one.",
    input: z.object({ id: z.string() }),
    async run({ id }, ctx) {
      const g = ctx.scratch.doc.graphics.find((x) => x.id === id);
      return g
        ? { text: g.html }
        : {
            text: `No graphic "${id}". Graphics: ${ctx.scratch.doc.graphics.map((x) => x.id).join(", ")}`,
            isError: true,
          };
    },
  }),
  tool({
    name: "design",
    description:
      "This video's own design, before its first graphic: the look and why it fits, palette (accent first), faces, motion, graphic kinds. Sets look.accent and look.font; refused if it repeats a recent video's.",
    input: z.object({
      label: Label,
      idea: z.string().min(10).max(300),
      palette: z
        .array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "colors are #rrggbb"))
        .min(2)
        .max(6),
      display: z.string().min(1).max(80),
      text: z.string().min(1).max(80),
      motion: z.string().min(10).max(200),
      graphics: z.array(z.string().min(1).max(60)).min(1).max(12),
    }),
    async run({ label, ...design }, ctx) {
      const echoes = designEchoes(design, (await ctx.host.recentDesigns?.()) ?? []);
      if (echoes.length)
        return {
          text: [
            "Not saved: this repeats a recent video's design, and every video gets its own.",
            ...echoes.map((e) => `- "${e.name}": ${e.traits.join(", ")}`),
            "Change what it repeats (a different pairing of faces, another accent, a different motion language or graphic kinds that come from this video's subject), then call design again.",
          ].join("\n"),
          isError: true,
        };
      const doc = ctx.scratch.doc;
      const families = new Set([...BUNDLED_FONTS.map((f) => f.family), ...doc.fonts.map((f) => f.family)]);
      const missing = [design.display, design.text].filter(
        (f, i, all) => !families.has(f) && all.indexOf(f) === i,
      );
      const result = commit(ctx, label, [
        { op: "set", key: "design", value: design },
        { op: "merge", key: "look", patch: { accent: design.palette[0], font: design.display } },
      ]);
      if (result.isError) return result;
      return {
        text: [
          "Saved design.json; look.accent and look.font follow it.",
          missing.length
            ? `Not in the project yet: ${missing.join(", ")}. find_font it and add_font the weights you'll use, or the closest bundled face shows instead.`
            : "",
          "Build its graphics from the kit (KIT in the graphics format): its curves, entrances and exits, data-split, data-fit and the safe-area helpers, styled in this design.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    },
  }),
  tool({
    name: "write_graphic",
    description:
      'Create or replace a motion graphic: a small web page saved as graphics/<id>.html, then placed with a visual (apply_ops, content {"kind": "graphic", "graphic": id, "params": {...}}). Start with the JSON header comment, then <style> and markup. Motion is CSS @keyframes, or a <script> that draws from the video clock (libs in the header); no network. Build it from the kit; the graphics guide has the format. Then look {graphic, params, times} at 5-6 times across it (alone over a shot, off the timeline: just in, entrance, middle, before the exit), and in context once placed.',
    input: z.object({
      label: Label,
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lower-case letters, digits and dashes"),
      html: z.string().min(20).max(60_000),
    }),
    async run({ label, id, html }, ctx) {
      const unread = needsGuide(ctx, "graphics");
      if (unread) return unread;
      const problem = validateGraphic(html);
      if (problem) return { text: `Not saved: ${problem}`, isError: true };
      const exists = ctx.scratch.doc.graphics.some((g) => g.id === id);
      if (!exists && !ctx.scratch.doc.design.idea)
        return {
          text: "Not saved: decide this video's design first (design: its palette, faces, motion and graphic kinds), so every graphic you write shares it and the video doesn't look like the last one.",
          isError: true,
        };
      ctx.scratch.graphicErrors?.delete(id);
      const result = commit(ctx, label, [
        exists
          ? { op: "update", coll: "graphics", id, patch: { html } }
          : { op: "insert", coll: "graphics", item: { id, html } },
      ]);
      if (result.isError) return result;
      const notes = lintView(id, lintGraphic(html));
      return {
        text: [`Saved graphics/${id}.html. Place it with a visual to use it.`, notes]
          .filter(Boolean)
          .join("\n\n"),
      };
    },
  }),
  tool({
    name: "read_caption_look",
    description:
      "Read a caption look's CSS (captions/looks/<id>.css), to adapt it or to learn the hooks before writing one.",
    input: z.object({ id: z.string() }),
    async run({ id }, ctx) {
      const l = ctx.scratch.doc.captionLooks.find((x) => x.id === id);
      return l
        ? { text: l.css }
        : {
            text: `No caption look "${id}". Looks: ${ctx.scratch.doc.captionLooks.map((x) => x.id).join(", ")}`,
            isError: true,
          };
    },
  }),
  tool({
    name: "write_caption_look",
    description:
      "Create or replace a caption look: CSS saved as captions/looks/<id>.css over the hooks .caption, .word, .word.said/.now/.next, .word.hl and the variables --size, --color, --accent, --font, --page-t, --word-t (see the system prompt). use: true also switches the captions to it, with the defaults in its header. Then look at output times where someone is speaking to check it.",
    input: z.object({
      label: Label,
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lower-case letters, digits and dashes"),
      css: z.string().min(20).max(60_000),
      use: z.boolean().default(false).describe("Switch the captions to this look"),
    }),
    async run({ label, id, css, use }, ctx) {
      const unread = needsGuide(ctx, "looks");
      if (unread) return unread;
      const problem = validateCaptionLook(css);
      if (problem) return { text: `Not saved: ${problem}`, isError: true };
      const exists = ctx.scratch.doc.captionLooks.some((l) => l.id === id);
      const ops: Op[] = [
        exists
          ? { op: "update", coll: "captionLooks", id, patch: { css } }
          : { op: "insert", coll: "captionLooks", item: { id, css } },
      ];
      if (use) {
        ops.push({ op: "merge", key: "captionStyle", patch: { ...lookDefaults(css), look: id } });
      }
      const result = commit(ctx, label, ops);
      return result.isError
        ? result
        : { text: `Saved captions/looks/${id}.css${use ? " and switched the captions to it" : ""}.` };
    },
  }),
  tool({
    name: "remember",
    description:
      'Remember a lasting preference of the user\'s ("never use whooshes", "captions always low and small", "they hate the glitch effect", "hooks under 4 words"): added to STYLE.md, which every request reads, and to the project\'s brand kit, so their next project starts with it. Use it when the user corrects your taste or states a rule for their videos, not for one-off fixes to this edit.',
    input: z.object({
      note: z.string().min(3).max(240).describe("The preference, as a short rule in their terms"),
    }),
    async run({ note }, ctx) {
      const doc = ctx.scratch.doc;
      const result = commit(ctx, "Remembered a preference", [
        { op: "set", key: "style", value: rememberIn(doc.style, note) },
      ]);
      if (result.isError) return result;
      const kit = doc.meta.kit && ctx.host.kits ? await ctx.host.kits.remember(doc.meta.kit, note) : false;
      ctx.step(`Remembered: ${note}`);
      return {
        text: `Saved to STYLE.md${kit ? " and the project's brand kit" : " (no brand kit linked: brand_kit save would carry it to new projects)"}.`,
      };
    },
  }),
  tool({
    name: "brand_kit",
    description:
      "Brand kits: the user's taste saved to carry between projects (look and grade, captions and their looks, effects, transitions, graphics, fonts, mix, checks, export settings, the cover's style, music levels, STYLE.md). list shows them; save keeps this project's taste as a kit (name; id to update one) and links the project to it; apply brings a kit's taste into this project.",
    input: z.object({
      action: z.enum(["list", "save", "apply"]),
      name: z.string().max(80).optional().describe("For save"),
      id: z.string().max(64).optional().describe("For apply, or to update a kit with save"),
    }),
    async run({ action, name, id }, ctx) {
      const kits = ctx.host.kits;
      if (!kits) return { text: "Brand kits aren't available here.", isError: true };
      if (action === "list") {
        const all = await kits.list();
        const mine = ctx.scratch.doc.meta.kit;
        return {
          text: all.length
            ? all
                .map(
                  (k) =>
                    `${k.id}: ${k.name}${k.id === mine ? " (this project's)" : ""}, from ${k.from || "a project"}, ${k.graphics} graphics${k.fonts.length ? `, fonts ${k.fonts.join(", ")}` : ""}`,
                )
                .join("\n")
            : "No brand kits yet.",
        };
      }
      if (action === "save") {
        const info = await kits.save(ctx.scratch.doc, name?.trim() || ctx.scratch.doc.meta.name, id);
        const result = commit(ctx, `Saved brand kit ${info.name}`, [
          { op: "merge", key: "meta", patch: { kit: info.id } },
        ]);
        if (result.isError) return result;
        ctx.step(`Saved brand kit "${info.name}"`);
        return { text: `Saved as brand kit ${info.id} ("${info.name}"); this project is linked to it.` };
      }
      if (!id) return { text: "Give the kit's id (brand_kit list).", isError: true };
      const applied = await kits.apply(id, ctx.scratch.doc);
      if (!applied) return { text: `No brand kit "${id}".`, isError: true };
      const result = commit(ctx, `Applied brand kit ${applied.name}`, applied.ops);
      if (result.isError) return result;
      return { text: `Applied "${applied.name}": look, captions, graphics, effects, mix and STYLE.md.` };
    },
  }),
  tool({
    name: "inspiration",
    description:
      "Editing styles to follow, built in or the user's own. list; read: one's brief; use: this project follows it (settings and files come in; keepLook keeps the project's look, the default with a brand kit); stop; save: this project's copy as the user's own; measure: study a reference video's style (source) before writing one; write: save md as the user's own (use: follow it now). md starts <!-- inspiration {name, description, bestFor, energy 1-5, length, tags, reference, settings {captionStyle, checkRules, mix, music, look: only what the style decides}, files [\"captionLooks/<id>\"...] from the project} --> then the built-in ones' sections (read one first).",
    input: z.object({
      action: z.enum(["list", "read", "use", "stop", "save", "measure", "write"]),
      id: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,47}$/)
        .optional(),
      keepLook: z.boolean().optional(),
      source: z.string().max(64).optional().describe("measure: the reference clip"),
      md: z.string().min(200).max(40_000).optional().describe("write"),
      use: z.boolean().optional().describe("write"),
    }),
    async run({ action, id, keepLook, source, md, use }, ctx) {
      if (action === "measure" || action === "write") {
        const unread = needsGuide(ctx, "inspirations");
        if (unread) return unread;
      }
      const doc = ctx.scratch.doc;
      const store = ctx.host.inspirations;
      const keep = keepLook ?? Boolean(doc.meta.kit);
      const follow = (pack: InspirationPack) =>
        commit(
          ctx,
          `Inspiration: ${inspirationMeta(pack.md)?.name ?? pack.id}`,
          inspirationOps(doc, pack, { keepLook: keep }),
        );
      if (action === "measure") {
        const clip = await indexedClip(ctx, source);
        if (!clip) return { text: `No clip "${source ?? ""}".`, isError: true };
        if (clip.status === "pending" || clip.status === "indexing")
          return {
            text: `${clip.id} is still being indexed. Carry on with the rest of the request and measure it last.`,
            isError: true,
          };
        // The captions' pages come and go faster than indexing reads (once a second): read them again,
        // densely (up to 4 a second, about 400 frames at most), once a request.
        let read = ctx.scratch.read?.get(clip.id);
        if (!read && ctx.host.readText && clip.kind === "video") {
          const rate = Math.max(1, Math.min(4, Math.floor(400 / Math.max(1, clip.duration))));
          ctx.activity?.("Reading the words on screen…");
          const text = await ctx.host.readText(clip.id, rate).catch(() => null);
          if (text) {
            read = { text, rate };
            ctx.scratch.read ??= new Map();
            ctx.scratch.read.set(clip.id, read);
          }
        }
        let studied = ctx.scratch.studied?.get(clip.id);
        if (!studied && ctx.host.study && clip.kind === "video") {
          ctx.activity?.("Studying its motion and its beat…");
          studied =
            (await ctx.host
              .study(clip.id, (f) =>
                ctx.activity?.(`Studying its motion and its beat… ${Math.round(f * 100)}%`),
              )
              .catch((err: unknown) => {
                console.warn("[measure] studying it failed:", (err as Error).message);
                return null;
              })) ?? undefined;
          if (studied) {
            ctx.scratch.studied ??= new Map();
            ctx.scratch.studied.set(clip.id, studied);
          }
        }
        const report = measureReference(ctx.scratch.doc, clip.id, read, studied);
        return report
          ? { text: referenceText(report) }
          : { text: `${clip.id} isn't a video.`, isError: true };
      }
      if (action === "list") {
        const mine = (await store?.list().catch(() => [])) ?? [];
        const all = [
          ...mine,
          ...STARTER_INSPIRATIONS.flatMap((p) => {
            const info = inspirationInfo(p.id, p.md, "builtin");
            return info && !mine.some((m) => m.id === p.id) ? [info] : [];
          }),
        ];
        return {
          text:
            all
              .map(
                (i) =>
                  `${i.id}${i.id === doc.meta.inspiration ? " (followed)" : ""}: ${i.name} (${i.origin === "mine" ? "the user's" : "built in"}). ${i.description} For: ${i.bestFor.join(", ")}. Energy ${i.energy}/5. ${i.traits.join("; ")}.`,
              )
              .join("\n") || "No inspirations.",
        };
      }
      if (action === "stop") {
        const result = commit(ctx, "Stopped following the inspiration", stopInspirationOps(doc));
        return result.isError ? result : { text: "No longer following an inspiration; its settings stay." };
      }
      if (!id) return { text: "Give the inspiration's id.", isError: true };
      if (action === "write") {
        if (!md) return { text: "Give the md.", isError: true };
        const files: Record<string, { id: string }[]> = {};
        for (const ref of inspirationMeta(md)?.files ?? []) {
          const [coll, fileId] = ref.split("/") as [keyof ProjectDoc, string];
          const item = (doc[coll] as readonly { id: string }[]).find((x) => x.id === fileId);
          if (item) files[coll] = [...(files[coll] ?? []), item];
        }
        const pack: InspirationPack = { id, md, files: files as InspirationPack["files"] };
        const problem = validateInspiration(md, pack.files);
        if (problem) return { text: `Not saved: ${problem}`, isError: true };
        // The library can be unavailable (not started, a folder that moved): the project still gets it,
        // so the work is never lost, and it can be saved to the library later.
        let unsaved = store ? null : "saving inspirations isn't available here";
        if (store)
          await store.save(pack).catch((err: unknown) => {
            unsaved = (err as Error).message;
          });
        if (use || unsaved) {
          const result = follow(pack);
          if (result.isError) return result;
        } else ctx.step(`Saved inspiration "${inspirationMeta(md)!.name}"`);
        return {
          text: unsaved
            ? `Couldn't save it to the user's inspirations (${unsaved}). It's in this project (inspirations/${id}.md) and the project follows it; it can be saved to the library from the Inspirations view.`
            : `Saved to the user's inspirations${use ? "; this project follows it now" : ""}.`,
        };
      }
      const pack =
        (await store?.get(id).catch(() => null)) ??
        STARTER_INSPIRATIONS.find((p) => p.id === id) ??
        packFromProject(doc, id);
      if (!pack) return { text: `No inspiration "${id}".`, isError: true };
      if (action === "read") {
        const meta = inspirationMeta(pack.md);
        return {
          text: `${inspirationBrief(pack.md)}\n\nSettings: ${JSON.stringify(meta?.settings ?? {})}\nFiles: ${meta?.files.join(", ") || "none"}`,
        };
      }
      if (action === "save") {
        if (!store) return { text: "Saving inspirations isn't available here.", isError: true };
        const own = packFromProject(doc, id);
        if (!own) return { text: `This project has no copy of "${id}".`, isError: true };
        const problem = validateInspiration(own.md, own.files);
        if (problem) return { text: `Not saved: ${problem}`, isError: true };
        const info = await store.save(own);
        ctx.step(`Saved inspiration "${info.name}"`);
        return { text: `Saved "${info.name}" to the user's inspirations.` };
      }
      const result = follow(pack);
      if (result.isError) return result;
      return {
        text: `Following "${inspirationMeta(pack.md)?.name ?? id}"${keep ? " (its pattern; the project's look kept)" : ""}; its settings are applied. Edit to its brief:\n\n${inspirationBrief(pack.md)}`,
      };
    },
  }),
  tool({
    name: "read_style",
    description:
      "Read an effect, transition or grade file (effects/, transitions/, grades/<id>.css), to adapt it or learn the format before writing one.",
    input: z.object({ kind: z.enum(["effect", "transition", "grade"]), id: z.string() }),
    async run({ kind, id }, ctx) {
      const list = ctx.scratch.doc[STYLE_COLLECTION[kind]];
      const f = list.find((x) => x.id === id);
      return f
        ? { text: f.css }
        : { text: `No ${kind} "${id}". There are: ${list.map((x) => x.id).join(", ")}`, isError: true };
    },
  }),
  tool({
    name: "write_style",
    description:
      "Create or replace an effect, transition or grade: CSS saved as effects/, transitions/ or grades/<id>.css. Effects style .frame (the picture), .subject (the person alone, cut out automatically), .background (what's behind them) and .overlay; transitions style .out (the leaving shot), .in (the arriving one) and .overlay; a grade is its header's color (white balance, exposure, lift/gamma/gain, contrast, saturation, curves, a LUT), with .picture and .overlay CSS on top. Variables --t, --duration, --progress, --accent; animations run on the file's own clock. Use it when the user wants a move, a change between shots or a colour look the existing files don't give. Then place it (an effect's kind, a scene's transition.kind, or use: true for a grade) and look at it.",
    input: z.object({
      label: Label,
      kind: z.enum(["effect", "transition", "grade"]),
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lower-case letters, digits and dashes"),
      css: z.string().min(10).max(60_000),
      use: z.boolean().default(false).describe("For a grade: switch the video to it"),
    }),
    async run({ label, kind, id, css, use }, ctx) {
      const unread = needsGuide(ctx, "looks");
      if (unread) return unread;
      const problem = validateStyle(kind, css);
      if (problem) return { text: `Not saved: ${problem}`, isError: true };
      const lut = kind === "grade" ? gradeColorOf(css)?.lut : undefined;
      if (lut && !ctx.scratch.doc.luts.some((l) => l.file === lut))
        return {
          text: `Not saved: there's no luts/${lut}. ${ctx.scratch.doc.luts.length ? `The project has: ${ctx.scratch.doc.luts.map((l) => l.file).join(", ")}` : "The project has no LUTs; the user can drop .cube files into its luts/ folder"}.`,
          isError: true,
        };
      const coll = STYLE_COLLECTION[kind];
      const exists = ctx.scratch.doc[coll].some((f) => f.id === id);
      const ops: Op[] = [
        exists ? { op: "update", coll, id, patch: { css } } : { op: "insert", coll, item: { id, css } },
      ];
      if (use && kind === "grade") ops.push({ op: "merge", key: "look", patch: { grade: id } });
      const result = commit(ctx, label, ops);
      return result.isError ? result : { text: `Saved ${STYLE_DIR[kind]}/${id}.css.` };
    },
  }),
  tool({
    name: "look",
    description:
      "See frames. Give output times to see the finished video as it renders now (graphics, captions, motion and all, with any graphic errors). Give around (a cut's time) instead to see a strip of consecutive frames either side of it in one picture, with a red bar where the cut falls: that's how to check a cut, a flash, a black frame or a jump, which single stills miss. Give a graphic id (with params and layout) and times into it to see that graphic on its own over a shot, without placing it. Give a clip id with times in that clip to look at raw footage. Use it to find the best moments, check framing and verify your graphics. Up to 6 frames per call.",
    input: z.object({
      source: z.string().optional().describe("Clip id: look at raw footage at times in that clip"),
      graphic: z
        .string()
        .optional()
        .describe("Graphic id: look at it alone over a shot, times in seconds from its start"),
      params: z.record(z.string(), z.unknown()).optional().describe("The graphic's values, for graphic"),
      layout: z.enum(["overlay", "full", "split"]).optional().describe("For graphic; overlay by default"),
      shape: z
        .enum(SHAPES)
        .optional()
        .describe("See the video reframed in another shape (as export.formats would export it)"),
      cover: z
        .boolean()
        .optional()
        .describe(
          "See the cover image (cover.json) instead of the video, in shape if given; times are ignored",
        ),
      around: z
        .number()
        .min(0)
        .optional()
        .describe(
          "Output seconds of a cut (or any moment): a strip of 8 consecutive frames either side of it instead of times. Snaps to a cut within half a second",
        ),
      step: z
        .number()
        .int()
        .min(1)
        .max(15)
        .optional()
        .describe(
          "For around: frames between the strip's pictures; 1 (every frame) by default, 3-6 to see a longer stretch",
        ),
      times: z.array(z.number().min(0)).min(1).max(6).optional(),
    }),
    async run({ source, graphic, params, layout, shape, cover, around, step, times = [] }, ctx) {
      ctx.scratch.looks = (ctx.scratch.looks ?? 0) + 1;
      if (!times.length && !cover && (around === undefined || source || graphic))
        return {
          text: "Give times to look at (around is for the finished video: a strip at a cut).",
          isError: true,
        };
      if (graphic) {
        if (!ctx.host.stills) return { text: "Rendering is not available here.", isError: true };
        const preview = graphicPreviewDoc(ctx.scratch.doc, {
          graphic,
          ...(params && { params }),
          ...(layout && { layout }),
        });
        if (!preview) return { text: `No graphic "${graphic}", or no footage to show it on.`, isError: true };
        const inside = times.filter((t) => t < preview.duration);
        if (!inside.length)
          return { text: `${graphic} lasts ${preview.duration.toFixed(2)}s here.`, isError: true };
        const { images, errors } = await ctx.host.stills(preview.doc, inside);
        noteErrors(ctx, errors);
        ctx.step(`Looked at ${graphic} (${images.length} ${images.length === 1 ? "frame" : "frames"})`);
        return {
          text:
            `${graphic} on its own at ${inside
              .slice(0, images.length)
              .map((t) => `${t.toFixed(2)}s`)
              .join(", ")} into it${images.length < inside.length ? ` (the rest didn't render)` : ""}.` +
            (errors.length ? ` Errors: ${errors.join("; ")}` : " No errors."),
          images: images.map((b) => ({ data: b.toString("base64"), mediaType: "image/jpeg" as const })),
        };
      }
      const doc: ProjectDoc = shape
        ? {
            ...ctx.scratch.doc,
            meta: {
              ...ctx.scratch.doc.meta,
              format: { ...ctx.scratch.doc.meta.format, ...shapeSize(ctx.scratch.doc.meta.format, shape) },
            },
          }
        : ctx.scratch.doc;
      const tl = timelineOf(doc);
      if (around !== undefined && !source) {
        if (!ctx.host.stills) return { text: "Rendering is not available here.", isError: true };
        return lookAround(ctx, doc, around, step ?? 1);
      }
      if (cover) {
        if (!ctx.host.stills) return { text: "Rendering is not available here.", isError: true };
        if (!tl.scenes.length) return { text: "There's no footage to make a cover from yet.", isError: true };
        const { images, errors } = await ctx.host.stills(doc, [0], { composition: "Cover" });
        ctx.step(`Looked at the cover${shape ? ` (${shape})` : ""}`);
        return {
          text: images.length
            ? `The cover${shape ? ` in ${shape}` : ""}.${errors.length ? ` Errors: ${errors.join("; ")}` : ""}`
            : `The cover didn't render.${errors.length ? ` ${errors.join("; ")}` : ""}`,
          images: images.map((b) => ({ data: b.toString("base64"), mediaType: "image/jpeg" as const })),
        };
      }
      let renderFailure: string | null = null;
      if (!source && ctx.host.stills) {
        const inside = times.filter((t) => t < tl.duration);
        if (!inside.length) return { text: `The video is ${tl.duration.toFixed(2)}s long.`, isError: true };
        try {
          const { images, errors } = await ctx.host.stills(doc, inside);
          noteErrors(ctx, errors);
          ctx.step(`Looked at ${images.length} ${images.length === 1 ? "frame" : "frames"} of the video`);
          return {
            text:
              `Frames of the video${shape ? ` in ${shape}` : ""} at ${inside
                .slice(0, images.length)
                .map((t) => `${t.toFixed(2)}s`)
                .join(", ")}${images.length < inside.length ? ` (the rest didn't render)` : ""}.` +
              (errors.length ? ` Graphic errors: ${errors.join("; ")}` : ""),
            images: images.map((b) => ({ data: b.toString("base64"), mediaType: "image/jpeg" as const })),
          };
        } catch (err) {
          // Say so, then fall back to the footage under the cut.
          console.error("[look] rendering stills failed:", err);
          renderFailure = (err as Error).message.split("\n")[0]!.slice(0, 200);
        }
      }
      const targets = times.map((t) => {
        if (source) return { source, time: t, label: `${source} @ ${t.toFixed(2)}s` };
        const placed = sceneAt(tl, t);
        if (!placed) return null;
        return {
          source: placed.scene.source,
          time: sourceTime(placed, t),
          label: `${t.toFixed(2)}s (${placed.scene.id})`,
        };
      });
      const images: ToolImage[] = [];
      const labels: string[] = [];
      for (const target of targets) {
        if (!target) continue;
        const src = doc.sources.find((s) => s.id === target.source);
        if (!src || (src.kind !== "video" && src.kind !== "image")) {
          labels.push(`${target.label}: not footage`);
          continue;
        }
        try {
          const jpeg = await ctx.host.frame(target.source, target.time);
          images.push({ data: jpeg.toString("base64"), mediaType: "image/jpeg" });
          labels.push(target.label);
        } catch (err) {
          labels.push(`${target.label}: ${(err as Error).message}`);
        }
      }
      if (images.length) ctx.step(`Looked at ${images.length} ${images.length === 1 ? "frame" : "frames"}`);
      return {
        text: `${
          renderFailure
            ? `Couldn't render the video (${renderFailure}), so these are the raw footage under those moments, without graphics, captions or the crop. `
            : ""
        }Frames in order: ${labels.join("; ")}`,
        images,
      };
    },
  }),
  tool({
    name: "watch",
    description:
      "Watch a clip play: consecutive frames over a stretch, in sheets (left to right, then down) with their times. Shows what single frames can't: cuts, punch-ins, captions changing, transitions, graphics coming and going. Up to 48 frames a call: a hook at 6-12 a second, a whole short video at 1-2.",
    input: z.object({
      source: z.string(),
      from: z.number().min(0).default(0),
      to: z.number().min(0).optional(),
      fps: z.number().min(0.2).max(12).optional().describe("Unset: as many as fit 48"),
    }),
    async run({ source, from, to, fps }, ctx) {
      const src = ctx.scratch.doc.sources.find((s) => s.id === source);
      if (src?.kind !== "video") return { text: `No video clip "${source}".`, isError: true };
      const end = Math.min(to ?? src.duration, src.duration);
      if (end <= from) return { text: `${source} is ${src.duration.toFixed(1)}s long.`, isError: true };
      const rate = fps ?? Math.min(12, Math.max(0.2, WATCH_FRAMES / (end - from)));
      const times: number[] = [];
      for (let k = 0; times.length < WATCH_FRAMES; k++) {
        const t = from + k / rate;
        if (t >= end) break;
        times.push(Math.round(t * 100) / 100);
      }
      const portrait = (src.height ?? 0) > (src.width ?? 0);
      const width = portrait ? 216 : 320;
      // A few at a time from the preview copy (each a quick keyframe seek).
      const frames: Buffer[] = new Array(times.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          while (next < times.length) {
            const i = next++;
            frames[i] = await ctx.host.frame(src.id, times[i]!, width);
          }
        }),
      );
      const per = 12;
      const sheets: Buffer[] = [];
      const lines: string[] = [];
      for (let i = 0; i < frames.length; i += per) {
        sheets.push(await frameStrip(frames.slice(i, i + per), { width, columns: portrait ? 6 : 4 }));
        lines.push(
          `Sheet ${sheets.length}: ${times
            .slice(i, i + per)
            .map((t) => t.toFixed(2))
            .join(", ")}s`,
        );
      }
      const last = times.at(-1)!;
      ctx.step(`Watched ${source} ${from.toFixed(1)}-${Math.min(end, last + 1 / rate).toFixed(1)}s`);
      const picture = await ctx.host.keepPicture?.(sheets[0]!).catch(() => undefined);
      return {
        ...(picture && { shown: picture }),
        text: `${times.length} frames of ${source}, ${rate >= 1 ? `${Math.round(rate * 10) / 10} a second` : `one every ${(1 / rate).toFixed(1)}s`}, left to right then down:\n${lines.join("\n")}${last + 1 / rate < end - 0.01 ? `\nStopped at ${WATCH_FRAMES} frames: watch from ${(last + 1 / rate).toFixed(2)}s for the rest.` : ""}`,
        images: sheets.map((b) => ({ data: b.toString("base64"), mediaType: "image/jpeg" as const })),
      };
    },
  }),
  tool({
    name: "compare",
    description:
      "The reference's frames on top, this edit at matching moments below, following an inspiration (its id) without changing the edit; at unset: where someone's talking. Fix what differs, write the inspiration again, compare again.",
    input: z.object({
      source: z.string().describe("The reference"),
      times: z.array(z.number().min(0)).min(1).max(4),
      at: z.array(z.number().min(0)).max(4).optional(),
      inspiration: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,47}$/)
        .optional(),
    }),
    async run({ source, times, at, inspiration }, ctx) {
      if (!ctx.host.stills) return { text: "Rendering isn't available here.", isError: true };
      const ref = ctx.scratch.doc.sources.find((s) => s.id === source);
      if (ref?.kind !== "video") return { text: `No video clip "${source}".`, isError: true };
      let doc = ctx.scratch.doc;
      let following = "";
      if (inspiration) {
        const pack =
          (await ctx.host.inspirations?.get(inspiration).catch(() => null)) ??
          STARTER_INSPIRATIONS.find((p) => p.id === inspiration) ??
          null;
        if (!pack) return { text: `No inspiration "${inspiration}".`, isError: true };
        try {
          doc = applyOps(doc, inspirationOps(doc, pack, { keepLook: false })).doc;
        } catch (err) {
          return { text: `${inspiration} can't be followed: ${(err as Error).message}`, isError: true };
        }
        following = ` following ${inspirationMeta(pack.md)?.name ?? inspiration}`;
      }
      // Nothing cut yet: the reference itself stands in as the footage.
      const standIn = !doc.scenes.length;
      if (standIn)
        doc = applyOps(doc, [
          {
            op: "insert",
            coll: "scenes",
            item: { id: "compare", source, in: 0, out: ref.duration } as never,
          },
        ]).doc;
      const tl = timelineOf(doc);
      // Where someone's talking, spread over the edit, so the captions show.
      const said = spokenWords(doc).filter((w) => w.start < tl.duration);
      const moments = times.map((_, i) => {
        const given = at?.[i];
        if (given !== undefined) return Math.min(given, Math.max(0, tl.duration - 0.05));
        if (said.length) return said[Math.floor(((i + 0.5) * said.length) / times.length)]!.start + 0.15;
        return (tl.duration * (i + 0.5)) / times.length;
      });
      const [theirs, ours] = await Promise.all([
        Promise.all(times.map((t) => ctx.host.frame(source, Math.min(t, ref.duration - 0.05), 432))),
        ctx.host.stills(doc, moments, { scale: 0.4 }),
      ]);
      noteErrors(ctx, ours.errors);
      if (ours.images.length < moments.length)
        return {
          text: `This edit didn't render.${ours.errors.length ? ` ${ours.errors.join("; ")}` : ""}`,
          isError: true,
        };
      ctx.scratch.looks = (ctx.scratch.looks ?? 0) + 1;
      const tall = (ref.height ?? 0) > (ref.width ?? 0);
      const sheet = await frameStrip([...theirs, ...ours.images], {
        width: tall ? 240 : 360,
        columns: times.length,
      });
      ctx.step(`Compared with ${source}${following}`);
      const picture = await ctx.host.keepPicture?.(sheet).catch(() => undefined);
      return {
        ...(picture && { shown: picture }),
        text: `Top: ${source} at ${times.map((t) => t.toFixed(2)).join(", ")}s. Bottom: this edit${following} at ${moments.map((t) => t.toFixed(2)).join(", ")}s${standIn ? " (nothing's cut yet, so the reference stands in: its own captions are burned in, and this style's are drawn over them)" : ""}. Compare caption size, place, case, font and colours, the grade, and graphics.${ours.errors.length ? ` Graphic errors: ${ours.errors.join("; ")}` : ""}`,
        images: [{ data: sheet.toString("base64"), mediaType: "image/jpeg" }],
      };
    },
  }),
  tool({
    name: "track",
    description:
      "Track every face and person, frame by frame, over a shot (or a stretch of a clip), so a graphic can follow one of them: set the visual's follow {source, track, side} and use a graphic that reads --follow-x/--follow-y (name-tag does, lower-third too). Returns each track with where it is and how big; look at the shot to tell who is who. Tracks end at shot changes inside the footage. Following works for a cutaway as well: track its clip with source, from and to.",
    input: z.object({
      scene: z.string().optional().describe("A shot in the cut: tracks its whole stretch of footage"),
      source: z.string().optional().describe("Or a clip, with from and to in its own time"),
      from: z.number().min(0).optional(),
      to: z.number().min(0).optional(),
    }),
    async run({ scene, source, from, to }, ctx) {
      if (!ctx.host.track) return { text: "Tracking is not available on this machine.", isError: true };
      const doc = ctx.scratch.doc;
      const sc = scene ? doc.scenes.find((s) => s.id === scene) : undefined;
      if (scene && !sc) return { text: `No shot "${scene}".`, isError: true };
      const src = sc?.source ?? source;
      const a = sc ? sc.in : from;
      const b = sc ? sc.out : to;
      if (!src || a === undefined || b === undefined || b <= a)
        return { text: "Give a scene, or a source with from < to.", isError: true };
      await indexedClip(ctx, src);
      const prefix = `t${Math.round(a * 10)}_`;
      const tracks = await ctx.host.track(src, a, b, prefix);
      const analysis = ctx.scratch.doc.analyses.find((x) => x.id === src);
      if (!analysis) return { text: `${src} has no analysis yet (still indexing?).`, isError: true };
      // New tracks replace any earlier ones over the same stretch.
      const kept = (analysis.tracks ?? []).filter((t) => t.end < a || t.start > b);
      const result = commit(ctx, `Track ${sc ? sc.id : src}`, [
        { op: "update", coll: "analyses", id: src, patch: { tracks: [...kept, ...tracks] } },
      ]);
      if (result.isError) return result;
      if (!tracks.length) return { text: "No faces or people found there." };
      const r = (n: number) => n.toFixed(2);
      const lines = tracks.map((t) => {
        const p0 = t.points[0]!;
        const p1 = t.points.at(-1)!;
        const size = t.points.reduce((s, p) => s + p.w, 0) / t.points.length;
        return `${t.id} ${t.kind} ${r(t.start)}-${r(t.end)}s (source time): centre x ${r(p0.x)}→${r(p1.x)}, y ${r(p0.y)}→${r(p1.y)}, width ${r(size)}`;
      });
      ctx.step(`Tracked ${tracks.length} ${tracks.length === 1 ? "face or person" : "faces and people"}`);
      return {
        text: `Tracks in ${src} (positions are fractions of the clip's frame; the biggest face is usually the subject):\n${lines.join("\n")}`,
      };
    },
  }),
  tool({
    name: "get_shots",
    description:
      "Read what a clip shows, shot by shot (the visual transcript): shot type, camera move, energy, highlights and a description, in source time, plus loud stretches with no speech, the words seen on screen (signs, slides, screens, captions already burned in) and where, the best-looking moments, and moments the face is weak (a blink). Use it to find b-roll, reactions and action without looking at every frame.",
    input: z.object({
      source: z.string(),
      from: z.number().min(0).optional().describe("Seconds into the clip"),
      to: z.number().min(0).optional(),
    }),
    async run({ source, from, to }, ctx) {
      return { text: shotsView(ctx.scratch.doc, source, from, to) };
    },
  }),
  tool({
    name: "search_footage",
    description:
      "Find clips by what is in them, moments by what is said (clip, word index, time) and shots by what they show (clip, start, end, energy).",
    input: z.object({ query: z.string().min(1).max(200) }),
    async run({ query }, ctx) {
      return { text: JSON.stringify(searchFootage(ctx.scratch.doc, query)) };
    },
  }),
  tool({
    name: "find_music",
    description:
      "Find a royalty-free instrumental for a mood (upbeat, tech, lofi, chill, hiphop, afrobeats, tense, cinematic, emotional, corporate), add it to the project with its beat map, and set it as the music. Use only when the user wants music and has none of their own.",
    input: z.object({ label: Label, mood: z.string().min(2).max(40) }),
    async run({ label, mood }, ctx) {
      const unread = needsGuide(ctx, "sound");
      if (unread) return unread;
      if (!ctx.host.findMusic) return { text: "Music search is not available here.", isError: true };
      const found = await ctx.host.findMusic(mood, ctx.scratch.doc);
      if (!found) return { text: `No usable track found for "${mood}". Try another mood.`, isError: true };
      const result = commit(ctx, label, found.ops);
      return result.isError
        ? result
        : { text: `Added "${found.title}"${found.bpm ? ` (${found.bpm} BPM)` : ""} as music.` };
    },
  }),
  tool({
    name: "listen",
    description:
      "Hear a clip's sound: what's in it (laughter, applause, cheering, a crowd, a gasp, music, whispering... with times, from on-device sound recognition), a track's instruments, the words said hardest (louder, higher or drawn out), and its level over time as bars with its sections (quiet, build, full), where it gets going and where it hits hardest, with tempo and beats for music. Use it before placing music (does its character fit: instruments, energy; start it where it gets going, land the hit on the moment), to find the laugh or the applause, and on speech to see where the speaker leans in. Defaults to the project's music.",
    input: z.object({
      source: z.string().optional().describe("A clip id; the music track when omitted"),
      from: z.number().min(0).optional().describe("Seconds in the clip"),
      to: z.number().min(0).optional(),
    }),
    async run({ source, from, to }, ctx) {
      const doc = ctx.scratch.doc;
      const id = source ?? doc.music.source ?? doc.sources.find((s) => s.kind === "audio")?.id;
      const src = id ? doc.sources.find((s) => s.id === id) : undefined;
      if (!src)
        return { text: source ? `No clip "${source}".` : "There's no music in the project.", isError: true };
      // A GIF made into a clip, a photo, silent stock: nothing to hear, and that's the answer.
      if (src.kind === "image" || src.kind === "solid" || src.hasAudio === false)
        return {
          text: `${src.id} "${src.label}" has no sound (a silent ${src.kind === "video" ? "clip" : src.kind}), so there's nothing to hear. If its moment needs sound, add a sound effect.`,
        };
      if (!ctx.host.peaks) return { text: "Listening isn't available here.", isError: true };
      const peaks = await ctx.host.peaks(src.id, doc).catch(() => null);
      if (!peaks?.length) return { text: `${src.id}'s sound couldn't be measured.`, isError: true };
      const a = doc.analyses.find((x) => x.id === src.id);
      const shape = soundShape(peaks, {
        from: from ?? 0,
        ...(to !== undefined && { to }),
        step: (to ?? src.duration) - (from ?? 0) > 60 ? 1 : 0.25,
        ...(a?.beats && { beats: a.beats }),
      });
      const head = [
        `${src.id} "${src.label}", ${src.duration.toFixed(1)}s`,
        a?.bpm
          ? `${a.bpm} BPM, ${a.beats?.length ?? 0} beats, downbeats at ${(a.downbeats ?? [])
              .slice(0, 12)
              .map((b) => b.toFixed(2))
              .join(", ")}${(a.downbeats?.length ?? 0) > 12 ? "..." : ""}`
          : "",
        a?.loudness !== undefined ? `Integrated loudness ${a.loudness} LUFS` : "",
      ].filter(Boolean);
      // What it heard (on-device sound recognition, at import), in this stretch.
      const lo = from ?? 0;
      const hi = to ?? src.duration;
      const sounds = (a?.sounds ?? []).filter(
        (x) => x.end > lo && x.start < hi && !(x.label === "music" && src.kind === "audio"),
      );
      const heard = sounds.length
        ? `Heard: ${sounds
            .slice(0, 30)
            .map((x) => `${x.label} ${x.start.toFixed(1)}-${x.end.toFixed(1)}s`)
            .join(", ")}${sounds.length > 30 ? "..." : ""}`
        : a?.sounds
          ? "Heard: nothing but the main sound (no laughter, applause, crowd or other events)"
          : "";
      const instruments = a?.instruments?.length
        ? `Instruments: ${a.instruments.map((i) => `${i.name} (${Math.round(i.share * 100)}% of it)`).join(", ")}`
        : "";
      // How the voice moves: the words said hardest in this stretch.
      const t = doc.transcripts.find((x) => x.id === src.id);
      const hard = (t?.words ?? [])
        .map((w, i) => ({ ...w, i }))
        .filter((w) => w.start >= lo && w.end <= hi && (w.stress ?? 0) >= 0.85)
        .sort((p, q) => (q.stress ?? 0) - (p.stress ?? 0))
        .slice(0, 12)
        .sort((p, q) => p.start - q.start);
      const voice = hard.length
        ? `Said hardest (louder, higher or drawn out): ${hard.map((w) => `"${w.text}" [${w.i}] ${w.start.toFixed(1)}s`).join(", ")}`
        : "";
      return {
        text: [head.join("\n"), [instruments, heard, voice].filter(Boolean).join("\n"), describeSound(shape)]
          .filter(Boolean)
          .join("\n\n"),
      };
    },
  }),
  tool({
    name: "cutout",
    description:
      "Cut the person out of every shot that needs it now (a scene.background change, or a visual or title with behindSubject), so the subject layer draws them over what's behind them. Cutouts are also made automatically in the background; call this after setting those fields and before you look at frames, so the frames show the result. About 6 seconds per second of footage, once (cached).",
    input: z.object({ label: Label }),
    async run({ label }, ctx) {
      if (!ctx.host.cutouts)
        return { text: "Cutouts aren't available here (they need macOS).", isError: true };
      const ops = await ctx.host.cutouts(ctx.scratch.doc);
      if (!ops.length) return { text: "Every shot that needs a cutout already has one (or none needs one)." };
      const result = commit(ctx, label, ops);
      return result.isError
        ? result
        : { text: `Cut out the person in ${ops.length} ${ops.length === 1 ? "clip" : "clips"}.` };
    },
  }),
  tool({
    name: "steady_and_smooth",
    description:
      "Make what steadied and slowed shots need now: a steadied shot's (scene.stabilize) camera path, and a slowed shot's in-between frames (speed under 1 or a ramp, slower than its footage has frames for). Both are also made automatically in the background; call this after setting them and before you look at frames, so the frames show the result. Steadying takes a second or two; smooth slow motion about 5 to 20 seconds per second of slowed footage, once (cached).",
    input: z.object({ label: Label }),
    async run({ label }, ctx) {
      if (!ctx.host.footage) return { text: "Not available here.", isError: true };
      const ops = await ctx.host.footage(ctx.scratch.doc);
      if (!ops.length) return { text: "Every steadied and slowed shot is already made (or there are none)." };
      const result = commit(ctx, label, ops);
      return result.isError
        ? result
        : {
            text: `Made the steadied and slowed footage of ${ops.length} ${ops.length === 1 ? "clip" : "clips"}.`,
          };
    },
  }),
  tool({
    name: "process_media",
    description: `Process the project's clips with ffmpeg, for what nothing else here does: write a filter graph, and get a new clip (make) or numbers back (measure). The inputs are clips by id (up to 4, each trimmed with in/out seconds into it), [0:v] [0:a] [1:v]... in the graph; label the final outputs [v] (picture) and [a] (sound), and leave out [a] for a silent result. kind: video (an .mp4; alpha: true makes a see-through .webm, after a key), audio, or image (one frame, a .png). The new clip joins the project (place it with apply_ops); the same recipe gives back the same clip, and clips list their recipes. It takes about as long as the clip: trim inputs to what you need.
Some recipes: reverse ([0:v]reverse[v];[0:a]areverse[a]; keep it under a minute) and a boomerang (split, reverse, concat); green screen ([0:v]chromakey=0x00FF00:0.15:0.05,despill=green,format=yuva420p[v] with alpha); an audiogram ([0:a]asplit[w][a];[w]showwaves=s=1080x480:mode=cline:rate=30:colors=white[v]); a voice higher or lower (asetrate=44100*1.4,aresample=44100,atempo=1/1.4) or with echo (aecho); denoise (hqdn3d, nlmeans), sharpen (cas), deflicker; a fixed logo hidden (delogo); a still (kind image); a timelapse (setpts). Not here: filters reading or writing files (movie, lut3d, drawtext, subtitles, file=), plugins, models, hardware-only filters. Text is the project's titles, not ffmpeg's.
measure: true returns what the filters report instead: signalstats with metadata=print (YAVG, UAVG, VAVG, SATAVG: levels and colour, to match shots or check exposure), blackdetect, freezedetect, silencedetect, astats, ebur128, cropdetect, idet. Sample with fps=1 or select first: the report keeps 300 lines.`,
    input: z.object({
      label: Label,
      inputs: z
        .array(
          z.object({
            source: z.string().describe("A clip id"),
            in: z.number().nonnegative().optional().describe("Seconds into the clip; its start when unset"),
            out: z.number().nonnegative().optional().describe("Seconds into the clip; its end when unset"),
          }),
        )
        .min(1)
        .max(4),
      graph: z
        .string()
        .min(1)
        .max(4000)
        .describe("An ffmpeg filter graph, final outputs labelled [v] and [a]"),
      measure: z
        .boolean()
        .default(false)
        .describe("Report what the filters measure instead of making a clip"),
      kind: z.enum(["video", "audio", "image"]).default("video"),
      alpha: z.boolean().default(false).describe("A see-through video (after a key)"),
      name: z.string().min(1).max(120).optional().describe("The new clip's name; the label when unset"),
    }),
    async run({ label, inputs, graph, measure, kind, alpha, name }, ctx) {
      const doc = ctx.scratch.doc;
      for (const i of inputs) {
        const s = doc.sources.find((x) => x.id === i.source);
        if (!s) return { text: `There's no clip ${i.source}.`, isError: true };
        if (i.out !== undefined && i.out <= (i.in ?? 0))
          return { text: `${i.source}: out (${i.out}) must come after in (${i.in ?? 0}).`, isError: true };
        if (s.duration > 0 && (i.in ?? 0) >= s.duration)
          return {
            text: `${i.source} is ${s.duration.toFixed(2)}s long: in is past its end.`,
            isError: true,
          };
      }
      const recipe = ProcessRecipe.parse({ inputs, graph, kind, ...(alpha && { alpha: true }) });
      if (measure) {
        if (!ctx.host.measureMedia) return { text: "Processing media isn't available here.", isError: true };
        try {
          return { text: await ctx.host.measureMedia(recipe, doc) };
        } catch (err) {
          return { text: `Couldn't measure: ${(err as Error).message}`, isError: true };
        }
      }
      if (!ctx.host.makeMedia) return { text: "Processing media isn't available here.", isError: true };
      let made: { ops: Op[]; source: Source };
      try {
        made = await ctx.host.makeMedia(recipe, name ?? label, doc);
      } catch (err) {
        return { text: `Not made: ${(err as Error).message}`, isError: true };
      }
      const s = made.source;
      const what = `${s.kind}${s.width ? ` ${s.width}x${s.height}` : ""}${s.duration ? `, ${s.duration.toFixed(2)}s` : ""}${s.kind === "video" ? (s.hasAudio ? ", with sound" : ", silent") : ""}`;
      if (!made.ops.length) return { text: `That recipe made ${s.id} before (${what}): use it.` };
      const result = commit(ctx, label, made.ops);
      return result.isError ? result : { text: `Made ${s.id} (${what}). Place it with apply_ops.` };
    },
  }),
  tool({
    name: "fit_music",
    description:
      "Fit the music to the video's length: picks the best part of the track (a stretch as long as the video with no quiet or flat spots), or, when the track is shorter, the best seamless loop (whole bars, downbeat to downbeat) and loops it. Sets music.section and music.loop. Call it once, when the music goes in: if the cut's length changes afterwards, the music is refitted by itself when you finish. Never fake a loop by stacking copies of the track as music clips.",
    input: z.object({
      label: Label,
      mode: z
        .enum(["auto", "part", "loop"])
        .default("auto")
        .describe("auto: one stretch if the track is long enough, else a loop; part or loop to force one"),
    }),
    async run({ label, mode }, ctx) {
      const doc = ctx.scratch.doc;
      const length = timelineOf(doc).duration;
      if (
        mode === "auto" &&
        doc.music.section &&
        doc.music.fitted !== undefined &&
        Math.abs(doc.music.fitted - length) <= 1
      )
        return {
          text: `Already fitted for this length (${length.toFixed(1)}s): ${doc.music.section.start}-${doc.music.section.end}s${doc.music.loop ? ", looping" : ""}. It refits itself at the end if the cut's length changes.`,
        };
      const fit = await fitMusic(ctx, mode);
      if ("error" in fit) return { text: fit.error, isError: true };
      const result = commit(ctx, label, fit.ops);
      return result.isError ? result : { text: fit.text };
    },
  }),
  tool({
    name: "find_stock",
    description:
      "Search Pexels and Pixabay for stock footage (or photos) to cut to: returns numbered candidates and a contact sheet of them (left to right, top to bottom in list order). Look at the sheet and pick only a shot that truly shows what's being said; generic filler (glowing brains, typing hands) makes a piece look cheap, so search again with a concrete query or skip it. Then add_stock.",
    input: z.object({
      query: z
        .string()
        .min(2)
        .max(100)
        .describe("What should be on screen, concretely: 'server room racks', 'phone app store'"),
      kind: z.enum(["video", "photo"]).default("video"),
      orientation: z.enum(["portrait", "landscape", "any"]).default("any"),
    }),
    async run({ query, kind, orientation }, ctx) {
      if (!ctx.host.findStock) return { text: "Stock footage isn't available here.", isError: true };
      const { candidates, sheet } = await ctx.host.findStock(query, kind, orientation);
      if (!candidates.length)
        return { text: `Nothing on Pexels or Pixabay for "${query}". Try other words.` };
      ctx.scratch.stock ??= new Map();
      for (const c of candidates) ctx.scratch.stock.set(c.id, c);
      ctx.step(`Searched stock for "${query}"`);
      const lines = candidates.map(
        (c, i) =>
          `${i + 1}. ${c.id} · ${c.width}x${c.height}${c.duration ? ` · ${c.duration}s` : ""} · ${c.about.slice(0, 90)}`,
      );
      return {
        text: `Candidates (pass the id to add_stock):\n${lines.join("\n")}`,
        ...(sheet && { images: [{ data: sheet.toString("base64"), mediaType: "image/jpeg" as const }] }),
      };
    },
  }),
  tool({
    name: "add_stock",
    description:
      "Download a find_stock candidate into the project as a clip, with its source and licence recorded. Returns its source id: then place it (usually a cutaway over the line it illustrates, its in point at a moment that moves).",
    input: z.object({ label: Label, id: z.string().min(3).max(60) }),
    async run({ label, id }, ctx) {
      const c = ctx.scratch.stock?.get(id);
      if (!c)
        return { text: `No candidate "${id}" from find_stock in this request. Search first.`, isError: true };
      if (!ctx.host.addStock) return { text: "Stock footage isn't available here.", isError: true };
      const added = await ctx.host.addStock(c, label, ctx.scratch.doc);
      const result = commit(ctx, label, added.ops);
      return result.isError
        ? result
        : {
            text: `Added ${c.kind} ${added.id} (${c.width}x${c.height}${c.duration ? `, ${c.duration}s` : ""}, ${c.provider}).`,
          };
    },
  }),
  tool({
    name: "search_library",
    description:
      'The user\'s own asset library: the sounds, music and memes they keep (their shared library and this project\'s assets/ folder), with names, tags, descriptions and roles ("impact", "sting.awkward", "sticker.kai": the asset they want for that job). Search it FIRST, before find_sound, find_music or find_meme: what they put here is what they want. An empty query lists everything (with every role); a role name finds the asset that fills it.',
    input: z.object({
      query: z
        .string()
        .max(200)
        .optional()
        .describe('Words or a role: "boom", "reaction sting", "kai", "impact"'),
      kind: z.enum(["sound", "music", "meme"]).optional(),
      limit: z.number().int().min(1).max(60).optional().describe("Default 25"),
    }),
    async run({ query, kind, limit }, ctx) {
      if (!ctx.host.library) return { text: "The library isn't available here.", isError: true };
      const { assets, roles } = await ctx.host.library.search();
      if (!assets.length)
        return {
          text: "The user's library is empty. They can drop files into it from the Library tab (or Finder); until then use find_sound, find_music and find_meme.",
        };
      const found = searchAssets(assets, query ?? "", kind).slice(0, limit ?? 25);
      const roleLine = Object.keys(roles).length
        ? `Roles: ${Object.entries(roles)
            .map(([r, id]) => `${r} → ${id}`)
            .join(", ")}`
        : "No roles set yet.";
      return {
        text: found.length
          ? `${found.length} of ${assets.length} assets${query ? ` for "${query}"` : ""}:\n${found.map(assetLine).join("\n")}\n${roleLine}\nAdd one with add_from_library.`
          : `Nothing in the library matches "${query}"${kind ? ` (${kind})` : ""}. ${roleLine} Try other words, or the web searches.`,
      };
    },
  }),
  tool({
    name: "add_from_library",
    description:
      'Brings a library asset into the project as a clip and returns its clip id. Then place it with apply_ops: a sound as an sfx with that source (duration to trim it), a track as music.source (merge), a meme as a visual with content kind "media" (style "sticker" when it\'s see-through, "card" otherwise). Adding the same asset twice reuses the clip.',
    input: z.object({ label: Label, asset: z.string().describe("The asset id from search_library") }),
    async run({ label, asset }, ctx) {
      if (!ctx.host.library) return { text: "The library isn't available here.", isError: true };
      const { assets } = await ctx.host.library.search();
      const a = assets.find((x) => x.id === asset);
      if (!a) return { text: `No asset "${asset}". Use an id from search_library.`, isError: true };
      const { ops, id } = await ctx.host.library.use(asset, ctx.scratch.doc);
      if (ops.length) {
        const result = commit(ctx, label, ops);
        if (result.isError) return result;
      }
      const how =
        a.kind === "sound"
          ? `Place it as an sfx: {"source": "${id}", ...} at the moment, volume about 0.8.`
          : a.kind === "music"
            ? `Make it the music: merge {"source": "${id}"} into music (set offset or section for where it starts).`
            : `Show it as a visual: content {"kind": "media", "source": "${id}", "style": "${a.alpha ? "sticker" : "card"}"}, beside the face.`;
      return { text: `"${a.name}" is clip ${id}. ${how}` };
    },
  }),
  tool({
    name: "update_library",
    description:
      'Remembers something about a library asset for every future edit: a better name, a description, tags, or a role ("impact", "sting.awkward", "sticker.kai"). Use it when the user says "that\'s my reaction sting", "call this the bruh sound", or when you learn what an asset is for. Roles are how the user says which asset to use for a job.',
    input: z.object({
      asset: z.string().describe("The asset id"),
      name: z.string().max(120).optional(),
      description: z.string().max(400).optional(),
      tags: z.array(z.string().max(40)).max(24).optional(),
      role: z.string().max(60).optional().describe("Give the asset this role (taking it from any other)"),
      clear_role: z.string().max(60).optional().describe("Take this role away, so no asset has it"),
    }),
    async run({ asset, name, description, tags, role, clear_role }, ctx) {
      if (!ctx.host.library) return { text: "The library isn't available here.", isError: true };
      try {
        if (name !== undefined || description !== undefined || tags !== undefined)
          await ctx.host.library.update(asset, {
            ...(name !== undefined && { name }),
            ...(description !== undefined && { description }),
            ...(tags !== undefined && { tags }),
          });
        if (role) await ctx.host.library.setRole(role, asset);
        if (clear_role) await ctx.host.library.setRole(clear_role, null);
      } catch (err) {
        return { text: (err as Error).message, isError: true };
      }
      ctx.step(role ? `Library: ${asset} is now "${role}"` : `Library: updated ${asset}`);
      return { text: "Saved in the library." };
    },
  }),
  tool({
    name: "keep_in_library",
    description:
      'Keeps a clip this project uses (a song, sound, meme, image or short clip the user dropped or attached, or one you found) in the user\'s shared library, so every future project can use it, optionally with a name and a role. Use it when the user says "keep this", "save this song for later", "this is my usual bed". Long footage stays in the project.',
    input: z.object({
      source: z.string().describe("The clip id in this project"),
      name: z.string().max(120).optional(),
      role: z.string().max(60).optional().describe('e.g. "music.bed", "impact", "sticker.kai"'),
    }),
    async run({ source, name, role }, ctx) {
      if (!ctx.host.library) return { text: "The library isn't available here.", isError: true };
      try {
        const [id] = await ctx.host.library.keep([source], ctx.scratch.doc);
        if (!id) return { text: "Nothing was kept.", isError: true };
        if (name) await ctx.host.library.update(id, { name });
        if (role) await ctx.host.library.setRole(role, id);
        ctx.step(`Kept ${name ?? source} in your library${role ? ` as "${role}"` : ""}`);
        return { text: `Kept as library asset ${id}${role ? ` with the role "${role}"` : ""}.` };
      } catch (err) {
        return { text: (err as Error).message, isError: true };
      }
    },
  }),
  tool({
    name: "find_meme",
    description:
      'Search KLIPY for meme media: "gif" (reaction GIFs), "sticker" (see-through, animated), "clip" (short meme video moments, some with sound) or "meme" (a static meme image). Search by the reaction, not the topic: "shocked", "facepalm", "side eye", "mind blown", "nope", "slow clap", "crying laughing". Returns numbered candidates and a contact sheet (left to right, top to bottom). Pick one that lands the joke at that moment, then add_meme.',
    input: z.object({
      query: z.string().min(2).max(80),
      kind: z.enum(["gif", "sticker", "clip", "meme"]).default("gif"),
    }),
    async run({ query, kind }, ctx) {
      if (!ctx.host.findMemes) return { text: "Meme search isn't available here.", isError: true };
      const { candidates, sheet } = await ctx.host.findMemes(query, kind);
      if (!candidates.length)
        return { text: `No ${kind}s on KLIPY for "${query}". Try another reaction word.` };
      ctx.scratch.memes ??= new Map();
      for (const c of candidates) ctx.scratch.memes.set(c.id, c);
      ctx.step(`Searched KLIPY for "${query}"`);
      const lines = candidates.map(
        (c, i) => `${i + 1}. ${c.id} · ${c.width}x${c.height} · ${c.title.slice(0, 80)}`,
      );
      return {
        text: `Candidates (pass the id to add_meme):\n${lines.join("\n")}`,
        ...(sheet && { images: [{ data: sheet.toString("base64"), mediaType: "image/jpeg" as const }] }),
      };
    },
  }),
  tool({
    name: "add_meme",
    description:
      'Download a find_meme candidate into the project as a clip (an image for a static meme), credited to KLIPY. Returns its source id: place it as a visual with content {"kind": "media", "source": id, "box": {x, y, width}, "style": "card" or "sticker", "rotate"}, short (1-2.5s), right on the beat it reacts to.',
    input: z.object({ label: Label, id: z.string().min(3).max(60) }),
    async run({ label, id }, ctx) {
      const unread = needsGuide(ctx, "sound");
      if (unread) return unread;
      const c = ctx.scratch.memes?.get(id);
      if (!c)
        return { text: `No candidate "${id}" from find_meme in this request. Search first.`, isError: true };
      if (!ctx.host.addMeme) return { text: "Meme search isn't available here.", isError: true };
      const added = await ctx.host.addMeme(c, label, ctx.scratch.doc);
      const result = commit(ctx, label, added.ops);
      return result.isError
        ? result
        : { text: `Added ${c.kind} ${added.id} (${c.width}x${c.height}, "${c.title}", KLIPY).` };
    },
  }),
  tool({
    name: "inspect_motion",
    description:
      "Measure the finished video's motion from rendered frames (about a second of work per second of video): graphics that flicker for a frame, pop on or vanish with no motion (or have their exit cut off), stop dead with no ease, stutter mid-move, run off the frame's edge, cover the speaker's face or sit under the platform's buttons, and entries off the music's beat. Run it once the graphics are placed, fix what it finds, and run it once more to confirm (at most twice a request; an unchanged edit answers at once).",
    input: z.object({}),
    async run(_input, ctx) {
      if (!ctx.host.senseMotion) return { text: "Motion measuring isn't available here.", isError: true };
      const r = await ctx.host.senseMotion(ctx.scratch.doc);
      const m = r.metrics;
      ctx.step(
        `Inspected motion: ${r.issues.length ? `${r.issues.length} to fix` : "clean"}`,
        r.issues.length ? "warn" : "done",
      );
      const lines = r.issues.map(
        (i) =>
          `${i.start.toFixed(2)}s${i.end > i.start ? `-${i.end.toFixed(2)}s` : ""} ${i.kind}${i.items.length ? ` (${i.items.join(", ")})` : ""}: ${i.detail}`,
      );
      return {
        text: [
          r.issues.length ? `${r.issues.length} issues:` : "No motion issues found.",
          ...lines,
          "",
          `${m.entries} graphic entries${m.onBeat !== null ? `, ${m.onBeat} on the beat` : ""}; graphics on screen ${m.graphicSeconds}s${m.faces ? `; over the face ${m.faceCovered}s` : "; no faces found to check against"}.`,
        ].join("\n"),
      };
    },
  }),
  tool({
    name: "inspect_joins",
    description:
      "Listen to every cut in the dialogue the way a dialogue editor does, from the audio either side (a second or so per cut): the level jumping, the voice's pitch jumping mid-thought (two takes that sound stitched), the room's background stepping between recordings, a pause too short after a sentence (rushed) or too long mid-thought (drags), and cuts that land while the voice is still sounding. Run it after the cut is clean (clean_cuts), fix what it finds (move the cut to a pause, end on the complete sentence, set the shot's crossfade, choose another take, set a shot's volume to even a level jump), then run it once more to confirm. Thresholds: checkRules.joins.",
    input: z.object({}),
    async run(_input, ctx) {
      if (!ctx.host.measureJoins) return { text: "Join measuring isn't available here.", isError: true };
      const joins = await ctx.host.measureJoins(ctx.scratch.doc);
      const rough = joins.filter((j) => j.problems.length);
      ctx.step(
        `Inspected ${joins.length} cuts: ${rough.length ? `${rough.length} to fix` : "all smooth"}`,
        rough.length ? "warn" : "done",
      );
      if (!joins.length) return { text: "No cuts between dialogue to inspect." };
      const fmt = (n: number | null, unit: string) => (n === null ? "?" : `${n > 0 ? "+" : ""}${n}${unit}`);
      return {
        text: [
          rough.length
            ? `${rough.length} of ${joins.length} cuts sound rough:`
            : `All ${joins.length} cuts sound smooth.`,
          ...rough.map(
            (j) =>
              `${j.time.toFixed(2)}s into ${j.scene} (level ${fmt(j.loudness, " dB")}, pitch ${fmt(j.melody, " st")}${j.room !== null ? `, room ${fmt(j.room, " dB")}` : ""}, pause ${j.pause}s${j.sentenceEnd ? " after a sentence" : ""}): ${j.problems.join("; ")}`,
          ),
        ].join("\n"),
      };
    },
  }),
  tool({
    name: "find_font",
    description:
      'Search Google Fonts (about 1,700 open families) when no bundled font or the project\'s own fits the look: by words of the name, kind, and the weights it must come in (a thin condensed sans: sans serif, weights [200 or 300], name "condensed"; or a family you know by name). Then add_font it.',
    input: z.object({
      name: z.string().max(60).optional().describe('Words of the family\'s name ("condensed", "playfair")'),
      category: z.enum(["sans serif", "serif", "display", "handwriting", "monospace"]).optional(),
      weights: z.array(z.number().int().min(100).max(900).multipleOf(100)).max(9).optional(),
      italic: z.boolean().optional(),
    }),
    async run({ name, category, weights, italic }, ctx) {
      if (!ctx.host.fonts) return { text: "Google Fonts isn't available here.", isError: true };
      const found = await ctx.host.fonts.find({
        ...(name && { name }),
        ...(category && { category }),
        ...(weights && { weights }),
        ...(italic && { italic }),
      });
      if (!found.length) return { text: "No families match. Loosen the search (fewer words or weights)." };
      return {
        text: found
          .map(
            (f) =>
              `${f.family} (${f.category.toLowerCase()}): ${f.weights.join(", ")}${f.italics.length ? `; italics ${f.italics.join(", ")}` : ""}`,
          )
          .join("\n"),
      };
    },
  }),
  tool({
    name: "add_font",
    description:
      "Fetch a Google Font's weights into the project's fonts/ folder (once; it works offline from then on): usable by family name in captions, titles, graphics and the cover straight away. Ask only for the weights you'll use.",
    input: z.object({
      family: z.string().min(2).max(60).describe('As Google names it: "Oswald", "Barlow Condensed"'),
      weights: z.array(z.number().int().min(100).max(900).multipleOf(100)).min(1).max(9),
      italic: z.boolean().optional().describe("Their italics too"),
    }),
    async run({ family, weights, italic }, ctx) {
      if (!ctx.host.fonts) return { text: "Google Fonts isn't available here.", isError: true };
      const doc = ctx.scratch.doc;
      const has = (w: number) =>
        doc.fonts.some((f) => f.family.toLowerCase() === family.toLowerCase() && f.weight === w) ||
        BUNDLED_FONTS.some((b) => b.family.toLowerCase() === family.toLowerCase() && b.weights.includes(w));
      const wanted = weights.filter((w) => italic || !has(w));
      if (!wanted.length) return { text: `${family} ${weights.join(", ")} is already here: use it by name.` };
      let files: string[];
      try {
        files = await ctx.host.fonts.add(family, wanted, Boolean(italic));
      } catch (err) {
        return { text: (err as Error).message, isError: true };
      }
      // The store picks the files up from fonts/ by name; this request's copy knows them now, so they
      // render in what it looks at before the request ends.
      const added = files.map((f) => fontFromFile(f)).filter((f) => f !== null);
      ctx.scratch.doc = {
        ...doc,
        fonts: [...doc.fonts.filter((f) => !added.some((a) => a.id === f.id)), ...added],
      };
      const name = added[0]?.family ?? family;
      ctx.step(`Added the font ${name}`);
      return {
        text: `Added ${name}: ${added.map((f) => `${f.weight}${f.style === "italic" ? " italic" : ""}`).join(", ")}. Use it as "${name}" with those weights.`,
      };
    },
  }),
  tool({
    name: "find_sound",
    description:
      'Search Freesound\'s library of real recorded sound effects (half a million, only ones licensed for any use) when neither the library (search_library: the user\'s own sounds and the starter pack of common effects) nor the built-in sounds fit: a crowd gasp, a phone buzz, a door slam, a particular kind of whoosh or riser. Describe the sound plainly ("camera shutter", "bass drop impact", "paper crumple"). Returns candidates with length and licence; then add_sound one and listen to it before placing.',
    input: z.object({
      query: z.string().min(2).max(100),
      max_seconds: z.number().min(0.5).max(30).default(6).describe("Longest sound to consider"),
    }),
    async run({ query, max_seconds }, ctx) {
      if (!ctx.host.findSounds) return { text: "The sound library isn't available here.", isError: true };
      const found = await ctx.host.findSounds(query, max_seconds);
      if (!found.length) return { text: `No sounds for "${query}" up to ${max_seconds}s. Try other words.` };
      ctx.scratch.sounds ??= new Map();
      for (const c of found) ctx.scratch.sounds.set(c.id, c);
      ctx.step(`Found ${found.length} sounds for "${query}"`);
      return {
        text: found
          .map(
            (c) =>
              `${c.id}: "${c.title}" ${c.duration}s, ${c.license}${c.credit ? ` (credit ${c.author})` : ""}${c.tags.length ? ` [${c.tags.join(", ")}]` : ""}`,
          )
          .join("\n"),
      };
    },
  }),
  tool({
    name: "add_sound",
    description:
      "Bring a find_sound candidate into the project as an audio clip (licence and credit recorded; credits.txt lists it at export). Returns its source id and where it hits hardest: place it as a sound effect (sfx with source) with offset so that hit lands on the moment, and duration to its tail. listen to it if the title leaves doubt.",
    input: z.object({ label: Label, id: z.string().min(3).max(40) }),
    async run({ label, id }, ctx) {
      const unread = needsGuide(ctx, "sound");
      if (unread) return unread;
      const c = ctx.scratch.sounds?.get(id);
      if (!c)
        return { text: `No sound "${id}" from find_sound in this request. Search first.`, isError: true };
      if (!ctx.host.addSound) return { text: "The sound library isn't available here.", isError: true };
      const added = await ctx.host.addSound(c, label, ctx.scratch.doc);
      const result = commit(ctx, label, added.ops);
      return result.isError
        ? result
        : {
            text: `Added ${added.id} ("${c.title}", ${c.duration}s, ${c.license}). It hits hardest ${added.hit.toFixed(2)}s in and fades out by ${added.tail.toFixed(2)}s: to land the hit on a moment, place the sfx ${added.hit.toFixed(2)}s before it (or anchor at the moment with offset ${added.hit.toFixed(2)} to skip the lead-in), duration about ${(added.tail - (added.hit > 0.4 ? added.hit : 0)).toFixed(2)}s.`,
          };
    },
  }),
  tool({
    name: "capture_page",
    description:
      "Screenshot a web page (an article, an announcement, a product page) into the project as an image clip, the way news pieces cut to the headline. Give find to scroll to and highlight the exact sentence being quoted. Returns the screenshot to look at. Use pages you found with web search; credit stays with the page.",
    input: z.object({
      label: Label,
      url: z.string().url().max(2000),
      find: z.string().min(3).max(300).optional().describe("Text on the page to scroll to and highlight"),
      device: z.enum(["phone", "desktop"]).default("phone").describe("phone reads best in a vertical video"),
    }),
    async run({ label, url, find, device }, ctx) {
      if (!ctx.host.capturePage) return { text: "Page capture isn't available here.", isError: true };
      const got = await ctx.host.capturePage(url, { label, device, ...(find && { find }) }, ctx.scratch.doc);
      const result = commit(ctx, label, got.ops);
      if (result.isError) return result;
      return {
        text: `Captured "${got.title}" as ${got.id}.${find ? (got.found ? " The quoted text is highlighted." : " The quoted text wasn't found on the page; it shows the top.") : ""}`,
        images: [{ data: got.image.toString("base64"), mediaType: "image/jpeg" }],
      };
    },
  }),
  tool({
    name: "undo",
    description:
      "Take back your own last changes from this request, newest first, exactly as they were before: a test you tried, or an approach that didn't work. Use it instead of rebuilding the old values by hand. It works even on items you've stopped changing.",
    input: z.object({
      count: z.number().int().min(1).max(50).default(1).describe("How many of your changes to take back"),
    }),
    async run({ count }, ctx) {
      const stack = ctx.scratch.undoable ?? [];
      if (!stack.length) return { text: "Nothing of yours to undo in this request.", isError: true };
      const taken = stack.splice(-Math.min(count, stack.length)).toReversed();
      const label = `Undo: ${taken.map((t) => t.label).join(", ")}`;
      const result = commit(
        ctx,
        label.length > 80 ? `Undo ${taken.length} changes` : label,
        taken.flatMap((t) => t.inverse),
        false,
      );
      if (result.isError) {
        stack.push(...taken.toReversed());
        return result;
      }
      return {
        text: `Took back ${taken.map((t) => `"${t.label}"`).join(", ")}. Project now:\n${projectView(ctx.scratch.doc)}`,
      };
    },
  }),
  tool({
    name: "run_checks",
    description:
      "Run the quality checks (hook timing, safe zones, beat sync, captions, dead air, shot lengths, ducking, leftovers).",
    input: z.object({}),
    async run(_input, ctx) {
      const step = checkStep(ctx.scratch.doc);
      const thrown = [...(ctx.scratch.graphicErrors ?? [])].filter(([id]) =>
        ctx.scratch.doc.graphics.some((g) => g.id === id),
      );
      ctx.step(step.text, step.warn || thrown.length ? "warn" : "done");
      return {
        text:
          checksView(step.results) +
          (thrown.length
            ? `\n\nGraphics that threw when rendered (fix them with write_graphic, then look again):\n${thrown.map(([id, m]) => `- ${id}: ${m}`).join("\n")}`
            : ""),
      };
    },
  }),
  tool({
    name: "apply_fix",
    description: "Apply the automatic fix a failing check offers.",
    input: z.object({ check: z.string() }),
    async run({ check }, ctx) {
      const result = runChecks(ctx.scratch.doc).find((r) => r.id === check);
      if (!result?.fix) return { text: `Check ${check} has no fix to apply.`, isError: true };
      return commit(ctx, result.fix.label, result.fix.ops);
    },
  }),
  tool({
    name: "get_project",
    description: "Re-read the whole project as it is now, after your edits.",
    input: z.object({}),
    async run(_input, ctx) {
      return { text: projectView(ctx.scratch.doc) };
    },
  }),
];

/** Runs a tool by name with untrusted input. Validation failures come back as tool errors. */
/** Cuts an editor would redo (cutReport), as notes to act on: re-cut them with rough_cut or by moving the edge. */
function cutNotes(doc: ProjectDoc, levels: (id: string) => Uint8Array | null | undefined): string {
  const issues = cutReport(doc, levels);
  if (!issues.length) return "";
  return `\n\nCuts to redo (${issues.length}): a cut in continuous speech is audible however precise; a shot ending on a word like "and" sounds cut off. Move each to the better point given (by word index):\n${issues
    .slice(0, 25)
    .map((x) => `- ${x.time.toFixed(2)}s ${x.scene} ${x.edge}: ${x.detail}`)
    .join("\n")}${issues.length > 25 ? "\n..." : ""}`;
}

/** The longest a tool may run (ms); others get 15 minutes (a cutout of long shots, a big render). */
const TOOL_CEILING: Record<string, number> = {
  look: 4 * 60_000,
  listen: 2 * 60_000,
  find_sound: 2 * 60_000,
  find_stock: 3 * 60_000,
  capture_page: 3 * 60_000,
  inspect_motion: 10 * 60_000,
  inspect_joins: 3 * 60_000,
};

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { text: `Unknown tool ${name}`, isError: true };
  const parsed = t.input.safeParse(input);
  if (!parsed.success) return { text: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
  const label = activityFor(name, parsed.data as Record<string, unknown>);
  ctx.activity?.(label);
  const started = Date.now();
  const call = {
    id: `t${++calls}`,
    name,
    label: label.replace(/…$/, ""),
    input: clip(JSON.stringify(parsed.data, null, 2)),
  };
  ctx.tool?.({ ...call, status: "running" });
  let result: ToolResult | undefined;
  ctx.running?.(true);
  // A tool that takes a while says so, with how long, so the status line never shows a stale step.
  const ticker = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    if (s >= 15) ctx.activity?.(`${label.replace(/…$/, "")} (${s}s)…`);
  }, 5_000);
  // No tool may hold the request forever: past its ceiling the request carries on without it.
  const ceiling = TOOL_CEILING[name] ?? 15 * 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([
      t.run(parsed.data, ctx),
      new Promise<ToolResult>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              text: `${name} took over ${Math.round(ceiling / 60_000)} minutes and was abandoned. Carry on without it, or try once more.`,
              isError: true,
            }),
          ceiling,
        );
      }),
    ]);
    return result;
  } catch (err) {
    result = { text: `Tool failed: ${(err as Error).message}`, isError: true };
    return result;
  } finally {
    clearTimeout(timer);
    clearInterval(ticker);
    ctx.running?.(false);
    ctx.tool?.({
      ...call,
      status: !result || result.isError ? "error" : "done",
      output: clip(result?.text ?? "Stopped."),
      ms: Date.now() - started,
      ...(result?.shown && { image: result.shown }),
      ...(result?.stuck && { stuck: true }),
    });
    console.log(
      `[agent] ${name} ${((Date.now() - started) / 1000).toFixed(1)}s at ${new Date().toTimeString().slice(0, 8)}`,
    );
    ctx.activity?.("Thinking it through…");
  }
}
