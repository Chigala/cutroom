/**
 * One Jev request per message: the request, what's selected, the project's items and settings, and
 * every question an instant edit could need, asked at once. Jev answers them in parallel; the decoder
 * reads only the branch it chose. A "can't tell" option comes first in every choice: Jev leans toward
 * the first option, and leaning toward handing over to the agent is the safe way to be wrong.
 */
import {
  type Collection,
  formatTime,
  type ProjectDoc,
  resolveAnchor,
  type Singleton,
  timelineOf,
} from "@vedit/project";
import { type NumberSpan, numbersIn, timesIn } from "./numbers.ts";
import { type PlanField, type PlanTarget, plan } from "./plan.ts";

export const UNCLEAR = "cant_tell";

/** What the user is pointing at when they send (the agent's focus, the same fields). */
export interface Focus {
  readonly time?: number;
  readonly selection?: { readonly coll: string; readonly id: string };
  readonly scenes?: readonly string[];
  readonly range?: { readonly start: number; readonly end: number };
}

/** A recent change that "undo the …" can mean, newest first. */
export interface RecentChange {
  readonly id: string;
  readonly label: string;
}

export interface Question {
  readonly type: "noul" | "choice";
  readonly instructions: string;
  readonly criteria?: Record<string, string | null>;
}

export interface JevRequest {
  readonly state: Record<string, unknown>;
  readonly questions: Record<string, Question>;
}

/** What the decoder needs to turn answers back into edits. */
export interface Asked {
  readonly targets: readonly PlanTarget[];
  readonly items: Partial<Record<Collection, readonly string[]>>;
  readonly numbers: readonly NumberSpan[];
  readonly recent: readonly RecentChange[];
}

type Item = { id: string; anchor?: { scene: string; at: number }; duration?: number };

/** Where an item sits, for its description and for "here". */
function spanOf(doc: ProjectDoc, coll: Collection, item: Item): { start: number; end: number } | null {
  const tl = timelineOf(doc);
  if (coll === "scenes") {
    const p = tl.byId.get(item.id);
    return p ? { start: p.start, end: p.start + p.duration } : null;
  }
  if (!item.anchor) return null;
  const start = resolveAnchor(tl, item.anchor);
  return start === null ? null : { start, end: start + (item.duration ?? 0) };
}

const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describe(doc: ProjectDoc, coll: Collection, item: Item, n: number): string {
  const source = (id?: string) => doc.sources.find((s) => s.id === id)?.label ?? id ?? "";
  const i = item as Record<string, unknown> & Item;
  switch (coll) {
    case "scenes":
      return `shot ${n} ${clip(String(i.note || source(i.source as string)))}`;
    case "titles":
      return `${i.role} title "${clip(String(i.text ?? ""), 60)}"`;
    case "zooms":
      return `zoom ×${i.scale} (${i.ease ?? "smooth"})`;
    case "sfx":
      return `sound effect ${i.name ?? source(i.source as string)}`;
    case "visuals": {
      const c = i.content as { kind: string; graphic?: string; source?: string; style?: string };
      return c.kind === "graphic"
        ? `graphic "${c.graphic}"`
        : c.kind === "media"
          ? `${c.style ?? "sticker"} (meme, GIF or picture) ${source(c.source)}`
          : `cutaway to ${source(c.source)}`;
    }
    case "musicClips":
      return `music clip ${source(i.source as string)}`;
    case "effects":
      return `${i.kind} effect`;
    default:
      return coll;
  }
}

/** The items the user is pointing at: selected, under the playhead, inside a marked stretch. */
function marks(coll: Collection, item: Item, span: { start: number; end: number } | null, focus: Focus) {
  const out: string[] = [];
  if (focus.selection?.coll === coll && focus.selection.id === item.id) out.push("selected");
  if (coll === "scenes" && focus.scenes?.includes(item.id)) out.push("selected");
  if (
    span &&
    focus.time !== undefined &&
    span.start <= focus.time &&
    focus.time < Math.max(span.end, span.start + 0.5)
  )
    out.push("under the playhead");
  if (span && focus.range && span.start < focus.range.end && span.end > focus.range.start)
    out.push("in the marked stretch");
  return out;
}

