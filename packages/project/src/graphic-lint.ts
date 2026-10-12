/**
 * A graphic's craft, read off its file before it's ever rendered: the habits that make motion look
 * cheap or break in export (linear or default easing, nothing that leaves, pixel font sizes, timers the
 * video clock never fires, banned faces, on-screen text rules). validateGraphic says whether a graphic
 * runs at all; this says whether it's up to the bar. Each finding is advice the agent acts on, never a
 * refusal: a deliberate choice (a linear progress bar) stays possible.
 */
import { GraphicError, graphicParams, isScripted, parseGraphic } from "./graphic.ts";

export interface GraphicLint {
  /** What it's about, for grouping: motion, type, text, script. */
  readonly kind: "motion" | "type" | "text" | "script";
  readonly message: string;
}

/** Faces the house style never uses unless the user names one (prompt.ts, Type). */
const BANNED_FACES = /\b(arial|courier(?: new)?|comic sans(?: ms)?|agency fb|lucida[\w ]*|papyrus)\b/i;

/** The browser's keyword curves: "ease" and friends read as a default, "linear" as mechanical. */
const KEYWORD_EASE =
  /\b(?:animation|transition)(?:-timing-function)?\s*:[^;{}]*?(?<![-\w])(linear|ease(?:-in-out|-in|-out)?)(?![-\w])/gi;

const EMOJI = /\p{Extended_Pictographic}/u;

export function lintGraphic(html: string): GraphicLint[] {
  let meta: ReturnType<typeof parseGraphic>["meta"];
  let body: string;
  try {
    ({ meta, body } = parseGraphic(html));
  } catch (err) {
    if (err instanceof GraphicError) return [];
    throw err;
  }
  const out: GraphicLint[] = [];
  const scripted = isScripted(meta, body);
  const css = [...body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const script = [...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");

  const curves = new Set([...css.matchAll(KEYWORD_EASE)].map((m) => m[1]!.toLowerCase()));
  if (curves.has("linear"))
    out.push({
      kind: "motion",
      message:
        "linear timing: moves read as mechanical. Ease them (var(--ease), or cubic-bezier(.16,1,.3,1) in, (.7,0,.84,0) out); keep linear only for something that really runs at a constant rate (a progress bar, a ticker).",
    });
  const keywords = [...curves].filter((c) => c !== "linear");
  if (keywords.length)
    out.push({
      kind: "motion",
      message: `the browser's default curve (${keywords.join(", ")}) looks templated: use var(--ease) or a cubic-bezier from the motion system.`,
    });

  const moves = /@keyframes|animation\s*:|transition\s*:/i.test(css) || /gsap\.|onFrame\s*\(/.test(script);
  const leaves =
    /var\(\s*--exit\b/.test(body) ||
    /\bclass\s*=\s*["'][^"']*\bout\b/.test(body) ||
    /\bf\.duration\b|\bduration\s*-|graphic\.timeline/.test(script);
  if (moves && !leaves)
    out.push({
      kind: "motion",
      message:
        "nothing leaves: it will pop off when its time is up. Give it an exit that starts at var(--exit) (or, in a script, from f.duration - 0.35s), quicker than the entrance.",
    });

  const pixelType = /font-size\s*:\s*\d+(?:\.\d+)?px/i.test(css);
  if (pixelType)
    out.push({
      kind: "type",
      message:
        "font sizes in px don't scale with the frame (full, split, other shapes): size type in cqw/cqh (display 7-12cqw, labels 2.5-4cqw).",
    });
  const face = BANNED_FACES.exec(css);
  if (face)
    out.push({
      kind: "type",
      message: `${face[1]} reads as a default: use the video's type (var(--font), or a face from the type sets) unless the user asked for it.`,
    });

  if (scripted) {
    if (/\b(setTimeout|setInterval)\s*\(/.test(script))
      out.push({
        kind: "script",
        message:
          "setTimeout/setInterval never fire on the video clock (export draws frames out of order): drive everything from t in graphic.onFrame or with GSAP tweens.",
      });
    if (/\brequestAnimationFrame\s*\(/.test(script))
      out.push({
        kind: "script",
        message: "requestAnimationFrame never fires: draw each frame in graphic.onFrame((t, f) => ...).",
      });
  }

  for (const [key, value] of Object.entries(graphicParams(meta, {}))) {
    const texts = Array.isArray(value) ? value : [value];
    for (const text of texts) {
      if (typeof text !== "string") continue;
      const problems = [
        EMOJI.test(text) && "an emoji",
        /!/.test(text) && "an exclamation mark",
        /—/.test(text) && "an em dash",
      ].filter(Boolean);
      if (problems.length)
        out.push({
          kind: "text",
          message: `param "${key}" defaults to text with ${problems.join(" and ")}: on-screen text uses none.`,
        });
    }
  }
  return out;
}

/** Findings as lines for the agent, or "" when the graphic is clean. */
export function lintView(id: string, lints: readonly GraphicLint[]): string {
  if (!lints.length) return "";
  return [
    `Craft notes on ${id} (fix them, or keep one only when it's deliberate):`,
    ...lints.map((l) => `- ${l.message}`),
  ].join("\n");
}
