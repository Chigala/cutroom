/**
 * Jev's answers back into an edit, or a hand-over to the agent. An answer counts only when Jev is
 * clearly sure (its pick well ahead of the next), a removal only when it's surer still, and a value
 * only comes from the request's own numbers, a step, or a list of what exists. Anything doubtful,
 * contradictory or out of range goes to the agent: the worst an instant edit costs is a second.
 */
import { applyOps, type Collection, type Op, type ProjectDoc, type Singleton } from "@vedit/project";
import { type Asked, UNCLEAR } from "./ask.ts";
import { absoluteValue } from "./numbers.ts";
import type { PlanField, PlanTarget } from "./plan.ts";

export type Answer =
  | { readonly type: "noul"; readonly noul: number }
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
    };

export type Instant =
  | { readonly kind: "edit"; readonly ops: readonly Op[]; readonly label: string }
  /** `commit` is a recent change's id, or "last". */
  | { readonly kind: "undo"; readonly commit: string }
  /** Already the way they asked: say so instead of changing nothing. */
  | { readonly kind: "same"; readonly label: string }
  | { readonly kind: "agent"; readonly why: string };

/** How sure a pick must be, and how far ahead of the runner-up. Tuned with the request log. */
export const THRESHOLDS = {
  pick: 0.85,
  /** "Change" when what and which setting are sure: the verb matters less then. */
  verb: 0.65,
  remove: 0.95,
  lead: 0.15,
  instruction: 0.6,
  addsNew: 0.35,
  toTaste: 0.4,
  several: 0.35,
  partOnly: 0.35,
  /** Below this, "undo" means the last change. */
  undoNamed: 0.3,
};

const NOUNS: Record<string, [string, string]> = {
  captionStyle: ["Captions", "Captions"],
  music: ["Music", "Music"],
  mix: ["Mix", "Mix"],
  look: ["Look", "Look"],
  scenes: ["Shot", "shots"],
  titles: ["Title", "titles"],
  zooms: ["Zoom", "zooms"],
  sfx: ["Sound effect", "sound effects"],
  visuals: ["Overlay", "overlays"],
  musicClips: ["Music clip", "music clips"],
  effects: ["Effect", "effects"],
};

const handOver = (why: string): Instant => ({ kind: "agent", why });

type Result = { readonly value: unknown } | { readonly why: string };
const no = (why: string): Result => ({ why });

/** The pick, if it's sure enough: at least `min` and `lead` ahead of the next. */
function sure(a: Answer | undefined, min = THRESHOLDS.pick): string | null {
  if (a?.type !== "choice") return null;
  const ps = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
  const [first, second] = ps;
  if (!first || first[1] < min || first[1] - (second?.[1] ?? 0) < THRESHOLDS.lead) return null;
  return first[0] === UNCLEAR ? null : first[0];
}

const yes = (a: Answer | undefined) => (a?.type === "noul" ? a.noul : 0.5);

function readPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as never)[k] : undefined), obj);
}

/** The top-level patch that sets one (maybe nested) field: `{content: {...content, box: {...box, width}}}`. */
function patchFor(current: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  if (!rest.length) return { [head!]: value };
  const inner = (current[head!] ?? {}) as Record<string, unknown>;
  return { [head!]: { ...inner, ...patchFor(inner, rest.join("."), value) } };
}

const STEP = { a_little: 1.2, a_lot: 1.5 } as const;
/** Positions read "up" as smaller: no safe "more" or "less" there, only a written number. */
const SPATIAL = /(^|\.)(x|y|splitY)$/;

const fmt = (v: unknown) =>
  typeof v === "number"
    ? String(Math.round(v * 100) / 100)
    : typeof v === "boolean"
      ? v
        ? "on"
        : "off"
      : String(v);

