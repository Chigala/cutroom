/**
 * The cover (cover.json): the thumbnail people decide on. One frame of the video, the person cut out of
 * it and pushed in on, a big headline behind them (or over everything), the background kept, blurred,
 * dimmed or replaced. Rendered like the video (one frame, the same fonts and grade), so the preview,
 * the agent's look and the exported image are the same picture.
 */
import {
  type Cover,
  coverKey,
  gradeColorOf,
  type ProjectDoc,
  STARTER_GRADES,
  shotFace,
  sourceTime,
  timelineOf,
} from "@vedit/project";
import { type ComponentProps, type CSSProperties, useMemo, useRef, useState } from "react";
import { AbsoluteFill, Img, Sequence, useVideoConfig } from "remotion";
import { coverBox, FONT_STACK, SubjectLook } from "./Composition.tsx";
import { GradeProvider, useColorEffects } from "./color.tsx";
import { ProjectFontsContext, projectFontSources, useFonts } from "./fonts.ts";
import { GraphicView } from "./GraphicView.tsx";
import { StyleLayer } from "./StyleLayer.tsx";

export interface CoverProps extends Record<string, unknown> {
  readonly doc: ProjectDoc;
  readonly mediaBase: string;
}

/** The moment a cover is made from: its clip and the time in it, and the shot (for its framing). */
export function coverMoment(doc: ProjectDoc): { source: string; t: number; sceneId: string } | null {
  const tl = timelineOf(doc);
  const at = doc.cover.at;
  const placed = at ? tl.byId.get(at.scene) : tl.scenes[0];
  if (!placed) return null;
  const local = at ? Math.min(at.at, placed.duration - 0.05) : placed.duration * 0.4;
  return {
    source: placed.scene.source,
    t: Math.max(0, Math.round(sourceTime(placed, placed.start + local) * 100) / 100),
    sceneId: placed.scene.id,
  };
}

const WAIT = { delayRenderTimeoutInMilliseconds: 120_000 } as const;