const valueText = (v: unknown) => (v === undefined ? "default" : JSON.stringify(v));

function readPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as never)[k] : undefined), obj);
}

function fieldQuestion(target: PlanTarget, current?: unknown): Question {
  const criteria: Record<string, string | null> = {
    [UNCLEAR]: "The request doesn't say, or means something else",
  };
  for (const f of target.fields)
    criteria[f.key] =
      current === undefined ? f.label : `${f.label} (now ${valueText(readPath(current, f.key))})`;
  return {
    type: "choice",
    instructions: `Which ${target.label.toLowerCase()} setting does \`request\` change?`,
    criteria,
  };
}

function valueQuestion(doc: ProjectDoc, target: PlanTarget, field: PlanField): Question | null {
  const values =
    field.kind === "enum"
      ? field.values
      : field.kind === "bool"
        ? ["on", "off"]
        : field.kind === "ref"
          ? (doc[field.coll] as readonly { id: string }[]).map((x) => x.id)
          : [];
  if (!values.length || values.length > 250) return null;
  const criteria: Record<string, string | null> = { [UNCLEAR]: "The request doesn't say which" };
  for (const v of values)
    criteria[v] = field.kind === "bool" ? (v === "on" ? "Turn it on" : "Turn it off") : null;
  return {
    type: "choice",
    instructions: `If \`request\` changes ${field.label.split(":")[0]} of ${target.label.toLowerCase()}, what should it become?`,
    criteria,
  };
}

