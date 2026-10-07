/**
 * The project's shapes written for the model, read off the same schemas every edit is checked against
 * (schema.ts), so they can't drift. Two forms: a compact line per collection and setting (field names,
 * types, choices: enough to write an edit), sent with apply_ops every request; and one collection's
 * fields in full (what each does, its default), which the fields tool looks up when it's needed.
 */
import { type Collection, CollectionSchemas, DERIVED, SINGLETONS, SingletonSchemas } from "@vedit/project";
import { z } from "zod";

type Json = Record<string, unknown>;

/** The collections the agent edits with ops: not what indexing writes, nor inspirations (their own tool). */
export const EDITABLE: readonly Collection[] = (Object.keys(CollectionSchemas) as Collection[]).filter(
  (c) => !DERIVED.includes(c) && c !== "inspirations",
);

export const schemaOf = (name: string): z.ZodType | undefined =>
  (CollectionSchemas as Record<string, z.ZodType>)[name] ??
  (SingletonSchemas as Record<string, z.ZodType>)[name];

const json = new Map<string, Json>();
/** A collection's or setting's JSON Schema (made once). */
const jsonOf = (name: string): Json => {
  const made = json.get(name);
  if (made) return made;
  const s = z.toJSONSchema(schemaOf(name)!, { io: "input", unrepresentable: "any" }) as Json;
  json.set(name, s);
  return s;
};

/** Past this many choices a list is cut short in the compact form (the fields tool has them all). */
const MANY = 24;

const resolve = (s: Json, root: Json): Json =>
  typeof s.$ref === "string"
    ? s.$ref === "#"
      ? root
      : (((root.$defs as Json | undefined)?.[s.$ref.split("/").pop()!] as Json | undefined) ?? {})
    : s;

const variants = (s: Json) => (s.anyOf ?? s.oneOf) as Json[] | undefined;

/** A bound worth saying (not the safe-integer limits zod gives a bare int). */
const bound = (n: unknown) => (typeof n === "number" && Math.abs(n) < 1e15 ? n : undefined);

/** One schema as a short type: `number 0..2`, `"a"|"b"`, `{scene, at}`, `{...}[]`, `[number, number]`. */
function typeOf(schema: Json, root: Json, full: boolean): string {
  const s = resolve(schema, root);
  if ("const" in s) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) {
    const values = s.enum.map((v) => JSON.stringify(v));
    return !full && values.length > MANY
      ? `${values.slice(0, MANY).join("|")}|… (${values.length})`
      : values.join("|");
  }
  const options = variants(s);
  if (options) return [...new Set(options.map((o) => typeOf(o, root, full)))].join(" | ");
  if (s.type === "array") {
    if (Array.isArray(s.prefixItems))
      return `[${(s.prefixItems as Json[]).map((x) => typeOf(x, root, full)).join(", ")}]`;
    const item = s.items ? typeOf(s.items as Json, root, full) : "any";
    return item.includes(" ") && !item.startsWith("{") ? `(${item})[]` : `${item}[]`;
  }
  if (s.type === "object" || s.properties) {
    if (s.properties) return objectOf(s, root, full);
    return s.additionalProperties && typeof s.additionalProperties === "object"
      ? `{[key]: ${typeOf(s.additionalProperties as Json, root, full)}}`
      : "{}";
  }
  if (s.type === "number" || s.type === "integer") {
    const lo = bound(s.minimum ?? s.exclusiveMinimum);
    const hi = bound(s.maximum ?? s.exclusiveMaximum);
    const range =
      lo !== undefined && hi !== undefined
        ? ` ${lo}..${hi}`
        : lo !== undefined
          ? ` ≥${lo}`
          : hi !== undefined
            ? ` ≤${hi}`
            : "";
    return `${s.type === "integer" ? "int" : "number"}${range}`;
  }
  if (s.type === "boolean") return "bool";
  if (s.type === "string" || s.type === "null") return s.type;
  return "any";
}

/** An object's fields: `{a, b?: number, c: {d}}` (a plain string field is just its name). */
function objectOf(s: Json, root: Json, full: boolean): string {
  const required = new Set((s.required as string[] | undefined) ?? []);
  const fields = Object.entries(s.properties as Record<string, Json>).map(([k, v]) => {
    const t = typeOf(v, root, full);
    const name = required.has(k) ? k : `${k}?`;
    return t === "string" ? name : `${name}: ${t}`;
  });
  return `{${fields.join(", ")}}`;
}

/** Every collection and setting the agent edits, one line each: names, types and choices. */
export function compactFields(): string {
  return [...EDITABLE, ...SINGLETONS]
    .map((name) => {
      const root = jsonOf(name);
      return `${name}: ${typeOf(root, root, false)}`;
    })
    .join("\n");
}

/** What a field does and its default, as a trailing comment. */
const noteOf = (v: Json) =>
  [
    typeof v.description === "string" ? v.description : null,
    "default" in v ? `default ${JSON.stringify(v.default)}` : null,
  ]
    .filter(Boolean)
    .join("; ");

