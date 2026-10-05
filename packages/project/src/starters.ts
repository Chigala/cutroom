/**
 * Built-in files (effects, graphics, caption looks, transitions, grades) are ordinary files in each
 * project, written in when it's made. Built-ins added to the app later are written into older projects
 * once, the first time they open (meta.starters says which have been given), so every effect a project
 * can use is a file in it that the agent and the user can read and change. One deleted stays deleted.
 */
import { STARTER_CAPTION_LOOKS } from "./caption-looks.ts";
import type { Op } from "./ops.ts";
import type { ProjectDoc } from "./schema.ts";
import { STARTER_GRAPHICS } from "./starter-graphics.ts";
import { STARTER_EFFECTS, STARTER_GRADES, STARTER_TRANSITIONS } from "./styles.ts";

/** The current set of built-ins. Bump it when adding one, and list it in ADDED. */
export const STARTER_VERSION = 3;

/** Built-ins added after the first set, by the version that brought them. */
const ADDED: Readonly<Record<string, number>> = {
  "effectKinds/color-pop": 2,
  "effectKinds/spotlight": 2,
  "effectKinds/glow-pulse": 2,
  "effectKinds/sticker": 2,
  "effectKinds/pop-out": 2,
  "graphics/trend": 3,
  "graphics/celebrate": 3,
};

const SETS = [
  ["effectKinds", STARTER_EFFECTS],
  ["transitionKinds", STARTER_TRANSITIONS],
  ["grades", STARTER_GRADES],
  ["graphics", STARTER_GRAPHICS],
  ["captionLooks", STARTER_CAPTION_LOOKS],
] as const;

/** The ops that give a project the built-ins added since it last got some (none when it's current). */
export function starterOps(doc: ProjectDoc): Op[] {
  const have = doc.meta.starters ?? 1;
  if (have >= STARTER_VERSION) return [];
  const ops: Op[] = [];
  for (const [coll, items] of SETS)
    for (const item of items) {
      const since = ADDED[`${coll}/${item.id}`] ?? 1;
      const present = (doc[coll] as readonly { id: string }[]).some((x) => x.id === item.id);
      if (since > have && !present) ops.push({ op: "insert", coll, item } as Op);
    }
  ops.push({ op: "merge", key: "meta", patch: { starters: STARTER_VERSION } });
  return ops;
}