/** The new number for one field, or why not. */
function nextNumber(
  field: Extract<PlanField, { kind: "number" }>,
  current: number | undefined,
  answers: Record<string, Answer>,
  asked: Asked,
  request: string,
): Result {
  const direction = sure(answers.direction, 0.6);
  const pick = sure(answers.number);
  const span = pick && pick !== "none" ? asked.numbers[Number(pick.slice(1))] : undefined;
  const now = current ?? (typeof field.default === "number" ? field.default : undefined);
  const clampStep = (v: number) => Math.min(field.max, Math.max(field.min, v));
  let value: number;
  if (span) {
    // "20% bigger", "louder by 3": a change by the number. Otherwise the number is the value.
    const by = new RegExp(`\\bby\\s+${span.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(request);
    if ((direction === "increase" || direction === "decrease") && (span.unit === "percent" || by)) {
      if (now === undefined) return no("no current value to change");
      const sign = direction === "increase" ? 1 : -1;
      value =
        span.unit === "percent" ? now * (1 + (sign * span.value) / 100) : now + sign * Math.abs(span.value);
    } else {
      const v = absoluteValue(span, field.unit, field.max);
      if (v === null) return no(`"${span.text}" isn't a ${field.unit} value`);
      value = v;
    }
    // A written number outside the range was meant for something else, or needs a word with the user.
    if (value < field.min || value > field.max)
      return no(`${span.text} is outside ${field.min}–${field.max}`);
  } else if (direction === "minimum") value = field.min;
  else if (direction === "maximum") value = field.max;
  else if (direction === "default") {
    if (typeof field.default !== "number") return no("no default to go back to");
    value = field.default;
  } else if (direction === "increase" || direction === "decrease") {
    if (SPATIAL.test(field.key)) return no("a position needs a number");
    if (now === undefined) return no("no current value to change");
    const amount = (sure(answers.amount, 0.6) ?? "a_little") as keyof typeof STEP;
    if (field.unit === "db") value = now + (direction === "increase" ? 1 : -1) * (amount === "a_lot" ? 5 : 2);
    else if (now === 0)
      value =
        direction === "increase"
          ? field.min + (field.max - field.min) * (amount === "a_lot" ? 0.25 : 0.1)
          : 0;
    else value = direction === "increase" ? now * STEP[amount] : now / STEP[amount];
    value = clampStep(value);
  } else return no("how to change the number isn't clear");
  if (field.integer || field.unit === "px") value = Math.round(value);
  // "Bigger, 75px" when it's 84 now: the words and the number disagree. Ask the agent, don't guess.
  if (now !== undefined && direction === "increase" && value < now) return no("the number makes it smaller");
  if (now !== undefined && direction === "decrease" && value > now) return no("the number makes it bigger");
  return { value: Math.round(value * 1000) / 1000 };
}

function nextValue(
  doc: ProjectDoc,
  target: PlanTarget,
  field: PlanField,
  current: unknown,
  answers: Record<string, Answer>,
  asked: Asked,
  request: string,
): Result {
  if (field.kind === "number")
    return nextNumber(field, typeof current === "number" ? current : undefined, answers, asked, request);
  const pick = sure(answers[`value.${target.id}.${field.key}`]);
  if (!pick) return no("which value isn't clear");
  if (field.kind === "bool") return { value: pick === "on" };
  if (field.kind === "enum" && !field.values.includes(pick)) return no(`no ${field.key} "${pick}"`);
  if (field.kind === "ref" && !(doc[field.coll] as { id: string }[]).some((x) => x.id === pick))
    return no(`no ${field.coll} "${pick}"`);
  return { value: pick };
}

