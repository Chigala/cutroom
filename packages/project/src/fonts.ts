/**
 * Fonts every project can use, bundled with the app (open licenses, via @fontsource) and served next to
 * the media at `${mediaBase}runtime/fonts/<file>`. Captions, graphics and scripted graphics all see them.
 */

import type { FontFile } from "./schema.ts";

export interface BundledFont {
  readonly family: string;
  /** The @fontsource package name. */
  readonly pkg: string;
  readonly weights: readonly number[];
  /** What it's good for, for pickers and the agent. */
  readonly note: string;
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { family: "IBM Plex Sans", pkg: "ibm-plex-sans", weights: [400, 500, 600, 700], note: "the house font" },
  {
    family: "Inter Tight",
    pkg: "inter-tight",
    weights: [400, 500, 600, 700, 800, 900],
    note: "a tight neo-grotesk, close to SF Pro Display",
  },
  {
    family: "Montserrat",
    pkg: "montserrat",
    weights: [500, 600, 700, 800, 900],
    note: "geometric, bold captions",
  },
  {
    family: "Poppins",
    pkg: "poppins",
    weights: [500, 600, 700, 800, 900],
    note: "round geometric, friendly",
  },
  { family: "Space Grotesk", pkg: "space-grotesk", weights: [500, 600, 700], note: "techy grotesk" },
  { family: "Bebas Neue", pkg: "bebas-neue", weights: [400], note: "tall condensed caps, headlines" },
  { family: "Anton", pkg: "anton", weights: [400], note: "heavy condensed, loud captions" },
  { family: "Archivo Black", pkg: "archivo-black", weights: [400], note: "heavy wide grotesk" },
  { family: "DM Serif Display", pkg: "dm-serif-display", weights: [400], note: "elegant display serif" },
];

/** The served file name of one weight: `runtime/fonts/<this>`. */
export const fontFile = (f: BundledFont, weight: number) => `${f.pkg}-${weight}.woff2`;

/** The folder for the project's own fonts: any .woff2/.woff/.ttf/.otf dropped in is usable by family name. */
export const FONTS_DIR = "fonts";

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  heavy: 800,
  black: 900,
};

/**
 * A font file's family, weight and style, read from its name the way type foundries name files:
 * "BrandSans-SemiBoldItalic.woff2" is family "BrandSans", weight 600, italic. A name without a weight
 * is the whole family at 400.
 */
export function fontFromFile(file: string): FontFile | null {
  const m = /^(.+)\.(woff2|woff|ttf|otf)$/i.exec(file);
  if (!m || file.includes("/") || file.startsWith(".")) return null;
  const stem = m[1]!;
  const parts = stem.split(/[-_ ]+/).filter(Boolean);
  let weight = 400;
  let style: "normal" | "italic" = "normal";
  let family = parts;
  const last = parts.at(-1)?.toLowerCase() ?? "";
  const italic = /italic$|oblique$/.test(last);
  const word = last.replace(/italic$|oblique$/, "");
  if (parts.length > 1 && (word in WEIGHTS || (italic && word === ""))) {
    weight = WEIGHTS[word] ?? 400;
    style = italic ? "italic" : "normal";
    family = parts.slice(0, -1);
  }
  const id = stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!id) return null;
  return { id, file, family: family.join(" "), weight, style };
}
