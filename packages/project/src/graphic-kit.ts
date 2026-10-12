/// <reference lib="dom" />
// prepareKit runs in the page (the editor, export's browser, the scripted runtime), never in Node.
/**
 * The graphics kit: building blocks every graphic gets, plain or scripted, so a new design starts from
 * well-made parts instead of from scratch. It's not a template: nothing here decides what a graphic looks
 * like (that's the video's own design), only that what it's built from moves and sits right:
 *
 * - Motion tokens: --ease-out (entrances), --ease-in (exits), --ease-move (state to state), --ease-pop
 *   (a small deliberate overshoot); durations --in-sm, --in, --in-lg and --out; staggers --gap-letter,
 *   --gap-word, --gap-line. GSAP gets the same curves as "k-out", "k-in", "k-move" and "k-pop".
 * - Entrances: k-rise, k-blur, k-mask, k-scale, k-left, k-right, k-track, k-drop, k-pop. Each eases out,
 *   waits var(--delay) and staggers by var(--i) times var(--gap).
 * - Exits, on a wrapper: k-out (fade and drift down), k-out-up, k-out-fade, all starting at var(--exit).
 * - data-split="words" or "letters" with data-in="rise" (any entrance): wraps each word or letter in its own
 *   span with --i set, so a line staggers in without a script.
 * - data-fit: shrinks a line's type to fit its width (on one line; data-fit="words" fits the longest word
 *   for text that wraps). The size it aims for is --fit-max (12cqw by default), the width --fit-width.
 * - Layout: k-safe (the area clear of the platform's buttons and the captions), k-clear (the slot under the
 *   face, from --clear-y), k-center. Type: k-display, k-label, k-shadow, k-accent.
 *
 * KIT_CSS goes first in every graphic, so the graphic's own CSS always wins. prepareKit runs on the
 * graphic's root after it's mounted; it's self-contained (the scripted runtime embeds its source).
 */

export const KIT_CSS = `
:host, :root {
  --ease-out: cubic-bezier(.16, 1, .3, 1);
  --ease-in: cubic-bezier(.7, 0, .84, 0);
  --ease-move: cubic-bezier(.65, 0, .35, 1);
  --ease-pop: cubic-bezier(.34, 1.3, .64, 1);
  --in-sm: .32s; --in: .5s; --in-lg: .7s; --out: .3s;
  --gap-letter: 32ms; --gap-word: 70ms; --gap-line: 120ms;
  --margin: 7cqw;
}
.k-rise, .k-blur, .k-mask, .k-scale, .k-left, .k-right, .k-track, .k-drop, .k-pop {
  animation-duration: var(--in);
  animation-timing-function: var(--ease-out);
  animation-fill-mode: both;
  animation-delay: calc(var(--delay, 0s) + var(--i, 0) * var(--gap, var(--gap-word)));
}
.k-rise { animation-name: k-rise; }
@keyframes k-rise { from { opacity: 0; transform: translateY(.4em); filter: blur(5px); } }
.k-blur { animation-name: k-blur; }
@keyframes k-blur { from { opacity: 0; filter: blur(12px); transform: scale(1.04); } }
.k-mask { animation-name: k-mask; padding-bottom: .08em; }
@keyframes k-mask { from { clip-path: inset(0 0 100% 0); transform: translateY(.6em); } to { clip-path: inset(0 0 0 0); } }
.k-scale { animation-name: k-scale; }
@keyframes k-scale { from { opacity: 0; transform: scale(.94); } }
.k-left { animation-name: k-left; }
@keyframes k-left { from { opacity: 0; transform: translateX(-.6em); filter: blur(4px); } }
.k-right { animation-name: k-right; }
@keyframes k-right { from { opacity: 0; transform: translateX(.6em); filter: blur(4px); } }
.k-track { animation-name: k-track; }
@keyframes k-track { from { opacity: 0; letter-spacing: .35em; filter: blur(4px); } }
.k-drop { animation-name: k-drop; animation-timing-function: var(--ease-pop); }
@keyframes k-drop { from { opacity: 0; transform: translateY(-.5em) scale(1.06); } }
.k-pop { animation-name: k-pop; animation-duration: var(--in-sm); animation-timing-function: var(--ease-pop); }
@keyframes k-pop { from { opacity: 0; transform: scale(.6); } }
.k-out, .k-out-up, .k-out-fade {
  animation-duration: var(--out);
  animation-timing-function: var(--ease-in);
  animation-fill-mode: both;
  animation-delay: var(--exit, 9999s);
}
.k-out { animation-name: k-out; }
@keyframes k-out { to { opacity: 0; transform: translateY(.3em); filter: blur(4px); } }
.k-out-up { animation-name: k-out-up; }
@keyframes k-out-up { to { opacity: 0; transform: translateY(-.4em); } }
.k-out-fade { animation-name: k-out-fade; }
@keyframes k-out-fade { to { opacity: 0; } }
.k-part { display: inline-block; white-space: pre; }
[data-split="letters"] { --gap: var(--gap-letter); }
[data-split="words"] { --gap: var(--gap-word); }
[data-fit] {
  font-size: min(var(--fit-max, 12cqw), calc(var(--fit-width, 86cqw) / (var(--chars, 8) * var(--fit-em, .56))));
}
[data-fit=""], [data-fit="line"] { white-space: nowrap; }
.k-safe { position: absolute; left: var(--margin); right: max(var(--margin), 18cqw); top: 8cqh; bottom: 30cqh; }
.k-clear { position: absolute; left: var(--margin); right: max(var(--margin), 18cqw); top: calc(var(--clear-y, .54) * 100cqh); }
.k-center { display: grid; place-items: center; text-align: center; }
.k-display { font-family: var(--font); font-weight: 800; line-height: 1.02; letter-spacing: -.03em; text-wrap: balance; }
.k-label { font-family: var(--font); font-size: 3cqw; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; }
.k-shadow { text-shadow: 0 2px 16px rgba(0, 0, 0, .35); }
.k-accent { color: var(--accent); }
`;

/** The curves GSAP gets as named eases, when CustomEase is loaded. */
export const KIT_EASES: Readonly<Record<string, string>> = {
  "k-out": ".16,1,.3,1",
  "k-in": ".7,0,.84,0",
  "k-move": ".65,0,.35,1",
  "k-pop": ".34,1.3,.64,1",
};

/**
 * Splits [data-split] text into staggered parts and measures [data-fit] lines. Runs once per mount; the
 * result depends only on the markup, so preview and export always agree.
 */
export function prepareKit(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-split]"))) {
    const letters = el.dataset.split === "letters";
    const cls = el.dataset.in ? `k-part k-${el.dataset.in}` : "k-part";
    let i = 0;
    const walk = (node: Node): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== 3) {
          walk(child);
          continue;
        }
        const text = child.textContent ?? "";
        const parts = letters ? Array.from(text) : text.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.append(document.createTextNode(part));
            continue;
          }
          const span = document.createElement("span");
          span.className = cls;
          span.style.setProperty("--i", String(i++));
          span.textContent = part;
          frag.append(span);
        }
        child.replaceWith(frag);
      }
    };
    walk(el);
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-fit]"))) {
    const text = (el.textContent ?? "").trim();
    const longest =
      el.dataset.fit === "words" ? Math.max(1, ...text.split(/\s+/).map((w) => w.length)) : text.length;
    el.style.setProperty("--chars", String(Math.max(1, longest)));
  }
}
