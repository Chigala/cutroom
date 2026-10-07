/**
 * What an instant edit may touch, read off the project schema: every setting and item field that is a
 * fixed choice, a switch, a number with a range, or a pick from another collection. Free text,
 * positions, keyframes and nested shapes are left out: those need the agent. A field added to the
 * schema becomes instantly editable with no table to update.
 */
import { type Collection, CollectionSchemas, type Singleton, SingletonSchemas } from "@vedit/project";
import { z } from "zod";

/** How a number reads in a request: "75px", "50%", "2s", "1.5x", "-14 dB". */
export type Unit = "px" | "fraction" | "seconds" | "times" | "db" | "plain";

export type FieldKind =
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "bool" }
  | {
      readonly kind: "number";
      readonly min: number;
      readonly max: number;
      readonly unit: Unit;
      readonly integer: boolean;
    }
  /** An id from another collection: a grade, a caption look, an effect. */
  | { readonly kind: "ref"; readonly coll: Collection };

export type PlanField = FieldKind & {
  readonly key: string;
  readonly label: string;
  readonly default?: unknown;
};

export interface PlanTarget {
  /** The collection or setting name, as ops use it. */
  readonly id: Collection | Singleton;
  readonly kind: "collection" | "singleton";
  readonly label: string;
  readonly fields: readonly PlanField[];
}

/** What instant edits cover: the things people tweak by name. The rest of the project needs the agent. */
const COLLECTION_TARGETS: Partial<Record<Collection, string>> = {
  scenes: "Shots (scenes) in the edit",
  titles: "Titles and text on screen (the hook, labels)",
  zooms: "Zooms (punch-ins)",
  sfx: "Sound effects",
  visuals: "Pictures, stickers, memes, B-roll and graphics placed over the video",
  musicClips: "Extra music clips placed on the timeline",
  voiceovers: "Voiceovers: recordings laid over the video as the voice",
  effects: "Effects on a moment of the video",
};
const SINGLETON_TARGETS: Partial<Record<Singleton, string>> = {
  captionStyle: "The captions' style (subtitles)",
  music: "The background music track",
  mix: "The sound mix: voice, levels, loudness",
  look: "The overall look: colour grade, vignette, framing",
};

/** Fields that name another collection's item. */
const REFS: Record<string, Collection> = {
  "look.grade": "grades",
  "captionStyle.look": "captionLooks",
  "effects.kind": "effectKinds",
};

/** Fields an instant edit leaves alone: identity, where things sit in time, and indexing's notes. */
const SKIP = new Set([
  "scenes.in",
  "scenes.out",
  "sfx.offset",
  "musicClips.offset",
  "voiceovers.offset",
  "music.offset",
  "music.fitted",
  "visuals.layer",
]);

function unitOf(key: string, max: number): Unit {
  if (/size$/i.test(key)) return "px";
  if (/volume|level|strength|amount|duckTo|roomTone/i.test(key) && max <= 3) return "fraction";
  if (/loudness|truePeak/i.test(key)) return "db";
  if (/scale|speed|zoom|shrink/i.test(key)) return "times";
  if (/duration|fade|lead|tail|enter|exit|break|seconds|ramp|gap/i.test(key)) return "seconds";
  return "plain";
}

const human = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();

interface JsonProp {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  description?: string;
  default?: unknown;
  properties?: Record<string, JsonProp>;
  anyOf?: JsonProp[];
  oneOf?: JsonProp[];
}

/** `key` is a dotted path inside the item ("content.box.width") when the field is nested. */
function fieldOf(target: string, key: string, prop: JsonProp): PlanField | null {
  const path = `${target}.${key}`;
  if (key === "id" || key.endsWith(".kind") || SKIP.has(path)) return null;
  const name = key.split(".").map(human).join(" ");
  const label = prop.description ? `${name}: ${prop.description}` : name;
  const base = { key, label, ...(prop.default !== undefined && { default: prop.default }) };
  const ref = REFS[path];
  if (ref) return { ...base, kind: "ref", coll: ref };
  if (prop.enum?.length && prop.enum.every((v) => typeof v === "string"))
    return { ...base, kind: "enum", values: prop.enum as string[] };
  if (prop.type === "boolean") return { ...base, kind: "bool" };
  if (prop.type === "number" || prop.type === "integer") {
    const min = prop.minimum ?? prop.exclusiveMinimum;
    const max = prop.maximum;
    // An open-ended number (a time, an offset) has no safe step: the agent sets those.
    if (min === undefined || max === undefined || max > 10_000) return null;
    return { ...base, kind: "number", min, max, unit: unitOf(key, max), integer: prop.type === "integer" };
  }
  return null;
}

function targetOf(id: string, kind: PlanTarget["kind"], label: string, schema: z.ZodType): PlanTarget {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonProp;
  const fields = new Map<string, PlanField>();
  // Into nested settings two levels down ("content.box.width"), through every shape a union can take;
  // an anchor or keyframe list is placement, which the agent handles.
  const walk = (props: Record<string, JsonProp> | undefined, prefix: string, depth: number) => {
    for (const [key, prop] of Object.entries(props ?? {})) {
      if (key === "anchor" || key === "keyframes") continue;
      const path = prefix + key;
      const shapes = [prop, ...(prop.anyOf ?? []), ...(prop.oneOf ?? [])];
      const nested = shapes.filter((s) => s.properties);
      if (nested.length) {
        if (depth < 2) for (const s of nested) walk(s.properties, `${path}.`, depth + 1);
        continue;
      }
      const field = fieldOf(id, path, shapes.find((s) => s.type || s.enum) ?? prop);
      if (field && !fields.has(path)) fields.set(path, field);
    }
  };
  walk(json.properties, "", 0);
  return { id: id as PlanTarget["id"], kind, label, fields: [...fields.values()] };
}

let cached: readonly PlanTarget[] | undefined;

/** The plan, built once from the schema. */
export function plan(): readonly PlanTarget[] {
  cached ??= [
    ...Object.entries(SINGLETON_TARGETS).map(([id, label]) =>
      targetOf(id, "singleton", label, SingletonSchemas[id as Singleton]),
    ),
    ...Object.entries(COLLECTION_TARGETS).map(([id, label]) =>
      targetOf(id, "collection", label, CollectionSchemas[id as Collection]),
    ),
  ];
  return cached;
}