/** The object variants of a field (one for an optional object, several for a union like content). */
function objectsIn(v: Json, root: Json): Json[] {
  const s = resolve(v, root);
  const options = variants(s);
  if (options) return options.flatMap((o) => objectsIn(o, root));
  if (s.properties) return [s];
  if (s.type === "array" && s.items) return objectsIn(s.items as Json, root);
  return [];
}

/** What tells a union's variants apart: its fixed fields, like `kind: "graphic"`. */
const tagOf = (o: Json) =>
  Object.entries(o.properties as Record<string, Json>)
    .filter(([, p]) => "const" in p)
    .map(([k, p]) => `${k}: ${JSON.stringify(p.const)}`)
    .join(", ") || "another kind";

/** An object's fields in full, one per line and nested, each with what it does and its default. */
function fullOf(s: Json, root: Json, indent: string, out: string[], tagged = false): void {
  const required = new Set((s.required as string[] | undefined) ?? []);
  for (const [k, raw] of Object.entries((s.properties ?? {}) as Record<string, Json>)) {
    const v = resolve(raw, root);
    // A variant's fixed fields are already its heading.
    if (tagged && "const" in v) continue;
    const objects = objectsIn(v, root);
    const others = (variants(v) ?? [])
      .filter((o) => !objectsIn(o, root).length)
      .map((o) => typeOf(o, root, true));
    const list = v.type === "array" || variants(v)?.some((o) => resolve(o, root).type === "array");
    const shape = !objects.length
      ? typeOf(v, root, true)
      : [objects.length > 1 ? "one of:" : `{…}${list ? "[]" : ""}`, ...others].join(" | ");
    const note = noteOf(v);
    out.push(`${indent}${required.has(k) ? k : `${k}?`}: ${shape}${note ? `  // ${note}` : ""}`);
    if (objects.length === 1) fullOf(objects[0]!, root, `${indent}  `, out);
    else
      for (const o of objects) {
        out.push(`${indent}  - ${tagOf(o)}${noteOf(o) ? `  // ${noteOf(o)}` : ""}`);
        fullOf(o, root, `${indent}    `, out, true);
      }
  }
}

/** One collection's or setting's fields in full, for the fields tool. */
export function fieldsOf(name: string): string | null {
  if (!schemaOf(name)) return null;
  const root = jsonOf(name);
  const objects = objectsIn(root, root);
  if (!objects.length) return `${name}: ${typeOf(root, root, true)}`;
  const out: string[] = [];
  for (const o of objects) {
    if (objects.length > 1) out.push(`- ${tagOf(o)}${noteOf(o) ? `  // ${noteOf(o)}` : ""}`);
    fullOf(o, root, objects.length > 1 ? "  " : "", out, objects.length > 1);
  }
  return `${name}${EDITABLE.includes(name as Collection) ? " (each item)" : ""}:\n${out.join("\n")}`;
}

export interface UnknownField {
  /** Where it is, like `fontSize` or `content.fontSize`. */
  readonly path: string;
  /** The fields that level does take. */
  readonly known: readonly string[];
}

/**
 * Fields in an item, patch or setting its schema doesn't have: a misspelt or invented one, which parsing
 * would quietly drop. Wrong types and missing fields aren't looked for here: the schema reports those.
 */
export function unknownFields(name: string, value: unknown): UnknownField[] {
  if (!schemaOf(name)) return [];
  const root = jsonOf(name);
  const out: UnknownField[] = [];
  walk(root, value, "", root, out);
  return out;
}

/** Whether a value could be this variant: the same kind of thing, its fixed fields agreeing. */
function couldBe(o: Json, value: unknown): boolean {
  if (Array.isArray(value)) return o.type === "array";
  if (!o.properties) return false;
  return Object.entries(o.properties as Record<string, Json>).every(
    ([k, p]) =>
      !("const" in p) ||
      (value as Record<string, unknown>)[k] === undefined ||
      (value as Record<string, unknown>)[k] === p.const,
  );
}

function walk(schema: Json, value: unknown, path: string, root: Json, out: UnknownField[]): void {
  if (value === null || typeof value !== "object") return;
  const s = resolve(schema, root);
  const options = variants(s);
  if (options) {
    // The variant it fits best (fewest unknown fields); one it can't be is the schema's to report.
    let best: UnknownField[] | null = null;
    for (const o of options.map((x) => resolve(x, root)).filter((x) => couldBe(x, value))) {
      const found: UnknownField[] = [];
      walk(o, value, path, root, found);
      if (!best || found.length < best.length) best = found;
      if (!found.length) break;
    }
    out.push(...(best ?? []));
    return;
  }
  if (Array.isArray(value)) {
    if (s.type === "array" && s.items)
      for (const [i, v] of value.entries()) walk(s.items as Json, v, `${path}[${i}]`, root, out);
    return;
  }
  // Anything goes (unknown, any), or not an object at all: nothing to check here.
  if (s.type !== "object" && !s.properties) return;
  const props = (s.properties ?? {}) as Record<string, Json>;
  const extra = s.additionalProperties;
  for (const [k, v] of Object.entries(value)) {
    const at = path ? `${path}.${k}` : k;
    if (k in props) walk(props[k]!, v, at, root, out);
    else if (extra && typeof extra === "object") walk(extra as Json, v, at, root, out);
    else if (extra !== true) out.push({ path: at, known: Object.keys(props) });
  }
}
