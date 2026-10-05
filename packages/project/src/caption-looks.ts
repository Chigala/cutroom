/**
 * Caption looks: captions/looks/<id>.css. The engine decides what is on screen when (pages, timing,
 * placement around the face, hiding words a graphic already shows); a look decides how it looks. It is
 * plain CSS over these hooks, rendered in a shadow root:
 *
 *   .caption                     the block; data-preset="karaoke|pop|plain", data-place="usual|above|seam"
 *   .word                        each word, separated by real spaces; plus one of
 *   .word.said / .now / .next    already said / being said / still to come
 *   .word.hl                     emphasis (from the transcript's word edits)
 *
 * Variables: --size (px), --color, --accent, --font (only when the user picked a font, so write
 * var(--font, "Your Font")), --page-t (seconds since the page appeared), --words; and on each word --i
 * and --word-t (seconds since that word started, negative before it).
 *
 * Motion is CSS animations, seeked to the video's clock: on .caption to --page-t, on a .word (or inside
 * one) to that word's --word-t. So `.word { animation: rise .25s both }` brings each word in as it's said.
 * Animate .word, not .now: class changes would restart an animation.
 *
 * Header, optional: / * look {"name": "...", "description": "...", "defaults": {"maxWords": 5}} * /
 * (without the spaces). Defaults are captionStyle values the look is designed for; whoever switches to
 * the look applies them.
 */

import { type CaptionLook, CaptionStyle } from "./schema.ts";

const look = (id: string, meta: object, css: string): CaptionLook => ({
  id,
  css: `/* look ${JSON.stringify(meta)} */\n${css.trim().replace(/^ {4}/gm, "")}\n`,
});