export function CoverComposition({ doc, mediaBase }: CoverProps) {
  const { width, height, fps } = useVideoConfig();
  useFonts(mediaBase, doc.fonts);
  const projectFonts = useMemo(() => projectFontSources(mediaBase, doc.fonts), [mediaBase, doc.fonts]);
  const cover = doc.cover;
  const moment = coverMoment(doc);
  const scene = moment ? doc.scenes.find((s) => s.id === moment.sceneId) : undefined;
  const source = moment ? doc.sources.find((s) => s.id === moment.source) : undefined;
  const accent = cover.accent ?? doc.look.accent ?? doc.captionStyle.accent;
  const family = cover.font ?? doc.look.font;
  const font = family ? `'${family.replace(/'/g, "")}', ${FONT_STACK}` : FONT_STACK;
  const grade = (
    doc.grades.find((g) => g.id === doc.look.grade) ?? STARTER_GRADES.find((g) => g.id === "clean")
  )?.css;
  const gradeColor = useMemo(() => {
    try {
      return grade ? gradeColorOf(grade) : null;
    } catch {
      return null;
    }
  }, [grade]);
  const picture = useRef<HTMLDivElement>(null);
  const person = useRef<HTMLDivElement>(null);
  // Without a cutout (not on this machine, or none found) the headline comes forward, so it still reads.
  const [cutFailed, setCutFailed] = useState(false);
  const usable = source && (source.kind === "video" || source.kind === "image") && moment;
  const needsCut = cover.place === "behind" || !!cover.subject || cover.background.kind !== "frame";
  const behind = cover.place === "behind" && !cutFailed;

  // The frame, filling the cover and pushed in on the person.
  const face = moment
    ? shotFace(
        doc.analyses.find((a) => a.id === moment.source),
        moment.t - 1,
        moment.t + 1,
      )
    : undefined;
  const box = usable ? coverBox(width, height, source, scene?.framing, face) : null;
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  const fx = box && face ? num(box.left, 0) + face.x * num(box.width, width) : width / 2;
  const fy = box && face ? num(box.top, 0) + face.y * num(box.height, height) : height * 0.4;
  const push: CSSProperties = { transform: `scale(${cover.zoom})`, transformOrigin: `${fx}px ${fy}px` };
  const url = (part: Parameters<typeof coverKey>[2]) =>
    moment ? `${mediaBase}${encodeURIComponent(coverKey(moment.source, moment.t, part))}` : "";
  const bg = cover.background;
  const fill: CSSProperties = { ...box, objectFit: "fill" };

  // Unset y: behind, the headline's last line sits across the top of the head (the head overlaps it);
  // when the head is too near the top for that, or in front, it goes in the lower third.
  const k = Math.min(width, height) / 1080;
  const faceH = face && box ? face.size * num(box.width, width) * cover.zoom * 1.35 : 0;
  const headTop = fy - faceH * 0.78;
  // Lines the headline takes at a size (caps run about 0.62 of the size per character).
  const lines = (size: number) => {
    const perLine = Math.max(1, Math.floor((width * 0.9) / (size * k * 0.62)));
    const words = cover.text.replace(/\*/g, "").split(/\s+/).filter(Boolean);
    let n = 1;
    let used = 0;
    for (const w of words) {
      if (used && used + 1 + w.length > perLine) {
        n++;
        used = w.length;
      } else used += (used ? 1 : 0) + w.length;
    }
    return n;
  };
  // Behind: as big as fits above the head (down to cover.shrink of the size). Over a background
  // without the person in it (a colour, a gradient, the clean blur), the person can move down to make
  // the room (up to cover.drop of the frame). Else the lower third.
  const movable = bg.kind === "color" || bg.kind === "gradient" || bg.kind === "blur";
  const above = (() => {
    if (cover.y !== undefined || !behind || !face) return null;
    const steps = [1, (1 + cover.shrink) / 2, cover.shrink];
    for (const f of steps) {
      const size = cover.size * f;
      const line = size * k * cover.lineHeight;
      const bottom = headTop + line * cover.overlap;
      const short = height * 0.035 - (bottom - lines(size) * line);
      if (short <= 0) return { y: bottom, size, drop: 0 };
      if (movable && short <= height * cover.drop) return { y: bottom + short, size, drop: short };
    }
    return null;
  })();
  const place: { y: number; anchor: "center" | "bottom"; size: number } =
    cover.y !== undefined
      ? { y: cover.y * height, anchor: "center", size: cover.size }
      : above
        ? { y: above.y, anchor: "bottom", size: above.size }
        : { y: height * 0.8, anchor: "center", size: cover.size };
  // Behind the person only where they overlap it; a headline moved to the lower third comes forward.
  const textBehind = behind && (cover.y !== undefined || !!above);
  const headline = cover.text.trim() ? (
    <Headline
      cover={cover}
      accent={accent}
      font={font}
      width={width}
      height={height}
      place={place}
      front={!textBehind}
    />
  ) : null;
  const graphic = cover.graphic
    ? (() => {
        const g = cover.graphic;
        return (
          <Sequence from={-Math.round(g.at * fps)} durationInFrames={Math.round((g.at + 10) * fps)}>
            <GraphicView
              graphic={doc.graphics.find((x) => x.id === g.id)}
              params={g.params}
              duration={Math.max(3, g.at + 1)}
              accent={accent}
              font={font}
              mediaBase={mediaBase}
              visual="cover"
            />
          </Sequence>
        );
      })()
    : null;

  return (
    <ProjectFontsContext.Provider value={projectFonts}>
      <GradeProvider grade={gradeColor} doc={doc} mediaBase={mediaBase}>
        <AbsoluteFill style={{ backgroundColor: bg.color, fontFamily: font }}>
          <AbsoluteFill ref={picture}>
            {bg.kind === "gradient" ? (
              <AbsoluteFill
                style={{ background: `linear-gradient(180deg, ${bg.color} 0%, ${bg.color2 ?? accent} 100%)` }}
              />
            ) : bg.kind === "color" || !usable ? null : (
              <AbsoluteFill style={push}>
                {bg.kind === "blur" && !cutFailed ? (
                  <GradedImg src={url(`blur${Math.round(bg.amount ?? 24)}`)} style={fill} {...WAIT} />
                ) : (
                  <GradedImg
                    src={url("frame")}
                    style={{
                      ...fill,
                      ...(bg.kind === "dim" && {
                        filter: `brightness(${(1 - Math.min(1, bg.amount ?? 0.55)).toFixed(3)})`,
                      }),
                      ...(bg.kind === "blur" && { filter: `blur(${bg.amount ?? 24}px)` }),
                    }}
                    {...WAIT}
                  />
                )}
              </AbsoluteFill>
            )}
          </AbsoluteFill>
          {textBehind && headline}
          {cover.graphic?.place === "behind" && graphic}
          {usable && needsCut && !cutFailed ? (
            <AbsoluteFill
              ref={person}
              style={above?.drop ? { ...push, translate: `0 ${above.drop.toFixed(1)}px` } : push}
            >
              <SubjectLook look={cover.subject} id="cover" accent={accent} length={1}>
                <GradedImg
                  src={url("cut")}
                  style={fill}
                  {...WAIT}
                  // onImageError, not onError: in a graded video the picture is a canvas, which takes only this.
                  onImageError={() => setCutFailed(true)}
                />
              </SubjectLook>
            </AbsoluteFill>
          ) : null}
          {grade ? (
            <StyleLayer
              css={grade}
              t={0}
              duration={1}
              accent={accent}
              targets={{ picture: [picture, person] }}
            />
          ) : null}
          {!textBehind && headline}
          {cover.graphic?.place !== "behind" && graphic}
        </AbsoluteFill>
      </GradeProvider>
    </ProjectFontsContext.Provider>
  );
}

