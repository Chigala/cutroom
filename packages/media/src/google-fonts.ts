/**
 * Google Fonts: the open families (about 1,900), found by name, kind and weight, and fetched into a
 * project's fonts/ folder, where the store picks them up by file name like any font dropped in. Each
 * weight comes as one whole TrueType file (asked for without a browser's user agent, Google sends that
 * rather than a dozen woff2 subsets), so the project works offline from then on. All are open licences
 * (OFL, Apache, UFL): keeping a copy in the project is allowed.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const LIST = "https://fonts.google.com/metadata/fonts";
const CSS = "https://fonts.googleapis.com/css2";

export interface GoogleFamily {
  readonly family: string;
  /** "Sans Serif", "Serif", "Display", "Handwriting" or "Monospace". */
  readonly category: string;
  /** The weights it comes in. */
  readonly weights: readonly number[];
  /** Weights it has italics for. */
  readonly italics: readonly number[];
  /** Rank by use across the web: 1 is the most used. */
  readonly popularity: number;
}

interface Listed {
  family: string;
  category: string;
  fonts: Record<string, unknown> | string[];
  popularity?: number;
  isOpenSource?: boolean;
  isBrandFont?: boolean;
}

/** Google's list (fonts.google.com/metadata/fonts) as families: the open ones only. */
export function parseGoogleFamilies(text: string): GoogleFamily[] {
  // The list sometimes starts with a guard line against being run as a script.
  const list = (JSON.parse(text.replace(/^\)\]\}'\s*/, "")) as { familyMetadataList: Listed[] })
    .familyMetadataList;
  const weight = (s: string) => Number.parseInt(s, 10);
  return list
    .filter((f) => f.isOpenSource !== false && !f.isBrandFont)
    .map((f) => {
      const styles = Array.isArray(f.fonts) ? f.fonts : Object.keys(f.fonts);
      return {
        family: f.family,
        category: f.category,
        weights: styles
          .filter((s) => !s.endsWith("i"))
          .map(weight)
          .sort((a, b) => a - b),
        italics: styles
          .filter((s) => s.endsWith("i"))
          .map(weight)
          .sort((a, b) => a - b),
        popularity: f.popularity ?? 9999,
      };
    });
}

let listing: Promise<GoogleFamily[]> | null = null;

/** Every open family, fetched once a session. */
export function googleFamilies(): Promise<GoogleFamily[]> {
  listing ??= (async () => {
    const res = await fetch(LIST, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Google Fonts didn't answer (${res.status}).`);
    return parseGoogleFamilies(await res.text());
  })().catch((err: unknown) => {
    listing = null;
    throw err;
  });
  return listing;
}

export interface FontQuery {
  /** Words of the name ("bebas", "barlow condensed"). */
  readonly name?: string;
  readonly category?: string;
  /** It must come in these weights (100 thin to 900 black). */
  readonly weights?: readonly number[];
  readonly italic?: boolean;
}

/** Families matching a query, the most used first. */
export function findFonts(families: readonly GoogleFamily[], q: FontQuery, limit = 15): GoogleFamily[] {
  const words = (q.name ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const kind = q.category?.toLowerCase().replace(/[-_]/g, " ");
  return families
    .filter((f) => {
      const name = f.family.toLowerCase();
      if (!words.every((w) => name.includes(w))) return false;
      if (kind && f.category.toLowerCase() !== kind) return false;
      if (q.weights?.some((w) => !f.weights.includes(w))) return false;
      if (q.italic && !f.italics.length) return false;
      return true;
    })
    .sort((a, b) => {
      // An exact name first, then by use.
      const exact = (f: GoogleFamily) => (f.family.toLowerCase() === words.join(" ") ? 0 : 1);
      return exact(a) - exact(b) || a.popularity - b.popularity;
    })
    .slice(0, limit);
}

/** A family the way it's written in Google's list ("bebas neue" is "Bebas Neue"), if it's there. */
export const googleFamily = (families: readonly GoogleFamily[], name: string) =>
  families.find((f) => f.family.toLowerCase() === name.trim().toLowerCase());

/** The words type foundries name weights with, for the files' names (fonts.ts reads them back). */
const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** A weight's file name: "Barlow Condensed-Light.ttf", "Oswald-BoldItalic.ttf", "Inter-Italic.ttf". */
export function googleFontFile(family: string, weight: number, italic: boolean): string {
  const name = WEIGHT_NAMES[weight] ?? "Regular";
  const style = italic ? (weight === 400 ? "Italic" : `${name}Italic`) : name;
  return `${family}-${style}.ttf`;
}

/**
 * Fetches `weights` of a family (and their italics, when asked and it has them) into `dir`. Returns the
 * files written, by name. A weight it doesn't come in is an error naming the ones it does.
 */
export async function addGoogleFont(
  dir: string,
  family: GoogleFamily,
  weights: readonly number[],
  italic = false,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const missing = weights.filter((w) => !family.weights.includes(w));
  if (missing.length)
    throw new Error(
      `${family.family} doesn't come in ${missing.join(", ")}; it has ${family.weights.join(", ")}.`,
    );
  const styles = [
    ...weights.map((w) => [0, w] as const),
    ...(italic ? weights.filter((w) => family.italics.includes(w)).map((w) => [1, w] as const) : []),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const spec = styles.some(([i]) => i)
    ? `ital,wght@${styles.map(([i, w]) => `${i},${w}`).join(";")}`
    : `wght@${styles.map(([, w]) => w).join(";")}`;
  const url = `${CSS}?family=${encodeURIComponent(family.family).replace(/%20/g, "+")}:${spec}`;
  const res = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Google Fonts didn't have ${family.family} in those weights (${res.status}).`);
  const css = await res.text();
  const faces = [
    ...css.matchAll(
      /font-style:\s*(\w+);\s*font-weight:\s*(\d+);[^}]*?src:\s*url\(([^)]+)\)\s*format\(['"]truetype['"]\)/g,
    ),
  ].map((m) => ({ italic: m[1] === "italic", weight: Number(m[2]), url: m[3]! }));
  if (!faces.length) throw new Error(`Google Fonts sent no files for ${family.family}.`);
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const face of faces) {
    const file = googleFontFile(family.family, face.weight, face.italic);
    const font = await fetcher(face.url, { signal: AbortSignal.timeout(60_000) });
    if (!font.ok) throw new Error(`Couldn't download ${file} (${font.status}).`);
    const bytes = Buffer.from(await font.arrayBuffer());
    // Whole, or not there: the store picks up whatever appears in the folder.
    const part = path.join(dir, `.${file}.part`);
    await writeFile(part, bytes);
    await rename(part, path.join(dir, file));
    written.push(file);
  }
  return written;
}
