/**
 * Effects, transitions and grades are files, like graphics and caption looks, so every opinion about how
 * the video moves and looks is a default someone can open and change (or ask the agent to):
 *
 *   effects/<id>.css        an effect placed in time (motion/effects.json picks one by kind)
 *   transitions/<id>.css    how a shot comes in from the one before it (a scene's transition.kind)
 *   grades/<id>.css         the colour grade of the whole video (look.grade)
 *
 * Each is plain CSS over a few layers. The footage itself is never inside the CSS's reach: the layers
 * are stand-ins the size of the frame, and what the CSS does to them (transform, filter, opacity,
 * clip-path, border-radius) is applied to the footage, every frame:
 *
 *   effect      .frame (the picture, under the effect)    .overlay (drawn on top of the video)
 *               .subject (the person alone, cut out)      .background (the picture behind them)
 *   transition  .out (the shot leaving)  .in (the shot coming in)  .overlay (on top, during the change)
 *   grade       .picture (all the footage)                .overlay (on top of the footage)
 *
 * Variables: --t (seconds since it started; for a grade, the video's time), --duration, --progress
 * (0..1), --accent. Sizes: px are frame pixels (1080 wide); the layers are size containers, so cqw/cqh
 * work too. Motion is CSS animations, seeked to --t, so a frame always looks the same.
 *
 * Header, optional: a comment like / * effect {"name": "Shake", "description": "...", "duration": 0.5} * /
 * (tag effect, transition or grade, without the spaces).
 */

import { GradeColor } from "./grading.ts";
import type { StyleFile } from "./schema.ts";

export type StyleKind = "effect" | "transition" | "grade";

export interface StyleMeta {
  readonly name?: string;
  readonly description?: string;
  /** Suggested length in seconds, for effects and transitions. */
  readonly duration?: number;
  /** A grade's colour: white balance, lift/gamma/gain, curves, a LUT (GradeColor in grading.ts). */
  readonly color?: unknown;
}

/** The JSON header of an effect, transition or grade file. */
export function styleMeta(css: string): StyleMeta | null {
  const m = /\/\*\s*(?:effect|transition|grade)\s+(\{[\s\S]*?\})\s*\*\//.exec(css);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as StyleMeta;
  } catch {
    return null;
  }
}

/** A grade file's colour (its header's "color"), or null when it has none. Throws on a bad one. */
export function gradeColorOf(css: string): GradeColor | null {
  const color = styleMeta(css)?.color;
  if (color === undefined) return null;
  const parsed = GradeColor.strict().safeParse(color);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `the grade's color${issue?.path.length ? `.${issue.path.join(".")}` : ""}: ${issue?.message}`,
    );
  }
  return parsed.data;
}

/** The layers each kind of file styles: stand-ins whose styles go onto the footage. */
export const STYLE_LAYERS: Readonly<Record<StyleKind, readonly string[]>> = {
  effect: ["frame", "subject", "background"],
  transition: ["out", "in"],
  grade: ["picture"],
};