export function ask(
  doc: ProjectDoc,
  request: string,
  opts: { focus?: Focus; earlier?: readonly string[]; recent?: readonly RecentChange[] } = {},
): { body: JevRequest; asked: Asked } {
  const focus = opts.focus ?? {};
  const recent = (opts.recent ?? []).slice(0, 12);
  const numbers = numbersIn(request);
  const times = timesIn(request);
  const targets = plan().filter(
    (t) => t.kind === "singleton" || (doc[t.id as Collection] as unknown[]).length,
  );

  const items: Partial<Record<Collection, string[]>> = {};
  const itemState: Record<string, string[]> = {};
  const settings: Record<string, Record<string, unknown>> = {};
  for (const t of targets) {
    if (t.kind === "singleton") {
      const value = doc[t.id as Singleton] as Record<string, unknown>;
      settings[t.id] = Object.fromEntries(t.fields.map((f) => [f.key, readPath(value, f.key) ?? "default"]));
      continue;
    }
    const coll = t.id as Collection;
    const list = (doc[coll] as readonly Item[]).slice(0, 240);
    items[coll] = list.map((x) => x.id);
    itemState[coll] = list.map((item, n) => {
      const span = spanOf(doc, coll, item);
      const where = span ? ` at ${formatTime(span.start, true)}–${formatTime(span.end, true)}` : "";
      const flags = marks(coll, item, span, focus);
      // "the shot at 0:09": code finds it (Jev is weak with numbers) and says so on the item.
      for (const t of times)
        if (span && span.start <= t.seconds && t.seconds < Math.max(span.end, span.start + 0.5))
          flags.push(`at the ${t.text} the request mentions`);
      return `${item.id}: ${describe(doc, coll, item, n + 1)}${where}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
    });
  }

  const pointing: string[] = [];
  if (focus.time !== undefined) pointing.push(`playhead at ${formatTime(focus.time, true)}`);
  if (focus.selection) pointing.push(`${focus.selection.id} (${focus.selection.coll}) is selected`);
  if (focus.range)
    pointing.push(`marked ${formatTime(focus.range.start, true)}–${formatTime(focus.range.end, true)}`);

  const state: Record<string, unknown> = {
    request,
    ...(opts.earlier?.length && { earlier_requests: opts.earlier.slice(-2) }),
    ...(pointing.length && { pointing_at: pointing.join("; ") }),
    settings,
    items: itemState,
    ...(recent.length && { recent_changes: recent.map((r) => r.label) }),
  };

  const questions: Record<string, Question> = {
    is_instruction: {
      type: "noul",
      instructions:
        'Does `request` ask for a change to the video? Polite questions count ("can you…?", "pls"); a question about ideas or opinions doesn\'t.',
    },
    adds_new: {
      type: "noul",
      instructions:
        "Does `request` ask to add something that isn't in the edit yet (a new title, text, sound, music, graphic, sticker, clip or effect), or to replace something with a different one?",
    },
    to_taste: {
      type: "noul",
      instructions:
        'Does `request` ask to make something better, nicer or fixed without saying what it should become ("make it better", "sleeker", "fix it", "cleaner", "more viral")? If it names what to change and what it should be, or asks to undo or restore, answer no.',
    },
    several: {
      type: "noul",
      instructions: "Does `request` ask for two or more different changes?",
    },
    part_only: {
      type: "noul",
      instructions:
        'Does `request` limit the change to a stretch of time inside an item or setting ("after he says…", "for the first 5 seconds", "during the countdown"), rather than a whole item or setting? Saying where an item is ("the shot at 0:09", "the zoom at the start") is not limiting it.',
    },
    verb: {
      type: "choice",
      instructions: "What does `request` ask for?",
      criteria: {
        [UNCLEAR]: "Something else, or more than this",
        change: "Change a setting of something already in the edit",
        remove: "Remove something already in the edit",
        ...(recent.length && { undo: "Undo or take back an earlier change, restore how it was" }),
      },
    },
    target: {
      type: "choice",
      instructions: "What in the edit does `request` act on?",
      criteria: {
        [UNCLEAR]: "Something not listed, or it doesn't say",
        ...Object.fromEntries(targets.map((t) => [t.id, t.label])),
      },
    },
    direction: {
      type: "choice",
      instructions: "If `request` changes a number (a size, level, speed, length), how?",
      criteria: {
        [UNCLEAR]: "It doesn't change a number",
        increase: "More, bigger, louder, longer, faster",
        decrease: "Less, smaller, quieter, shorter, slower",
        set: "To the number written in the request",
        minimum: "Off, mute, none, zero, as small as it goes",
        maximum: "As much as it goes, full",
        default: "Back to normal, reset",
      },
    },
    amount: {
      type: "choice",
      instructions: "If `request` makes something more or less, by how much?",
      criteria: {
        a_little: "A bit, slightly, a touch (or it doesn't say)",
        a_lot: "A lot, much, way more, huge",
      },
    },
  };
  if (numbers.length)
    questions.number = {
      type: "choice",
      instructions: "Which number written in `request` is the new value?",
      criteria: { none: "None of them", ...Object.fromEntries(numbers.map((n, i) => [`n${i}`, n.text])) },
    };
  if (recent.length) {
    questions.undo_named = {
      type: "noul",
      instructions:
        'If `request` takes back an earlier change, does it say which change (by what it changed), rather than just "undo", "restore it" or "go back"?',
    };
    questions.undo = {
      type: "choice",
      instructions: "If `request` takes back an earlier change, which one?",
      criteria: {
        [UNCLEAR]: "It doesn't say which",
        last: "The most recent change",
        ...Object.fromEntries(recent.map((r) => [r.id, r.label])),
      },
    };
  }
  for (const t of targets) {
    if (t.kind === "collection") {
      const coll = t.id as Collection;
      questions[`item.${coll}`] = {
        type: "choice",
        instructions: `If \`request\` is about ${t.label.toLowerCase()}, which one? "this", "it" and "here" mean what they're pointing at.`,
        criteria: {
          [UNCLEAR]: "Can't tell which, or several but not all",
          all: "All of them",
          ...Object.fromEntries(
            (items[coll] ?? []).map((id, i) => [id, itemState[coll]![i]!.slice(id.length + 2)]),
          ),
        },
      };
    }
    questions[`field.${t.id}`] = fieldQuestion(
      t,
      t.kind === "singleton" ? doc[t.id as Singleton] : undefined,
    );
    for (const f of t.fields) {
      const q = valueQuestion(doc, t, f);
      if (q) questions[`value.${t.id}.${f.key}`] = q;
    }
  }
  return { body: { state, questions }, asked: { targets, items, numbers, recent } };
}
