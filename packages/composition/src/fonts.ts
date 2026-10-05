/**
 * Fonts, registered on the document so captions and graphics (and their shadow roots) can use them by
 * family name: the bundled ones (BUNDLED_FONTS in @vedit/project) and the project's own, from fonts/.
 * While rendering, a frame waits until they've loaded, so no frame is ever drawn in a fallback font.
 */

import { BUNDLED_FONTS, FONTS_DIR, type FontFile, fontFile } from "@vedit/project";
import { createContext, useLayoutEffect } from "react";
import { continueRender, delayRender, getRemotionEnvironment } from "remotion";

export interface FontSource {
  readonly family: string;
  readonly url: string;
  readonly weight: number;
  readonly style: "normal" | "italic";
}

/** Every font a project can use, with the URL it's served at. */
export function fontSources(mediaBase: string, projectFonts: readonly FontFile[]): FontSource[] {
  return [
    ...BUNDLED_FONTS.flatMap((f) =>
      f.weights.map((weight) => ({
        family: f.family,
        url: `${mediaBase}runtime/fonts/${fontFile(f, weight)}`,
        weight,
        style: "normal" as const,
      })),
    ),
    ...projectFontSources(mediaBase, projectFonts),
  ];
}

/** The project's own fonts (fonts/), with the URL each is served at. */
export function projectFontSources(mediaBase: string, fonts: readonly FontFile[]): FontSource[] {
  return fonts.map((f) => ({
    family: f.family,
    url: `${mediaBase}${FONTS_DIR}/${encodeURIComponent(f.file)}`,
    weight: f.weight,
    style: f.style,
  }));
}

const loaded = new Map<string, Promise<unknown>>();

function load(font: FontSource): Promise<unknown> {
  let done = loaded.get(font.url);
  if (!done) {
    const face = new FontFace(font.family, `url("${font.url}")`, {
      weight: String(font.weight),
      style: font.style,
    });
    document.fonts.add(face);
    // A font that won't load shouldn't hold the render forever; it falls back, and says so.
    done = face.load().catch((err: unknown) => {
      console.warn(`[font] couldn't load ${font.family} ${font.weight} from ${font.url}: ${String(err)}`);
      return null;
    });
    loaded.set(font.url, done);
  }
  return done;
}

export function useFonts(mediaBase: string, projectFonts: readonly FontFile[]): void {
  const key = JSON.stringify(projectFonts);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for projectFonts' contents.
  useLayoutEffect(() => {
    if (typeof FontFace === "undefined") return;
    const handle = getRemotionEnvironment().isRendering ? delayRender("loading fonts") : null;
    void Promise.all(fontSources(mediaBase, projectFonts).map(load)).finally(() => {
      if (handle !== null) continueRender(handle);
    });
  }, [mediaBase, key]);
}

/** The project's own fonts, for scripted graphics (whose page already knows the bundled ones). */
export const ProjectFontsContext = createContext<readonly FontSource[]>([]);