/** The frame, in the video's grade (the GPU's colour; the grade file's CSS goes on through StyleLayer). */
function GradedImg(props: ComponentProps<typeof Img>) {
  const effects = useColorEffects();
  return <Img {...props} {...(effects && { effects })} />;
}

/** The headline: huge, tight, balanced over its lines, with *starred* words in the accent. */
function Headline({
  cover,
  accent,
  font,
  width,
  height,
  place,
  front,
}: {
  cover: Cover;
  accent: string;
  font: string;
  width: number;
  height: number;
  /** Where the headline goes (its centre, or its bottom, at y pixels) and how big. */
  place: { y: number; anchor: "center" | "bottom"; size: number };
  front: boolean;
}) {
  // Sizes are for a frame 1080 on its short side.
  const k = Math.min(width, height) / 1080;
  const parts = cover.text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: width * 0.05,
          right: width * 0.05,
          top: Math.max(height * 0.03, place.y),
          transform: place.anchor === "bottom" ? "translateY(-100%)" : "translateY(-50%)",
          textAlign: "center",
          fontFamily: font,
          fontWeight: cover.weight,
          fontSize: place.size * k,
          lineHeight: cover.lineHeight,
          letterSpacing: `${cover.tracking}em`,
          textTransform: cover.uppercase ? "uppercase" : "none",
          color: cover.color,
          textWrap: "balance",
          ...(cover.stroke > 0 && {
            WebkitTextStroke: `${cover.stroke * k * 2}px #000`,
            paintOrder: "stroke fill",
          }),
          ...(front &&
            !cover.box &&
            cover.shadow > 0 && { textShadow: `0 ${6 * k}px ${36 * k}px rgba(0,0,0,${cover.shadow})` }),
        }}
      >
        <span
          style={
            cover.box
              ? {
                  backgroundColor: cover.box,
                  padding: `${0.06 * cover.size * k}px ${0.18 * cover.size * k}px`,
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                }
              : undefined
          }
        >
          {parts.map((p, i) =>
            p.startsWith("*") && p.endsWith("*") ? (
              <span key={i} style={{ color: accent }}>
                {p.slice(1, -1)}
              </span>
            ) : (
              <span key={i}>{p}</span>
            ),
          )}
        </span>
      </div>
    </AbsoluteFill>
  );
}
