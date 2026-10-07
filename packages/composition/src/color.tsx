/**
 * Which colour each piece of footage gets: the video's grade (its grade file's color, and that file's
 * LUT) from the top, a shot's own correction from its shot. Footage reads both and grades itself on the
 * GPU (color-gl.ts).
 */
import { type GradeColor, LUTS_DIR, type Lut, type ProjectDoc, parseCube } from "@vedit/project";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import {
  continueRender,
  delayRender,
  type EffectsProp,
  getRemotionEnvironment,
  useCurrentFrame,
} from "remotion";
import { colorGrade, colorParams, moves } from "./color-gl.ts";

interface Colors {
  readonly grade: GradeColor | null;
  readonly lut: Lut | null;
  readonly shot: GradeColor | null;
}

const NONE: Colors = { grade: null, lut: null, shot: null };
const ColorContext = createContext<Colors>(NONE);

/** The video's grade, for everything inside. */
export function GradeProvider({
  grade,
  doc,
  mediaBase,
  children,
}: {
  grade: GradeColor | null;
  doc: ProjectDoc;
  mediaBase: string;
  children: ReactNode;
}) {
  const file = grade?.lut ? doc.luts.find((l) => l.file === grade.lut) : undefined;
  const lut = useLut(file ? `${mediaBase}${LUTS_DIR}/${encodeURIComponent(file.file)}` : null);
  const value = useMemo(() => ({ grade, lut, shot: null }), [grade, lut]);
  return <ColorContext.Provider value={value}>{children}</ColorContext.Provider>;
}

/** A shot's own correction, under the grade. */
export function ShotColor({ color, children }: { color: GradeColor | null; children: ReactNode }) {
  const outer = useContext(ColorContext);
  const value = useMemo(() => ({ ...outer, shot: color }), [outer, color]);
  return <ColorContext.Provider value={value}>{children}</ColorContext.Provider>;
}

/** Footage that keeps its own colours (a picture-in-picture box). */
export function Ungraded({ children }: { children: ReactNode }) {
  return <ColorContext.Provider value={NONE}>{children}</ColorContext.Provider>;
}

/** The effects a piece of footage here runs: its colour grade, or none when it would change nothing. */
export function useColorEffects(): EffectsProp | undefined {
  const c = useContext(ColorContext);
  // Grain moves every frame; without it, the effect stays the same from frame to frame.
  const frame = useCurrentFrame();
  const at = moves(c.grade) ? frame : 0;
  return useMemo(() => {
    const params = colorParams(c.shot, c.grade, c.lut, at);
    return params ? [colorGrade(params)] : undefined;
  }, [c, at]);
}

const luts = new Map<string, Promise<Lut | null>>();

function loadLut(url: string): Promise<Lut | null> {
  let p = luts.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      })
      .then(parseCube)
      .catch((err: Error) => {
        console.warn(`The grade's LUT ${url} can't be used: ${err.message}`);
        luts.delete(url);
        return null;
      });
    luts.set(url, p);
  }
  return p;
}

/** A LUT, loaded. A render waits for it; the preview shows the grade without it until it arrives. */
function useLut(url: string | null): Lut | null {
  const [lut, setLut] = useState<{ url: string; lut: Lut | null } | null>(null);
  const [wait] = useState(() => ({
    handle: url && getRemotionEnvironment().isRendering ? delayRender(`Loading the LUT ${url}`) : null,
  }));
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadLut(url).then((l) => {
      if (live) setLut({ url, lut: l });
    });
    return () => {
      live = false;
    };
  }, [url]);
  // A render goes on once the LUT is in the picture (or there is none to wait for).
  const ready = !url || lut?.url === url;
  useEffect(() => {
    if (!ready || wait.handle === null) return;
    continueRender(wait.handle);
    wait.handle = null;
  }, [ready, wait]);
  return lut && lut.url === url ? lut.lut : null;
}
