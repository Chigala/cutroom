import { describe, expect, it } from "vitest";
import { applyOps, emptyProject, STARTER_EFFECTS, STARTER_VERSION, starterOps } from "./index.ts";

describe("built-in files", () => {
  it("gives older projects the built-ins added since, as files, once, without bringing back deleted ones", () => {
    const fresh = emptyProject("t");
    expect(starterOps(fresh)).toEqual([]);
    // A project from before the subject effects, whose owner deleted the shake.
    const old = {
      ...fresh,
      meta: { ...fresh.meta, starters: undefined },
      effectKinds: STARTER_EFFECTS.filter(
        (f) => !["color-pop", "spotlight", "glow-pulse", "sticker", "pop-out", "shake"].includes(f.id),
      ),
    };
    const ops = starterOps(old);
    const added = ops.flatMap((o) => (o.op === "insert" ? [(o.item as { id: string }).id] : []));
    expect(added.sort()).toEqual(["color-pop", "glow-pulse", "pop-out", "spotlight", "sticker"]);
    const { doc } = applyOps(old, ops);
    expect(doc.meta.starters).toBe(STARTER_VERSION);
    expect(doc.effectKinds.some((f) => f.id === "shake")).toBe(false);
    expect(starterOps(doc)).toEqual([]);
  });
});
