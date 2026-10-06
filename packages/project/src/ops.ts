/**
 * Ops are the only way a project changes. The user dragging a clip, the agent adding zooms, a file edited
 * by hand in another editor: all of them become ops. Every op is id-addressed (never index-addressed),
 * validated against the schemas, and invertible, which is what makes undo, history, "undo just the
 * zooms", rebasing agent work onto newer edits, and branches all fall out of one mechanism.
 */
import { z } from "zod";
import {
  COLLECTIONS,
  type Collection,
  CollectionSchemas,
  Id,
  type ItemOf,
  type ProjectDoc,
  SINGLETONS,
  type Singleton,
  SingletonSchemas,
  WordEdit,
} from "./schema.ts";

type AnyItem = ItemOf<Collection>;

export type Op =
  | { op: "insert"; coll: Collection; item: AnyItem; index?: number }
  /** Shallow-merges `patch` into the item. A `null` value removes an optional field. */
  | { op: "update"; coll: Collection; id: string; patch: Record<string, unknown> }
  | { op: "remove"; coll: Collection; id: string }
  | { op: "move"; coll: Collection; id: string; index: number }
  | { op: "set"; key: Singleton; value: unknown }
  /** Shallow-merges `patch` into an object singleton. */
  | { op: "merge"; key: Singleton; patch: Record<string, unknown> };

export class OpError extends Error {
  constructor(
    message: string,
    readonly op: Op,
  ) {
    super(message);
    this.name = "OpError";
  }
}

const Index = z.number().int().nonnegative();

/** Most ids are plain; word edits are addressed "<source id>:<word index>". */
const idOf = (c: Collection) => (c === "wordEdits" ? WordEdit.shape.id : Id);
const Patch = z
  .record(z.string(), z.unknown())
  .describe("Fields to change. Only include fields that change. null removes an optional field.");

/**
 * Runtime schema for one op. Built per collection so the agent sees the exact item shape it must insert,
 * and so ops crossing a process boundary (IPC, files, the model) are checked before they touch a doc.
 */
/** An op schema over some collections and singletons: what a caller (like the agent) may change. */
export function opSchemaFor(
  colls: readonly Collection[],
  singletons: readonly Singleton[] = SINGLETONS,
): z.ZodType<Op> {
  return z.union([
    ...colls.flatMap((c) => [
      z.object({
        op: z.literal("insert"),
        coll: z.literal(c),
        item: CollectionSchemas[c],
        index: Index.optional().describe("Position to insert at; appends when omitted"),
      }),
      z.object({ op: z.literal("update"), coll: z.literal(c), id: idOf(c), patch: Patch }),
      z.object({ op: z.literal("remove"), coll: z.literal(c), id: idOf(c) }),
      z.object({ op: z.literal("move"), coll: z.literal(c), id: idOf(c), index: Index }),
    ]),
    ...singletons.flatMap((key) => [
      z.object({ op: z.literal("set"), key: z.literal(key), value: SingletonSchemas[key] }),
      ...(key === "style" ? [] : [z.object({ op: z.literal("merge"), key: z.literal(key), patch: Patch })]),
    ]),
  ] as unknown as [z.ZodType<Op>, ...z.ZodType<Op>[]]);
}

export const OpSchema: z.ZodType<Op> = opSchemaFor(COLLECTIONS);

export interface Applied {
  readonly doc: ProjectDoc;
  /** Ops that undo this change, in the order they must be applied. */
  readonly inverse: Op[];
}

function parseItem(coll: Collection, value: unknown, op: Op): AnyItem {
  const parsed = CollectionSchemas[coll].safeParse(value);
  if (!parsed.success) throw new OpError(`invalid ${coll} item: ${z.prettifyError(parsed.error)}`, op);
  return parsed.data;
}

function parseSingleton(key: Singleton, value: unknown, op: Op): unknown {
  const parsed = SingletonSchemas[key].safeParse(value);
  if (!parsed.success) throw new OpError(`invalid ${key}: ${z.prettifyError(parsed.error)}`, op);
  return parsed.data;
}

function withList(doc: ProjectDoc, coll: Collection, list: readonly AnyItem[]): ProjectDoc {
  return { ...doc, [coll]: list } as ProjectDoc;
}

function indexOf(list: readonly AnyItem[], id: string, op: Op): number {
  const i = list.findIndex((item) => item.id === id);
  if (i < 0) throw new OpError(`no ${"coll" in op ? op.coll : "item"} with id "${id}"`, op);
  return i;
}

