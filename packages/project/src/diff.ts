import { diffCollection, type Op } from "./ops.ts";
import { COLLECTIONS, type Collection, type ProjectDoc, SINGLETONS, type Singleton } from "./schema.ts";

/**
 * The ops that turn `from` into `to`, section by section. Used for outside file edits, switching to a
 * saved version and restoring history: every one of them lands as an ordinary, undoable commit.
 */
export function diffDocs(
  from: ProjectDoc,
  to: Partial<ProjectDoc>,
  skip: readonly (Collection | Singleton)[] = [],
): Op[] {
  const ops: Op[] = [];
  for (const coll of COLLECTIONS) {
    if (skip.includes(coll) || !(coll in to) || from[coll] === to[coll]) continue;
    ops.push(...diffCollection(coll, from[coll], to[coll] as ProjectDoc[typeof coll]));
  }
  for (const key of SINGLETONS) {
    if (skip.includes(key) || !(key in to) || from[key] === to[key]) continue;
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) ops.push({ op: "set", key, value: to[key] });
  }
  return ops;
}