/** A readable problem with a style file, or null. Self-contained CSS: no imports, no remote files. */
export function validateStyle(kind: StyleKind, css: string): string | null {
  if (/@import\b/i.test(css)) return "style files can't @import";
  if (/url\(\s*['"]?\s*(https?:|\/\/)/i.test(css))
    return "style files can't load remote files (data: URLs are fine)";
  if (/<\/?style|<script/i.test(css)) return "this is plain CSS, without <style> or <script> tags";
  let color: GradeColor | null = null;
  if (kind === "grade")
    try {
      color = gradeColorOf(css);
    } catch (err) {
      return (err as Error).message;
    }
  const layers = [...STYLE_LAYERS[kind], "overlay"];
  // A grade can be all colour (its header), with no CSS at all.
  if (!color && !layers.some((l) => new RegExp(`\\.${l}\\b`).test(css)))
    return `a ${kind} styles ${layers.map((l) => `.${l}`).join(" or ")}`;
  return null;
}

const file = (tag: StyleKind, id: string, meta: object, css: string): StyleFile => ({
  id,
  css: `/* ${tag} ${JSON.stringify(meta)} */\n${css.trim().replace(/^ {4}/gm, "")}\n`,
});

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

/** The house shake: a decaying wobble over 14 frames at 30fps, as keyframes. */
function shakeKeyframes(): string {
  const frames = 14;
  const lines: string[] = [];
  for (let t = 0; t <= frames; t++) {
    const decay = (1 - t / frames) ** 2;
    const x = Math.sin(t * 2.3) * 22 * decay;
    const y = Math.cos(t * 3.1) * 16 * decay;
    lines.push(`      ${pct(t / frames)} { transform: translate(${x.toFixed(1)}px, ${y.toFixed(1)}px); }`);
  }
  return lines.join("\n");
}

const EFFECTS: StyleFile[] = [
  file(
    "effect",
    "shake",
    {
      name: "Shake",
      description: "A short camera jolt on an impact word; pair it with a boom",
      duration: 0.5,
    },
    `
    .frame { animation: shake 0.467s linear both; }
    @keyframes shake {
${shakeKeyframes()}
    }
    `,
  ),
  file(
    "effect",
    "whip",
    {
      name: "Whip",
      description: "The picture whips in from the side, blurred, on a hard change of subject",
      duration: 0.3,
    },
    `
    .frame { animation: whip 0.267s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
    @keyframes whip {
      from { transform: translateX(-520px); filter: blur(40px); }
      to { transform: none; filter: blur(0); }
    }
    `,
  ),
  file(
    "effect",
    "flash",
    { name: "Flash", description: "A white flash, as a cut accent", duration: 0.3 },
    `
    .overlay {
      position: absolute;
      inset: 0;
      background: #fff;
      animation: up 0.067s linear both, down calc(var(--duration) - 0.067s) linear 0.067s forwards;
    }
    @keyframes up { from { opacity: 0; } to { opacity: 0.85; } }
    @keyframes down { from { opacity: 0.85; } to { opacity: 0; } }
    `,
  ),
  file(
    "effect",
    "mono",
    {
      name: "Black and white",
      description: "Black and white for a while, for a flashback or a serious beat",
      duration: 2,
    },
    `
    /* Fades in over 0.2s and out over the last 0.2s, whatever the length. */
    .frame {
      animation:
        in 0.2s cubic-bezier(0.65, 0, 0.35, 1) both,
        out 0.2s cubic-bezier(0.65, 0, 0.35, 1) calc(var(--duration) - 0.2s) forwards;
    }
    @keyframes in { from { filter: grayscale(0); } to { filter: grayscale(1); } }
    @keyframes out { from { filter: grayscale(1); } to { filter: grayscale(0); } }
    `,
  ),
  file(
    "effect",
    "glitch",
    {
      name: "Glitch",
      description: "A digital stutter: the picture jumps, splits colour and tears for a moment",
      duration: 0.4,
    },
    `
    .frame { animation: jitter var(--duration) steps(1, end) both; }
    @keyframes jitter {
      0% { transform: translate(-18px, 4px); filter: hue-rotate(40deg) saturate(1.6); }
      15% { transform: translate(22px, -6px); filter: hue-rotate(-60deg) contrast(1.4); }
      30% { transform: translate(-8px, 0); clip-path: inset(12% 0 40% 0); }
      45% { transform: translate(14px, 8px); clip-path: inset(55% 0 8% 0); filter: invert(0.15); }
      60% { transform: translate(-4px, -3px); clip-path: none; filter: hue-rotate(20deg); }
      80%, 100% { transform: none; filter: none; clip-path: none; }
    }
    .overlay {
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.06) 0 2px, transparent 2px 6px);
      mix-blend-mode: screen;
      animation: blink var(--duration) steps(1, end) both;
    }
    @keyframes blink { 0%, 60% { opacity: 1; } 80%, 100% { opacity: 0; } }
    `,
  ),
  file(
    "effect",
    "rgb-split",
    {
      name: "RGB split",
      description: "Red and cyan ghosts pull apart and snap back, on a beat",
      duration: 0.5,
    },
    `
    .frame { animation: split var(--duration) cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes split {
      from {
        filter: drop-shadow(14px 0 0 rgba(255, 0, 60, 0.75)) drop-shadow(-14px 0 0 rgba(0, 230, 255, 0.75));
      }
      to { filter: drop-shadow(0 0 0 rgba(255, 0, 60, 0)) drop-shadow(0 0 0 rgba(0, 230, 255, 0)); }
    }
    `,
  ),
  file(
    "effect",
    "zoom-blur",
    {
      name: "Zoom blur",
      description: "The picture punches in with a blur and settles, for a reveal",
      duration: 0.5,
    },
    `
    .frame { animation: punch var(--duration) cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes punch {
      from { transform: scale(1.25); filter: blur(18px) brightness(1.2); }
      to { transform: none; filter: none; }
    }
    `,
  ),
  file(
    "effect",
    "film-burn",
    { name: "Film burn", description: "A warm burn of light sweeps across the frame", duration: 1.2 },
    `
    .overlay {
      position: absolute;
      inset: -20%;
      background:
        radial-gradient(40% 35% at 30% 40%, rgba(255, 170, 60, 0.95), transparent 70%),
        radial-gradient(35% 30% at 70% 60%, rgba(255, 80, 30, 0.8), transparent 70%),
        radial-gradient(60% 50% at 50% 50%, rgba(255, 230, 180, 0.6), transparent 75%);
      mix-blend-mode: screen;
      animation: burn var(--duration) ease-in-out both;
    }
    @keyframes burn {
      0% { opacity: 0; transform: translateX(-30%) scale(0.9); }
      35% { opacity: 1; }
      100% { opacity: 0; transform: translateX(25%) scale(1.15); }
    }
    `,
  ),
  file(
    "effect",
    "light-leak",
    { name: "Light leak", description: "A soft warm leak drifts in from the edge and fades", duration: 1.5 },
    `
    .overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(115deg, rgba(255, 120, 40, 0) 20%, rgba(255, 150, 70, 0.55) 45%, rgba(255, 220, 160, 0.35) 60%, rgba(255, 120, 40, 0) 80%);
      mix-blend-mode: screen;
      animation: leak var(--duration) ease-in-out both;
    }
    @keyframes leak {
      0% { opacity: 0; transform: translateX(-40%); }
      40% { opacity: 1; }
      100% { opacity: 0; transform: translateX(30%); }
    }
    `,
  ),
];

const TRANSITIONS: StyleFile[] = [
  file(
    "transition",
    "crossfade",
    { name: "Crossfade", description: "The new shot fades in over the old one", duration: 0.4 },
    `
    .in { animation: fade var(--duration) ease-in-out both; }
    @keyframes fade { from { opacity: 0; } }
    `,
  ),
  file(
    "transition",
    "whip-pan",
    {
      name: "Whip pan",
      description: "Both shots whip sideways with motion blur, like a fast camera pan",
      duration: 0.35,
    },
    `
    .out { animation: out var(--duration) cubic-bezier(0.7, 0, 0.84, 0) both; }
    .in { animation: in var(--duration) cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes out { to { transform: translateX(-100%); filter: blur(40px); } }
    @keyframes in { from { transform: translateX(100%); filter: blur(40px); } }
    `,
  ),
  file(
    "transition",
    "zoom-through",
    { name: "Zoom through", description: "Push into the old shot and land in the new one", duration: 0.45 },
    `
    .out { animation: out var(--duration) cubic-bezier(0.7, 0, 0.84, 0) both; }
    .in { animation: in var(--duration) cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes out { to { transform: scale(1.6); filter: blur(16px); opacity: 0; } }
    @keyframes in { from { transform: scale(0.7); filter: blur(16px); opacity: 0; } }
    `,
  ),
  file(
    "transition",
    "slide",
    { name: "Slide", description: "The new shot slides in and pushes the old one out", duration: 0.4 },
    `
    .out { animation: out var(--duration) cubic-bezier(0.65, 0, 0.35, 1) both; }
    .in { animation: in var(--duration) cubic-bezier(0.65, 0, 0.35, 1) both; }
    @keyframes out { to { transform: translateY(-100%); } }
    @keyframes in { from { transform: translateY(100%); } }
    `,
  ),
  file(
    "transition",
    "bounce-out",
    {
      name: "Bounce out",
      description: "The old shot shrinks with a bounce and drops away, revealing the new one",
      duration: 0.5,
    },
    `
    .out {
      border-radius: 4cqw;
      overflow: hidden;
      z-index: 2;
      animation: out var(--duration) cubic-bezier(0.5, -0.5, 0.7, 0.6) both;
    }
    @keyframes out {
      0% { transform: scale(1); border-radius: 0; }
      35% { transform: scale(0.82); }
      100% { transform: translateY(110%) scale(0.7) rotate(-6deg); }
    }
    .in { animation: in var(--duration) cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes in { from { transform: scale(1.12); filter: brightness(0.6); } }
    `,
  ),
  file(
    "transition",
    "flash-cut",
    { name: "Flash cut", description: "A hard cut hidden in a white flash", duration: 0.3 },
    `
    .out { animation: hide var(--duration) steps(1, end) both; }
    @keyframes hide { 0% { opacity: 1; } 50%, 100% { opacity: 0; } }
    .overlay {
      position: absolute;
      inset: 0;
      background: #fff;
      animation: flash var(--duration) ease-out both;
    }
    @keyframes flash { 0% { opacity: 0; } 45% { opacity: 0.95; } 100% { opacity: 0; } }
    `,
  ),
];

/** Fine grain, as a tiny SVG noise texture that shifts every frame (the first film grades; grain is now color.grain). */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E")`;

const grain = (opacity: number) => `
    .overlay {
      position: absolute;
      inset: -10%;
      background-image: ${GRAIN};
      opacity: ${opacity};
      mix-blend-mode: overlay;
      animation: grain 0.5s steps(6) infinite;
    }
    @keyframes grain {
      0% { transform: translate(0, 0); }
      20% { transform: translate(-3%, 2%); }
      40% { transform: translate(2%, -3%); }
      60% { transform: translate(-2%, -1%); }
      80% { transform: translate(3%, 3%); }
      100% { transform: translate(0, 0); }
    }`;

/**
 * The first built-in grades, as CSS filters. Kept so a project still holding one, unedited, gets its
 * replacement (starters.ts): hue-rotate and sepia only ever approximated these looks.
 */
const GRADES_V1: StyleFile[] = [
  file("grade", "none", { name: "None", description: "The footage as shot" }, ".picture { filter: none; }"),
  file(
    "grade",
    "clean",
    { name: "Clean", description: "A touch more contrast and colour; the safe default" },
    ".picture { filter: contrast(1.05) saturate(1.12); }",
  ),
  file(
    "grade",
    "warm",
    { name: "Warm", description: "Golden and friendly" },
    ".picture { filter: sepia(0.14) saturate(1.18) contrast(1.06) hue-rotate(-6deg); }",
  ),
  file(
    "grade",
    "teal-orange",
    { name: "Teal and orange", description: "The blockbuster look: warm skin, cool shadows" },
    ".picture { filter: contrast(1.1) saturate(1.15) hue-rotate(-10deg); }",
  ),
  file(
    "grade",
    "moody",
    { name: "Moody", description: "Darker and desaturated, for serious stories" },
    ".picture { filter: contrast(1.12) saturate(0.82) brightness(0.94); }",
  ),
  file(
    "grade",
    "punchy",
    { name: "Punchy", description: "Bold contrast and colour" },
    ".picture { filter: contrast(1.14) saturate(1.32); }",
  ),
  file(
    "grade",
    "mono",
    { name: "Black and white", description: "Black and white throughout" },
    ".picture { filter: grayscale(1) contrast(1.12); }",
  ),
  file(
    "grade",
    "film",
    { name: "Film", description: "Soft contrast, lifted blacks and fine grain, like 35mm" },
    `
    .picture { filter: contrast(0.94) saturate(0.92) sepia(0.08) brightness(1.03); }
    ${grain(0.35)}
    `,
  ),
  file(
    "grade",
    "kodak-warm",
    { name: "Kodak warm", description: "Warm, rich film stock with gentle grain" },
    `
    .picture { filter: sepia(0.22) saturate(1.25) contrast(1.06) hue-rotate(-8deg) brightness(1.02); }
    ${grain(0.25)}
    `,
  ),
  file(
    "grade",
    "bleach",
    { name: "Bleach bypass", description: "Silvery, low saturation, hard contrast" },
    ".picture { filter: saturate(0.45) contrast(1.35) brightness(0.98); }",
  ),
];

/** A grade file that is all colour: the header carries it (GradeColor in grading.ts), CSS is optional. */
function gradeFile(
  id: string,
  meta: { name: string; description: string },
  color: GradeColor,
  css = "",
): StyleFile {
  // Readable when opened: one key per line, each list of numbers on one line.
  const json = JSON.stringify({ ...meta, color }, null, 2).replace(
    /\[\s+([^[\]{}]*?)\s+\]/g,
    (_, inner: string) => `[${inner.replace(/\s+/g, " ")}]`,
  );
  const body = css.trim().replace(/^ {4}/gm, "");
  return { id, css: `/* grade ${json} */\n${body ? `${body}\n` : ""}` };
}

/** A soft S: a little more contrast in the middle, the ends left alone. */
const S_CURVE: [number, number][] = [
  [0.25, 0.22],
  [0.75, 0.79],
];

const GRADES: StyleFile[] = [
  file("grade", "none", { name: "None", description: "The footage as shot" }, ".picture { filter: none; }"),
  gradeFile(
    "clean",
    { name: "Clean", description: "A touch more contrast and colour; the safe default" },
    { contrast: 1.05, saturation: 1.12 },
  ),
  gradeFile(
    "warm",
    { name: "Warm", description: "Golden and friendly: warmer light, creamy shadows" },
    { warmth: 0.3, lift: [0.015, 0.008, -0.005], gain: [1.03, 1.01, 0.97], contrast: 1.04, saturation: 1.12 },
  ),
  gradeFile(
    "teal-orange",
    {
      name: "Teal and orange",
      description: "The blockbuster look: teal shadows, warm orange highlights and skin",
    },
    { lift: [-0.02, 0.012, 0.04], gain: [1.06, 1, 0.92], contrast: 1.08, saturation: 1.12 },
  ),
  gradeFile(
    "moody",
    { name: "Moody", description: "Darker and desaturated, cool in the shadows, for serious stories" },
    { lift: [-0.01, 0, 0.012], gamma: 0.9, gain: 0.97, contrast: 1.1, saturation: 0.8 },
  ),
  gradeFile(
    "punchy",
    { name: "Punchy", description: "Bold contrast and colour" },
    { contrast: 1.1, saturation: 1.3, curves: { all: S_CURVE } },
  ),
  gradeFile(
    "mono",
    { name: "Black and white", description: "Black and white throughout, with a little snap" },
    { saturation: 0, contrast: 1.08, curves: { all: S_CURVE } },
  ),
  gradeFile(
    "film",
    {
      name: "Film",
      description: "Soft contrast, lifted blacks, rolled-off highlights and fine grain, like 35mm",
    },
    {
      warmth: 0.08,
      saturation: 0.9,
      curves: {
        all: [
          [0, 0.05],
          [0.25, 0.24],
          [0.75, 0.78],
          [1, 0.95],
        ],
      },
      grain: 0.35,
    },
  ),
  gradeFile(
    "kodak-warm",
    { name: "Kodak warm", description: "Warm, rich film stock with gentle grain" },
    {
      warmth: 0.22,
      lift: [0.02, 0.01, 0],
      gain: [1.04, 1, 0.95],
      saturation: 1.18,
      curves: {
        all: [
          [0, 0.03],
          [0.25, 0.23],
          [0.75, 0.79],
          [1, 0.97],
        ],
      },
      grain: 0.25,
    },
  ),
  gradeFile(
    "bleach",
    { name: "Bleach bypass", description: "Silvery, low saturation, hard contrast" },
    {
      saturation: 0.45,
      contrast: 1.25,
      curves: {
        all: [
          [0.2, 0.16],
          [0.8, 0.86],
        ],
      },
    },
  ),
];

// Effects that style the person and what's behind them apart (.subject, .background): placing one cuts
// the person out of the shots it covers.
EFFECTS.push(
  file(
    "effect",
    "color-pop",
    {
      name: "Colour pop",
      description: "The world drains to black and white while the person stays in full colour",
      duration: 2,
    },
    `
    .background {
      animation:
        in 0.25s cubic-bezier(0.65, 0, 0.35, 1) both,
        out 0.25s cubic-bezier(0.65, 0, 0.35, 1) calc(var(--duration) - 0.25s) forwards;
    }
    @keyframes in { from { filter: grayscale(0); } to { filter: grayscale(1) contrast(1.1) brightness(0.9); } }
    @keyframes out { from { filter: grayscale(1) contrast(1.1) brightness(0.9); } to { filter: grayscale(0); } }
    `,
  ),
  file(
    "effect",
    "spotlight",
    {
      name: "Spotlight",
      description: "Everything behind the person falls into shadow, so all eyes go to them",
      duration: 2,
    },
    `
    .background {
      animation:
        in 0.3s cubic-bezier(0.65, 0, 0.35, 1) both,
        out 0.3s cubic-bezier(0.65, 0, 0.35, 1) calc(var(--duration) - 0.3s) forwards;
    }
    @keyframes in { from { filter: none; } to { filter: brightness(0.32) saturate(0.7) blur(3px); } }
    @keyframes out { from { filter: brightness(0.32) saturate(0.7) blur(3px); } to { filter: none; } }
    `,
  ),
  file(
    "effect",
    "glow-pulse",
    {
      name: "Glow pulse",
      description: "A glow of the accent blooms around the person and fades, on a big word or a beat",
      duration: 0.8,
    },
    `
    .subject { animation: glow var(--duration) cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes glow {
      0% { filter: drop-shadow(0 0 0 transparent); }
      25% { filter: drop-shadow(0 0 22px var(--accent)) drop-shadow(0 0 60px var(--accent)); }
      100% { filter: drop-shadow(0 0 0 transparent); }
    }
    `,
  ),
  file(
    "effect",
    "sticker",
    {
      name: "Sticker",
      description: "A thick white outline snaps around the person with a little bounce, like a sticker",
      duration: 1.5,
    },
    `
    .subject {
      transform-origin: 50% 60%;
      animation:
        on 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both,
        off 0.2s ease-in calc(var(--duration) - 0.2s) forwards;
    }
    @keyframes on {
      from { transform: scale(1); filter: none; }
      to {
        transform: scale(1.03);
        filter: drop-shadow(7px 0 0 #fff) drop-shadow(-7px 0 0 #fff) drop-shadow(0 7px 0 #fff)
          drop-shadow(0 -7px 0 #fff) drop-shadow(0 18px 24px rgba(0, 0, 0, 0.45));
      }
    }
    @keyframes off {
      from {
        transform: scale(1.03);
        filter: drop-shadow(7px 0 0 #fff) drop-shadow(-7px 0 0 #fff) drop-shadow(0 7px 0 #fff)
          drop-shadow(0 -7px 0 #fff) drop-shadow(0 18px 24px rgba(0, 0, 0, 0.45));
      }
      to { transform: scale(1); filter: none; }
    }
    `,
  ),
  file(
    "effect",
    "pop-out",
    {
      name: "Pop out",
      description: "The person lifts toward the camera while the world behind darkens and softens",
      duration: 1.5,
    },
    `
    .subject {
      transform-origin: 50% 70%;
      animation:
        lift 0.4s cubic-bezier(0.16, 1, 0.3, 1) both,
        drop 0.3s cubic-bezier(0.65, 0, 0.35, 1) calc(var(--duration) - 0.3s) forwards;
    }
    @keyframes lift {
      from { transform: scale(1); filter: none; }
      to { transform: scale(1.1); filter: drop-shadow(0 26px 40px rgba(0, 0, 0, 0.6)); }
    }
    @keyframes drop {
      from { transform: scale(1.1); filter: drop-shadow(0 26px 40px rgba(0, 0, 0, 0.6)); }
      to { transform: scale(1); filter: none; }
    }
    .background {
      animation:
        dim 0.4s cubic-bezier(0.16, 1, 0.3, 1) both,
        undim 0.3s cubic-bezier(0.65, 0, 0.35, 1) calc(var(--duration) - 0.3s) forwards;
    }
    @keyframes dim { from { filter: none; } to { filter: brightness(0.55) blur(6px); } }
    @keyframes undim { from { filter: brightness(0.55) blur(6px); } to { filter: none; } }
    `,
  ),
);

const byId = (a: StyleFile, b: StyleFile) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const STARTER_EFFECTS: readonly StyleFile[] = EFFECTS.toSorted(byId);
export const STARTER_TRANSITIONS: readonly StyleFile[] = TRANSITIONS.toSorted(byId);
export const STARTER_GRADES: readonly StyleFile[] = GRADES.toSorted(byId);

/** Built-in grades an older version wrote, by id: a project's copy, unedited, is replaced by today's. */
export const REPLACED_GRADES: ReadonlyMap<string, string> = new Map(
  GRADES_V1.filter((g) => GRADES.find((n) => n.id === g.id)?.css !== g.css).map((g) => [g.id, g.css]),
);