/** Applies one op. Never mutates; untouched collections keep their identity (structural sharing). */
export function applyOp(doc: ProjectDoc, op: Op): Applied {
  switch (op.op) {
    case "insert": {
      const list = doc[op.coll] as readonly AnyItem[];
      const item = parseItem(op.coll, op.item, op);
      if (list.some((x) => x.id === item.id)) throw new OpError(`${op.coll} already has id "${item.id}"`, op);
      const at = Math.min(op.index ?? list.length, list.length);
      const next = [...list.slice(0, at), item, ...list.slice(at)];
      return { doc: withList(doc, op.coll, next), inverse: [{ op: "remove", coll: op.coll, id: item.id }] };
    }
    case "update": {
      const list = doc[op.coll] as readonly AnyItem[];
      const i = indexOf(list, op.id, op);
      const prev = list[i] as Record<string, unknown>;
      if ("id" in op.patch && op.patch.id !== op.id) throw new OpError("ids cannot be changed", op);
      const merged: Record<string, unknown> = { ...prev };
      const before: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.patch)) {
        before[k] = k in prev ? prev[k] : null;
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      const item = parseItem(op.coll, merged, op);
      const next = list.with(i, item);
      return {
        doc: withList(doc, op.coll, next),
        inverse: [{ op: "update", coll: op.coll, id: op.id, patch: before }],
      };
    }
    case "remove": {
      const list = doc[op.coll] as readonly AnyItem[];
      const i = indexOf(list, op.id, op);
      const next = list.toSpliced(i, 1);
      return {
        doc: withList(doc, op.coll, next),
        inverse: [{ op: "insert", coll: op.coll, item: list[i]!, index: i }],
      };
    }
    case "move": {
      const list = doc[op.coll] as readonly AnyItem[];
      const from = indexOf(list, op.id, op);
      const to = Math.min(op.index, list.length - 1);
      if (from === to) return { doc, inverse: [] };
      const next = list.toSpliced(from, 1).toSpliced(to, 0, list[from]!);
      return {
        doc: withList(doc, op.coll, next),
        inverse: [{ op: "move", coll: op.coll, id: op.id, index: from }],
      };
    }
    case "set": {
      const value = parseSingleton(op.key, op.value, op);
      return {
        doc: { ...doc, [op.key]: value } as ProjectDoc,
        inverse: [{ op: "set", key: op.key, value: doc[op.key] }],
      };
    }
    case "merge": {
      const prev = doc[op.key];
      if (typeof prev !== "object" || prev === null) throw new OpError(`${op.key} is not an object`, op);
      const value = parseSingleton(op.key, { ...prev, ...op.patch }, op);
      return {
        doc: { ...doc, [op.key]: value } as ProjectDoc,
        inverse: [{ op: "set", key: op.key, value: prev }],
      };
    }
  }
}

/**
 * Applies ops atomically: all of them or (by throwing) none. `perOp[i]` undoes `ops[i]`; undoing any
 * subset means applying their entries from the highest index down.
 */
export function applyOps(doc: ProjectDoc, ops: readonly Op[]): Applied & { perOp: Op[][] } {
  let current = doc;
  const perOp: Op[][] = [];
  for (const op of ops) {
    const applied = applyOp(current, op);
    current = applied.doc;
    perOp.push(applied.inverse);
  }
  return { doc: current, inverse: perOp.toReversed().flat(), perOp };
}

/** Parses untrusted ops (IPC, model output, files). Returns readable errors instead of throwing. */
export function parseOps(input: unknown): { ok: true; ops: Op[] } | { ok: false; error: string } {
  const parsed = z.array(OpSchema).safeParse(input);
  return parsed.success
    ? { ok: true, ops: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

/** Item ids an op touches, for highlighting "what the AI changed". */
export function touched(op: Op): { coll: Collection | Singleton; id?: string } {
  switch (op.op) {
    case "insert":
      return { coll: op.coll, id: op.item.id };
    case "update":
    case "remove":
    case "move":
      return { coll: op.coll, id: op.id };
    case "set":
    case "merge":
      return { coll: op.key };
  }
}

/**
 * The ops that turn collection `before` into `after`, matched by id. Used when a file in the project
 * folder is edited outside the app: the change comes back in as ordinary, undoable ops.
 */
export function diffCollection<C extends Collection>(
  coll: C,
  before: readonly ItemOf<C>[],
  after: readonly ItemOf<C>[],
): Op[] {
  const ops: Op[] = [];
  const afterIds = new Set(after.map((x) => x.id));
  const beforeById = new Map(before.map((x) => [x.id, x]));
  for (const item of before) if (!afterIds.has(item.id)) ops.push({ op: "remove", coll, id: item.id });

  const order: string[] = before.filter((x) => afterIds.has(x.id)).map((x) => x.id);
  after.forEach((item, index) => {
    const prev = beforeById.get(item.id);
    if (!prev) {
      ops.push({ op: "insert", coll, item, index });
      order.splice(index, 0, item.id);
      return;
    }
    const patch: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(item)]);
    for (const k of keys) {
      const a = (prev as Record<string, unknown>)[k];
      const b = (item as Record<string, unknown>)[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) patch[k] = b === undefined ? null : b;
    }
    if (Object.keys(patch).length) ops.push({ op: "update", coll, id: item.id, patch });
    const at = order.indexOf(item.id);
    if (at !== index) {
      ops.push({ op: "move", coll, id: item.id, index });
      order.splice(at, 1);
      order.splice(index, 0, item.id);
    }
  });
  return ops;
}
