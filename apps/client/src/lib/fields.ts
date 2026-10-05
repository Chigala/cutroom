/**
 * Form fields generated from the project's own schemas. The inspector never hard-codes what a zoom or a
 * title has: it reads the zod schema (as JSON Schema) and builds an editor for each property. Add a field
 * to a schema and it shows up here, with its limits, options and description.
 */
import { CollectionSchemas, type Singleton, SingletonSchemas } from "@vedit/project";

export type FieldKind =
  | "text"
  | "longtext"
  | "number"
  | "range"
  | "boolean"
  | "select"
  | "color"
  | "lines"
  | "choices"
  | "point"
  | "time"
  | "object"
  | "ref";

/** Collections of files a field can name by id: picked from what's in the project, not typed. */
export type RefColl = "effectKinds" | "transitionKinds" | "grades" | "captionLooks" | "sources";

/** A field described as "effects/<kind>.css" names a file in that folder. */
const REF_FOLDERS: Record<string, RefColl> = {
  effects: "effectKinds",
  transitions: "transitionKinds",
  grades: "grades",
  "captions/looks": "captionLooks",
};

export interface Field {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly hint?: string;
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** null is allowed (an empty value means "none"). */
  readonly nullable?: boolean;
  /** The field can be left out entirely; the renderer then decides (shown as "Auto"). */
  readonly optional?: boolean;
  /** What the schema fills in when the field is left out. */
  readonly default?: unknown;
  readonly children?: readonly Field[];
  /** For "ref" fields: the collection whose ids it takes. */
  readonly ref?: RefColl;
}

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  /** Schema metadata: the field takes an id from this collection ("sources"). */
  ref?: string;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
}

/** "duckUnderSpeech" → "Duck under speech". */
export const labelOf = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return label.replace(/\b(sfx|lufs|fps)\b/gi, (w) => w.toUpperCase()).replace(/\bjl\b/i, "J/L");
};

/** Fields the inspector shows elsewhere, or that only the system writes. */
const HIDDEN = new Set(["id", "schema", "createdAt", "content", "source"]);

function unwrap(s: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const variants = s.anyOf ?? s.oneOf;
  if (variants) {
    const real = variants.filter((v) => v.type !== "null");
    if (real.length === 1)
      return {
        schema: { ...real[0]!, description: s.description ?? real[0]!.description },
        nullable: real.length < variants.length,
      };
  }
  if (Array.isArray(s.type) && s.type.includes("null"))
    return { schema: { ...s, type: s.type.find((t) => t !== "null") }, nullable: true };
  return { schema: s, nullable: false };
}

function fieldOf(key: string, raw: JsonSchema, required: boolean): Field | null {
  const { schema: s, nullable } = unwrap(raw);
  // A clip from the library, picked by name (a shot's own source is shown elsewhere, so it has no ref).
  const pickSource = (raw.ref ?? s.ref) === "sources";
  if (HIDDEN.has(key) && !pickSource) return null;
  const fallback = raw.default ?? s.default;
  const base = {
    key,
    label: labelOf(key),
    ...(s.description && { hint: s.description }),
    ...(nullable && { nullable }),
    ...(!required && { optional: true }),
    ...(fallback !== undefined && { default: fallback }),
  };
  if (key === "anchor") return { ...base, label: "Starts at", kind: "time" };
  if (s.enum) return { ...base, kind: "select", options: s.enum.map(String) };
  if (s.type === "string") {
    if (s.pattern?.includes("[0-9a-fA-F]{6}")) return { ...base, kind: "color" };
    if (pickSource) return { ...base, kind: "ref", ref: "sources" };
    const folder = /\b([a-z]+(?:\/[a-z]+)?)\/<\w+>\.css/.exec(s.description ?? "")?.[1];
    const ref = folder ? REF_FOLDERS[folder] : undefined;
    if (ref) return { ...base, kind: "ref", ref };
    return { ...base, kind: (s.maxLength ?? 0) > 120 ? "longtext" : "text" };
  }
  if (s.type === "number" || s.type === "integer") {
    const min = s.minimum ?? s.exclusiveMinimum;
    const max = s.maximum;
    const integer = s.type === "integer";
    const bounded = min !== undefined && max !== undefined && max - min <= 10;
    return {
      ...base,
      kind: bounded ? "range" : "number",
      ...(min !== undefined && { min }),
      ...(max !== undefined && { max }),
      step: integer ? 1 : bounded && max! - min! <= 2 ? 0.01 : 0.1,
    };
  }
  if (s.type === "boolean") return { ...base, kind: "boolean" };
  if (s.type === "array" && unwrap(s.items ?? {}).schema.enum)
    return { ...base, kind: "choices", options: unwrap(s.items ?? {}).schema.enum!.map(String) };
  if (s.type === "array" && unwrap(s.items ?? {}).schema.type === "string") return { ...base, kind: "lines" };
  if (s.type === "object" && s.properties) {
    const keys = Object.keys(s.properties);
    if (keys.length === 2 && keys.includes("x") && keys.includes("y")) return { ...base, kind: "point" };
    const children = childFields(s);
    return children.length ? { ...base, kind: "object", children } : null;
  }
  return null;
}

function childFields(s: JsonSchema): Field[] {
  const required = new Set(s.required ?? []);
  return Object.entries(s.properties ?? {})
    .map(([k, v]) => fieldOf(k, v, required.has(k)))
    .filter((f): f is Field => f !== null);
}

/** An object's value as the renderer sees it: the stored fields over each child's default. */
export function withDefaults(
  field: Field,
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of field.children ?? []) if (c.default !== undefined) out[c.key] = c.default;
  return { ...out, ...value };
}

function fieldsOfSchema(schema: { toJSONSchema(opts?: object): unknown }): Field[] {
  return childFields(schema.toJSONSchema({ io: "input", unrepresentable: "any" }) as JsonSchema);
}

const cache = new Map<string, Field[]>();

export function fieldsFor(coll: keyof typeof CollectionSchemas): Field[] {
  let hit = cache.get(coll);
  if (!hit) {
    hit = fieldsOfSchema(CollectionSchemas[coll] as unknown as { toJSONSchema(opts?: object): unknown });
    cache.set(coll, hit);
  }
  return hit;
}

export function fieldsForSingleton(key: Exclude<Singleton, "style">): Field[] {
  const k = `singleton:${key}`;
  let hit = cache.get(k);
  if (!hit) {
    hit = fieldsOfSchema(SingletonSchemas[key] as unknown as { toJSONSchema(opts?: object): unknown });
    cache.set(k, hit);
  }
  return hit;
}
