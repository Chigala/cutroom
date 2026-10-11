/**
 * The review before a request finishes, run by the editor rather than left to the prompt: when the agent
 * says it's done and it changed the project, the checks run (and the motion is measured when anything that
 * moves changed, and new graphics are read for their craft). Whatever it caused that falls short goes back
 * to it as one message, and it gets another turn to fix it, at most twice a request. A clean edit
 * finishes at once. Weaker models skip the final checks under a long request; this way no edit reaches
 * the user unchecked. A quick request ("light") measures the motion only when it wrote a graphic.
 */
import { runChecks } from "@vedit/checks";
import { lintGraphic, type ProjectDoc } from "@vedit/project";
import { refitMusic, snapCutsToBeat, type ToolContext } from "./tools.ts";

/** How many times one request can be sent back. */
const MAX_ROUNDS = 2;

/** What draws or moves on screen: a change here means the motion is measured again. */
const MOVING = [
  "visuals",
  "titles",
  "zooms",
  "effects",
  "graphics",
  "transitionKinds",
  "effectKinds",
] as const;

/**
 * The review for one request: call it each time the agent wants to stop. Returns what to fix (the agent
 * carries on) or null (it may finish).
 */
export function finishReview(
  before: ProjectDoc,
  ctx: ToolContext,
  depth: "full" | "light" = "full",
): () => Promise<string | null> {
  // What already fell short before this request isn't the agent's to fix unasked.
  const already = new Set(
    runChecks(before)
      .filter((r) => r.status !== "pass")
      .map((r) => r.id),
  );
  let rounds = 0;
  return async () => {
    if (rounds >= MAX_ROUNDS || !ctx.scratch.ops.length || !ctx.scratch.doc.scenes.length) return null;
    ctx.activity?.("Checking the edit");
    // What the end of a request does by itself (music refitted, cuts onto the beat) first, so what's
    // checked is what the user gets. Both do nothing the second time.
    await refitMusic(ctx);
    snapCutsToBeat(ctx);
    const doc = ctx.scratch.doc;
    const found: string[] = [];

    for (const r of runChecks(doc)) {
      if (r.status === "pass" || already.has(r.id)) continue;
      found.push(
        `${r.status.toUpperCase()} ${r.id}: ${r.title}${r.detail ? ` (${r.detail})` : ""}${r.fix ? ` [apply_fix: ${r.fix.label}]` : ""}`,
      );
    }
    for (const [id, message] of ctx.scratch.graphicErrors ?? []) {
      if (doc.graphics.some((g) => g.id === id)) found.push(`Graphic ${id} throws when rendered: ${message}`);
    }
    for (const g of doc.graphics) {
      const was = before.graphics.find((x) => x.id === g.id);
      if (
        was?.html === g.html ||
        !doc.visuals.some((v) => v.content.kind === "graphic" && v.content.graphic === g.id)
      )
        continue;
      for (const lint of lintGraphic(g.html)) found.push(`Graphic ${g.id}: ${lint.message}`);
    }
    // The motion takes about a second per second of video to measure: always for a first cut or a big
    // request, and for a quick one only when it wrote a graphic (an unchanged edit answers from the cache).
    const moved =
      depth === "full"
        ? MOVING.some((c) => JSON.stringify(before[c]) !== JSON.stringify(doc[c]))
        : doc.graphics.some((g) => before.graphics.find((x) => x.id === g.id)?.html !== g.html);
    if (moved && ctx.host.senseMotion) {
      try {
        ctx.activity?.("Measuring the motion");
        const report = await ctx.host.senseMotion(doc);
        for (const i of report.issues)
          found.push(
            `${i.start.toFixed(2)}s${i.end > i.start ? `-${i.end.toFixed(2)}s` : ""} motion ${i.kind}${i.items.length ? ` (${i.items.join(", ")})` : ""}: ${i.detail}`,
          );
      } catch (err) {
        console.warn(`[review] motion not measured: ${(err as Error).message}`);
      }
    }

    if (!found.length) {
      ctx.step("Checked the edit: clean");
      return null;
    }
    rounds++;
    ctx.step(`Checked the edit: ${found.length} to fix`, "warn");
    return [
      `Before you finish: the editor checked your edit and found ${found.length === 1 ? "one thing" : `${found.length} things`} you changed that fall short of the bar.`,
      ...found.map((f) => `- ${f}`),
      "",
      "Fix them now (a check's own fix with apply_fix where it offers one), then look at what you fixed. When one is deliberate, keep it and say why in your reply. Then finish as usual: the short summary and the Next line.",
    ].join("\n");
  };
}
