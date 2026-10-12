/**
 * Every video gets its own design. This compares a video's design (design.json) with the user's recent
 * videos' and says what it repeats: the same faces, an accent of nearly the same hue, the same motion
 * language, the same kinds of graphic. One shared trait is fine (a creator's handwriting); a design that
 * repeats most of another reads as the same edit again, which is what the user never wants.
 */
import type { Design } from "./schema.ts";

export interface PastDesign {
  /** The video it was for (its project's name). */
  readonly name: string;
  readonly design: Design;
}

/** How many shared traits make two designs too alike. */
export const TOO_ALIKE = 3;

/** What a viewer sees first: the same display face with nearly the same accent reads as the same look. */
const FIRST_SEEN = ["the display face", "an accent of nearly the same hue"];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

/** Hue in degrees, and whether the colour has enough saturation for its hue to read. */
function hue(hex: string): { h: number; vivid: boolean } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, vivid: d > 0.2 };
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** The share of the smaller set that's in the other. */
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}

/**
 * What `design` shares with `other`, in words. Under a brand kit (`brand`) the faces and the accent are
 * the brand's, the same in every video by design: only the motion and the graphics are compared.
 */
export function sharedTraits(design: Design, other: Design, brand = false): string[] {
  const out: string[] = [];
  if (!brand && same(design.display, other.display)) out.push(`the display face (${design.display})`);
  if (!brand && same(design.text, other.text) && !same(design.display, other.display))
    out.push(`the text face (${design.text})`);
  const [a, b] = [design.palette[0], other.palette[0]];
  if (a && b && !brand) {
    const [ha, hb] = [hue(a), hue(b)];
    const apart = Math.min(Math.abs(ha.h - hb.h), 360 - Math.abs(ha.h - hb.h));
    if (ha.vivid && hb.vivid && apart < 25) out.push(`an accent of nearly the same hue (${a} and ${b})`);
  }
  if (overlap(words(design.motion), words(other.motion)) >= 0.5) out.push("the motion language");
  const kinds = (d: Design) => new Set(d.graphics.map((g) => g.trim().toLowerCase()));
  if (overlap(kinds(design), kinds(other)) >= 0.6) out.push("most of the graphic kinds");
  return out;
}

/**
 * The recent videos this design is too alike, with what it repeats of each. Under a brand kit, the same
 * motion and the same graphic kinds again is too alike (its faces and accent are meant to repeat).
 */
export function designEchoes(
  design: Design,
  recent: readonly PastDesign[],
  brand = false,
): { name: string; traits: string[] }[] {
  const seen = (traits: readonly string[]) => FIRST_SEEN.every((f) => traits.some((t) => t.startsWith(f)));
  return recent
    .map((p) => ({ name: p.name, traits: sharedTraits(design, p.design, brand) }))
    .filter((e) => e.traits.length >= (brand ? 2 : TOO_ALIKE) || (!brand && seen(e.traits)));
}

/** The recent designs, one line each, for the agent to steer clear of before it decides this one. */
export function recentDesignsView(recent: readonly PastDesign[]): string {
  return recent
    .slice(0, 6)
    .map(
      (p) =>
        `- ${p.name}: ${p.design.display || "?"} / ${p.design.text || "?"}, accent ${p.design.palette[0] ?? "?"}; ${p.design.motion || "?"}; ${p.design.graphics.join(", ") || "?"}`,
    )
    .join("\n");
}