const STARTERS: CaptionLook[] = [
  look(
    "outline",
    {
      name: "Outline",
      description: "Bold white words with a black outline; the word being said lifts a little",
      defaults: { maxWords: 4, uppercase: false, size: 64 },
    },
    `
    .caption {
      font-family: var(--font, "IBM Plex Sans");
      font-size: var(--size);
      font-weight: 700;
      line-height: 1.15;
      color: var(--color);
      text-wrap: balance;
      /* An outline keeps every word readable over a white shirt or a bright wall. */
      -webkit-text-stroke: calc(var(--size) * 0.14) rgba(0, 0, 0, 0.85);
      paint-order: stroke fill;
      text-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    }
    .word { display: inline-block; margin: 0 0.04em; }
    .word.hl { color: var(--accent); }
    .caption[data-preset="karaoke"] .word.now { transform: translateY(-0.05em) scale(1.06); }
    .caption[data-preset="pop"] { animation: pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
    @keyframes pop { from { transform: scale(0.88); } }
    `,
  ),
  look(
    "silver",
    {
      name: "Silver",
      description: "Big sentence-case words in a silver gradient with a soft dark glow, no outline",
      defaults: { maxWords: 5, uppercase: false, size: 84, preset: "plain" },
    },
    `
    .caption {
      font-family: var(--font, "Inter Tight");
      font-size: var(--size);
      font-weight: 600;
      letter-spacing: -0.055em;
      line-height: 0.95;
      text-wrap: balance;
      /* The glow sits behind the gradient text: a soft dark halo, no hard outline. */
      filter: drop-shadow(0 0.04em 0.12em rgba(0, 0, 0, 0.45)) drop-shadow(0 0.1em 0.45em rgba(0, 0, 0, 0.4));
    }
    .word {
      display: inline-block;
      padding: 0 0.03em 0.1em;
      background: linear-gradient(180deg, #ffffff 0%, #f4f4f4 40%, #bdbdbd 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .word.hl { background-image: linear-gradient(180deg, #ffffff 0%, color-mix(in srgb, var(--accent) 70%, #fff) 100%); }
    `,
  ),
  look(
    "clean",
    {
      name: "Clean",
      description: "White words with a soft shadow that rise in as they're said",
      defaults: { maxWords: 4, uppercase: false, size: 70, preset: "plain" },
    },
    `
    .caption {
      font-family: var(--font, "Inter Tight");
      font-size: var(--size);
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.06;
      color: var(--color);
      text-wrap: balance;
      text-shadow: 0 0.03em 0.12em rgba(0, 0, 0, 0.5), 0 0 0.02em rgba(0, 0, 0, 0.4);
    }
    .word { display: inline-block; animation: rise 0.24s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .word.hl { color: var(--accent); }
    @keyframes rise { from { opacity: 0; transform: translateY(0.2em); } }
    `,
  ),
  look(
    "boxed",
    {
      name: "Boxed",
      description: "Heavy caps; the word being said sits in a rounded accent box",
      defaults: { maxWords: 3, uppercase: true, size: 72, preset: "plain" },
    },
    `
    .caption {
      font-family: var(--font, "Montserrat");
      font-size: var(--size);
      font-weight: 800;
      line-height: 1.22;
      color: var(--color);
      text-wrap: balance;
      -webkit-text-stroke: calc(var(--size) * 0.09) #000;
      paint-order: stroke fill;
    }
    .word {
      display: inline-block;
      /* The box needs room around the word; take it back from the gap so spacing stays even. */
      margin: 0 -0.12em;
      padding: 0.02em 0.14em 0.06em;
      border-radius: 0.22em;
      /* forwards, not both: words still to come stay full size, and pop when they're said. */
      animation: pop 0.2s cubic-bezier(0.2, 1.5, 0.4, 1) forwards;
    }
    .word.now { background: var(--accent); color: #111; -webkit-text-stroke: 0; }
    .word.hl:not(.now) { color: var(--accent); }
    @keyframes pop { from { transform: scale(0.82); } }
    `,
  ),
  look(
    "neon",
    {
      name: "Neon",
      description: "Glowing words that switch on as they're said",
      defaults: { maxWords: 4, uppercase: false, size: 70, preset: "plain" },
    },
    `
    .caption {
      font-family: var(--font, "Space Grotesk");
      font-size: var(--size);
      font-weight: 700;
      line-height: 1.08;
      color: #fff;
      text-wrap: balance;
      text-shadow:
        0 0 0.06em #fff,
        0 0 0.25em var(--accent),
        0 0 0.6em var(--accent),
        0 0 1.2em color-mix(in srgb, var(--accent) 60%, transparent);
    }
    .word { display: inline-block; animation: on 0.3s steps(6, end) both; }
    .word.hl { color: color-mix(in srgb, var(--accent) 35%, #fff); }
    @keyframes on {
      0% { opacity: 0; }
      30% { opacity: 1; }
      45% { opacity: 0.45; }
      60%, 100% { opacity: 1; }
    }
    `,
  ),
];

/** Sorted by id, like a folder listing. */
export const STARTER_CAPTION_LOOKS: readonly CaptionLook[] = STARTERS.toSorted((a, b) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
);

/** A readable problem with a look, or null. Looks are self-contained CSS: no imports, no remote files. */
export function validateCaptionLook(css: string): string | null {
  if (/@import\b/i.test(css)) return "looks can't @import: use a bundled font or one in the project's fonts/";
  if (/url\(\s*['"]?\s*(https?:|\/\/)/i.test(css)) return "looks can't load remote files";
  if (/<\/?style|<script/i.test(css)) return "a look is plain CSS, without <style> or <script> tags";
  if (!/\.caption\b|\.word\b/.test(css)) return "a look styles .caption and .word";
  return null;
}

/** The JSON header comment of a caption look: a CSS comment starting with `look {...}`. */
export function captionLookMeta(
  css: string,
): { name?: string; description?: string; defaults?: Record<string, unknown> } | null {
  const m = /\/\*\s*look\s+(\{[\s\S]*?\})\s*\*\//.exec(css);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as { name?: string; description?: string; defaults?: Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * The captionStyle values a look's header asks for: only the ones it names and that are valid (a
 * partial schema would fill in every other default too, overwriting the user's settings).
 */
export function lookDefaults(css: string): Record<string, unknown> {
  const asked = captionLookMeta(css)?.defaults ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asked)) {
    if (key === "look" || !(key in CaptionStyle.shape)) continue;
    const field = CaptionStyle.shape[key as keyof typeof CaptionStyle.shape];
    if (field.safeParse(value).success) out[key] = value;
  }
  return out;
}
