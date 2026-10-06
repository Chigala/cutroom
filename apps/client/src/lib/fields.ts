/**
 * Form fields generated from the project's own schemas (the export settings): nothing hard-codes what a
 * settings file has. It reads the zod schema (as JSON Schema) and builds an editor for each property. Add a
 * field to a schema and it shows up, with its limits, options and description.
 */
import { type Singleton, SingletonSchemas } from "@vedit/project";

type FieldKind =
  | "text"
  | "longtext"
  | "number"
  | "range"
  | "boolean"
  | "select"
  | "color"
  | "lines"
  | "choices";

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
}

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
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
const labelOf = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return label.replace(/\b(sfx|lufs|fps)\b/gi, (w) => w.toUpperCase()).replace(/\bjl\b/i, "J/L");
};

/** Fields shown elsewhere, or that only the system writes. */
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
  if (HIDDEN.has(key)) return null;
  const fallback = raw.default ?? s.default;
  const base = {
    key,
    label: labelOf(key),
    ...(s.description && { hint: s.description }),
    ...(nullable && { nullable }),
    ...(!required && { optional: true }),
    ...(fallback !== undefined && { default: fallback }),
  };
  if (s.enum) return { ...base, kind: "select", options: s.enum.map(String) };
  if (s.type === "string") {
    if (s.pattern?.includes("[0-9a-fA-F]{6}")) return { ...base, kind: "color" };
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
  // Groups of settings have no control here: they're asked for in chat.
  return null;
}

function childFields(s: JsonSchema): Field[] {
  const required = new Set(s.required ?? []);
  return Object.entries(s.properties ?? {})
    .map(([k, v]) => fieldOf(k, v, required.has(k)))
    .filter((f): f is Field => f !== null);
}

function fieldsOfSchema(schema: { toJSONSchema(opts?: object): unknown }): Field[] {
  return childFields(schema.toJSONSchema({ io: "input", unrepresentable: "any" }) as JsonSchema);
}

const cache = new Map<string, Field[]>();

export function fieldsForSingleton(key: Exclude<Singleton, "style">): Field[] {
  const k = `singleton:${key}`;
  let hit = cache.get(k);
  if (!hit) {
    hit = fieldsOfSchema(SingletonSchemas[key] as unknown as { toJSONSchema(opts?: object): unknown });
    cache.set(k, hit);
  }
  return hit;
}
