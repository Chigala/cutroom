/**
 * Turns an effect, transition or grade file into rules for the real footage wrappers: the layer classes
 * (.frame, .out, .in, .picture) become an attribute only that wrapper carries, keyframes get names of
 * their own, and everything else (the overlay, anything unscoped) is left out, so a file can never
 * style the rest of the page.
 */

/** Top-level blocks of a stylesheet: `prelude { body }`, braces balanced, comments dropped. */
export function cssBlocks(css: string): { prelude: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: { prelude: string; body: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
    }
    blocks.push({ prelude: text.slice(i, open).trim(), body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return blocks;
}

export const layerAttr = "data-vfx";

/** The CSS that styles the wrappers standing for `layers`, under the scope id `uid`. */
export function scopeCss(css: string, uid: string, layers: readonly string[]): string {
  const blocks = cssBlocks(css);
  const names = blocks
    .map((b) => /^@keyframes\s+([\w-]+)$/.exec(b.prelude)?.[1])
    .filter((n): n is string => Boolean(n));
  const rename = (value: string) =>
    names.reduce((v, n) => v.replace(new RegExp(`(^|[\\s,])${n}(?=$|[\\s,;])`, "g"), `$1${uid}-${n}`), value);
  const layer = new RegExp(`\\.(${layers.join("|")})(?![\\w-])`, "g");
  const out: string[] = [];
  for (const b of blocks) {
    if (b.prelude.startsWith("@keyframes")) {
      const name = b.prelude.slice("@keyframes".length).trim();
      out.push(`@keyframes ${uid}-${name} {${b.body}}`);
      continue;
    }
    if (b.prelude.startsWith("@")) continue;
    // Only selectors that name a layer; the rest belongs to the overlay.
    const selectors = b.prelude
      .split(",")
      .map((s) => s.trim())
      .filter((s) => new RegExp(layer.source).test(s))
      .map((s) => s.replace(layer, (_, l: string) => `[${layerAttr}~="${uid}-${l}"]`));
    if (!selectors.length) continue;
    const body = b.body.replace(
      /(animation(?:-name)?\s*:)([^;}]*)/g,
      (_, prop: string, value: string) => prop + rename(value),
    );
    out.push(`${selectors.join(", ")} {${body}}`);
  }
  return out.join("\n");
}