export function decode(
  doc: ProjectDoc,
  request: string,
  answers: Record<string, Answer>,
  asked: Asked,
): Instant {
  if (yes(answers.is_instruction) < THRESHOLDS.instruction) return handOver("not an instruction");
  const verb = sure(answers.verb, THRESHOLDS.verb);
  if (!verb) return handOver("what to do isn't clear");
  // Taking a change back makes nothing new and needs no taste.
  if (verb === "undo" && sure(answers.verb) === "undo" && yes(answers.several) <= THRESHOLDS.several) {
    // "Restore it back": no change named, so the last one.
    if (yes(answers.undo_named) < THRESHOLDS.undoNamed) return { kind: "undo", commit: "last" };
    const which = sure(answers.undo);
    return which ? { kind: "undo", commit: which } : handOver("which change to undo isn't clear");
  }
  if (verb === "undo") return handOver("not sure it's an undo");
  if (yes(answers.adds_new) > THRESHOLDS.addsNew) return handOver("adds something new");
  if (yes(answers.to_taste) > THRESHOLDS.toTaste) return handOver("left to taste");
  if (yes(answers.several) > THRESHOLDS.several) return handOver("more than one change");
  if (yes(answers.part_only) > THRESHOLDS.partOnly) return handOver("only part of an item");

  const targetId = sure(answers.target, verb === "remove" ? THRESHOLDS.remove : THRESHOLDS.pick);
  const target = asked.targets.find((t) => t.id === targetId);
  if (!target) return handOver("what to change isn't clear");
  const [one, many] = NOUNS[target.id] ?? [target.id, target.id];

  // Which items: one, or all of them.
  let ids: readonly string[] = [];
  if (target.kind === "collection") {
    const coll = target.id as Collection;
    const pick = sure(answers[`item.${coll}`], verb === "remove" ? THRESHOLDS.remove : THRESHOLDS.pick);
    if (!pick) return handOver(`which ${one.toLowerCase()} isn't clear`);
    ids = pick === "all" ? (asked.items[coll] ?? []) : [pick];
    if (!ids.length || ids.some((id) => !(asked.items[coll] ?? []).includes(id)))
      return handOver(`no such ${one.toLowerCase()}`);
  }

  if (verb === "remove") {
    if (target.kind !== "collection") return handOver("only items can be removed");
    if (verb !== sure(answers.verb, THRESHOLDS.remove)) return handOver("not sure enough to remove");
    const coll = target.id as Collection;
    if (coll === "scenes" && ids.length >= doc.scenes.length) return handOver("would remove every shot");
    const ops: Op[] = ids.map((id) => ({ op: "remove", coll, id }));
    return checked(
      doc,
      ops,
      ids.length === 1 ? `Removed ${one.toLowerCase()} ${ids[0]}` : `Removed all ${many}`,
    );
  }
  if (verb !== "change") return handOver("not a change or removal");

  const fieldKey = sure(answers[`field.${target.id}`]);
  const field = target.fields.find((f) => f.key === fieldKey);
  if (!field) return handOver("which setting isn't clear");
  const name = field.label.split(":")[0]!;

  if (target.kind === "singleton") {
    const key = target.id as Singleton;
    const current = doc[key] as Record<string, unknown>;
    const before = readPath(current, field.key);
    const next = nextValue(doc, target, field, before, answers, asked, request);
    if ("why" in next) return handOver(next.why);
    const { value } = next;
    if (value === before) return { kind: "same", label: `${one} ${name} is already ${fmt(value)}` };
    const label = `${one} ${name} ${before === undefined ? "→" : `${fmt(before)} →`} ${fmt(value)}`;
    return checked(doc, [{ op: "merge", key, patch: patchFor(current, field.key, value) }], label);
  }

  const coll = target.id as Collection;
  const ops: Op[] = [];
  let label = "";
  for (const id of ids) {
    const item = (doc[coll] as readonly Record<string, unknown>[]).find((x) => x.id === id)!;
    const before = readPath(item, field.key);
    const next = nextValue(doc, target, field, before, answers, asked, request);
    if ("why" in next) return handOver(next.why);
    const { value } = next;
    if (value === before) continue;
    ops.push({ op: "update", coll, id, patch: patchFor(item, field.key, value) });
    label =
      ids.length === 1
        ? `${one} ${name} ${before === undefined ? "→" : `${fmt(before)} →`} ${fmt(value)}`
        : "";
  }
  if (!ops.length) return { kind: "same", label: `Already that way` };
  return checked(doc, ops, label || `All ${many}: ${name} changed`);
}

/** The edit, if the project accepts it; the agent otherwise. */
function checked(doc: ProjectDoc, ops: Op[], label: string): Instant {
  try {
    applyOps(doc, ops);
  } catch (err) {
    return handOver(`the edit doesn't apply: ${(err as Error).message}`);
  }
  return { kind: "edit", ops, label };
}
