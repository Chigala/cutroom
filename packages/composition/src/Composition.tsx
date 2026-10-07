/**
 * video = render(folder). This component is the whole renderer: it takes a ProjectDoc and draws one
 * frame. The editor's preview plays it through @remotion/player; export renders the same component in
 * headless Chrome, so what you see while editing is what you get.
 *
 * Layers, bottom to top:
 *   camera   the shots, with drift, jump-cut zoom, punch-ins, shake/whip/mono, sliding down for splits
 *   visuals  graphics (HTML files) and cutaways, as overlay / full / split
 *   titles, captions, flash
 *   sound    music (ducked under speech, faded at the ends), sound effects, visual entry sounds
 *
 * Everything derived is memoized on the doc's collections. Docs share structure across edits, so moving
 * a caption doesn't recompute scene layout and vice versa.
 */
import { Audio, Video } from "@remotion/media";
import {
  type Anchored,
  type AudioSpan,
  audioPlan,
  beatLength,
  blurPlateKey,
  type Caption,
  type CaptionPage,
  type CaptionStyle,
  cameraPathCovering,
  captionPages,
  clearRect,
  cutoutCovering,
  cutoutKey,
  cutoutRange,
  type Effect,
  fitsInside,
  flowHash,
  flowKey,
  flowRange,
  followPath,
  type GradeColor,
  type Graphic,
  gradeColorOf,
  type Keyframe,
  keepTag,
  type Look,
  lasting,
  type MotionTrack,
  type MusicClip,
  type MusicCue,
  musicBeats,
  needsFlow,
  type ProjectDoc,
  poseAt,
  poseTransform,
  type Rect,
  rampHash,
  rampKey,
  rampMap,
  type Scene,
  type Sfx,
  type SfxName,
  type Source,
  STARTER_CAPTION_LOOKS,
  STARTER_GRADES,
  type Steadied,
  sceneAt,
  sceneLength,
  scenesNeedingCutout,
  shotColor,
  shotFocus,
  sourceTime,
  spokenWords,
  steady,
  steadyAt,
  type Timeline,
  type Title,
  timelineOf,
  type Visual,
  type VisualContent,
  type Zoom,
} from "@vedit/project";

type Face = { readonly x: number; readonly y: number; readonly size: number };

import {
  type CSSProperties,
  createContext,
  createRef,
  memo,
  type ReactNode,
  type RefObject,
  useContext,
  useMemo,
  useRef,
} from "react";
import {
  AbsoluteFill,
  Easing,
  getRemotionEnvironment,
  Html5Audio,
  Img,
  interpolate,
  Loop,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  type VolumeProp,
} from "remotion";
import { CaptionView } from "./CaptionView.tsx";
import { GradeProvider, ShotColor, Ungraded, useColorEffects } from "./color.tsx";
import { ProjectFontsContext, projectFontSources, useFonts } from "./fonts.ts";
import {
  type FrameSpan,
  frameSpan,
  isActive,
  lockToBeats,
  placeAll,
  type Timed,
  toFrame,
  trimFrom,
  trimTo,
} from "./frames.ts";
import { GraphicView } from "./GraphicView.tsx";
import { StyleLayer } from "./StyleLayer.tsx";

export interface CompositionProps extends Record<string, unknown> {
  readonly doc: ProjectDoc;
  /** Prefix that turns a media key ("<source id>", "sfx/<name>") into a URL. */
  readonly mediaBase: string;
  /** Preview plays lightweight proxies; export renders masters. */
  readonly quality?: "preview" | "export";
  /** Export mixes dialogue separately (see @vedit/media voice.ts), so the clips render silent. */
  readonly muteSources?: boolean;
  /** Stills have no sound: skip music and sound effects entirely (false). */
  readonly audio?: boolean;
  /**
   * What to draw, for measuring the picture (sense.ts in @vedit/render): everything; only the graphics
   * and titles drawn over the footage, on transparency; or only the footage (shots and cutaways, graded).
   */
  readonly layers?: "all" | "overlay" | "footage";
}

export const FONT_STACK = "'IBM Plex Sans', 'SF Pro Display', system-ui, sans-serif";

/** CSS twins of the grades: the same filter runs in the preview and in the export's headless Chrome. */
/** A grade id with no file falls back to the built-in clean grade. */
const FALLBACK_GRADE = STARTER_GRADES.find((g) => g.id === "clean");

/** House motion: arrive fast and settle long, leave quicker than you came. */
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (frame: number, from: number, frames: number, easing = EASE_OUT) =>
  interpolate(frame, [from, from + Math.max(1, frames)], [0, 1], { ...clamp, easing });

/** Drift: a slow push-in across each shot, so the frame is never locked off. */
const DRIFT = 0.035;

/** Default entry sound for a visual when it doesn't name one. */
const ENTRY_SFX = (v: Visual): SfxName | null =>
  v.sfx === null || v.sfx === "none"
    ? null
    : (v.sfx ?? (v.content.kind === "cutaway" ? "swipe" : v.layout === "overlay" ? "pop" : "whoosh"));

export const VideoComposition = ({
  doc,
  mediaBase,
  quality = "preview",
  muteSources = false,
  audio = true,
  layers = "all",
}: CompositionProps) => {
  const footage = layers !== "overlay";
  const overlays = layers !== "footage";
  const { fps, width, height } = useVideoConfig();
  useFonts(mediaBase, doc.fonts);
  const projectFonts = useMemo(() => projectFontSources(mediaBase, doc.fonts), [mediaBase, doc.fonts]);
  const tl = timelineOf(doc);
  const sources = useMemo(() => new Map(doc.sources.map((s) => [s.id, s])), [doc.sources]);
  const graphics = useMemo(() => new Map(doc.graphics.map((g) => [g.id, g])), [doc.graphics]);
  // The person cut out of shots that need it (a background change, or something drawn behind them),
  // once their cutout is made; and ramped shots' rendered footage.
  const cutouts = useMemo(() => {
    const starts = new Map(tl.scenes.map((p) => [p.scene.id, { start: p.start, end: p.start + p.duration }]));
    const out = new Map<string, { key: string; from: number; to: number; plate?: string }>();
    for (const s of scenesNeedingCutout(doc, starts)) {
      // What the cutout keeps with the person (the mic they hold...), part of which one it is.
      const keep = keepTag(s);
      const analysis = doc.analyses.find((a) => a.id === s.source);
      // One reaching into the transitions either side; until it's made, one over the shot itself.
      const wanted = cutoutRange(s, tl, sources.get(s.source)?.duration);
      const c =
        cutoutCovering(analysis, wanted.from, wanted.to, keep) ?? cutoutCovering(analysis, s.in, s.out, keep);
      if (!c) continue;
      // A blurred background made without the person (no halo), once it exists.
      const amount = s.background?.kind === "blur" ? (s.background.amount ?? 18) : null;
      const plate =
        amount !== null && c.blurs?.includes(amount)
          ? blurPlateKey(s.source, c.from, c.to, amount, keep)
          : undefined;
      out.set(s.id, {
        key: cutoutKey(s.source, c.from, c.to, keep),
        from: c.from,
        to: c.to,
        ...(plate && { plate }),
      });
    }
    return out;
  }, [doc, tl, sources]);
  // Each shot framed on its person (their tracked face over the shot), or following them as they move.
  const framed = useMemo(() => {
    const out = new Map<string, Framed>();
    for (const p of tl.scenes) {
      const a = doc.analyses.find((x) => x.id === p.scene.source);
      // On the person, else on where the eye goes (a shot with nobody in it).
      const face = shotFocus(a, p.scene.in, p.scene.out);
      const path =
        doc.look.reframe === "follow"
          ? followPath(a, p.scene, fps, Math.ceil(p.duration * fps) + 1, doc.look.follow)
          : null;
      out.set(p.scene.id, { ...(face && { face }), ...(path && { path }) });
    }
    return out;
  }, [tl, doc.analyses, doc.look.reframe, fps, doc.look.follow]);
  // Smooth versions of slowed shots (in-between frames), once made: a ramped shot's replaces its ramp;
  // a shot slowed by its speed shows over its footage (which stays, unseen, for its sound).
  const flows = useMemo(() => {
    const out = new Map<string, { key: string; from: number; to: number }>();
    for (const s of doc.scenes) {
      const src = sources.get(s.source);
      if (!needsFlow(s, src, fps)) continue;
      const range = flowRange(s, tl, src?.duration);
      const hash = flowHash(s, range, fps);
      if (doc.analyses.find((a) => a.id === s.source)?.flows?.includes(hash))
        out.set(s.id, { key: flowKey(s.source, hash), ...range });
    }
    return out;
  }, [doc.scenes, doc.analyses, sources, tl, fps]);
  const ramps = useMemo(
    () =>
      new Map(
        doc.scenes
          .filter((s) => s.ramp?.length)
          .map((s) => [s.id, flows.get(s.id)?.key ?? rampKey(s.source, rampHash(s, fps))]),
      ),
    [doc.scenes, fps, flows],
  );
  // Steadied shots: the moves that cancel their camera's shake, once its path is measured.
  const steadies = useMemo(() => {
    const out = new Map<string, Steadied>();
    for (const s of doc.scenes) {
      const src = sources.get(s.source);
      if (!s.stabilize || src?.kind !== "video" || !src.width || !src.height) continue;
      const a = doc.analyses.find((x) => x.id === s.source);
      const want = cutoutRange(s, tl, src.duration);
      const path = cameraPathCovering(a, want.from, want.to) ?? cameraPathCovering(a, s.in, s.out);
      if (!path) continue;
      const scale = Math.max(width / src.width, height / src.height) * (s.framing?.scale ?? 1);
      out.set(
        s.id,
        steady(
          path,
          { amount: s.stabilize.amount ?? 0.6, zoom: s.stabilize.zoom ?? 1.15 },
          { w: width, h: height },
          { w: src.width * scale, h: src.height * scale },
        ),
      );
    }
    return out;
  }, [doc.scenes, doc.analyses, sources, tl, width, height]);
  const subjectGradeRef = useRef<HTMLDivElement>(null);
  const subjectEffectRefs = useMemo(
    () => Array.from({ length: EFFECT_SLOTS }, () => createRef<HTMLDivElement>()),
    [],
  );
  // The music's beats, in frames, for the beat lock (music.lockToBeat): within about a tenth of a second
  // (and never more than a third of a beat), starts and ends land exactly on the beat.
  const beatSecs = beatLength(doc);
  const beatFrames = useMemo(
    () => (doc.music.lockToBeat ? musicBeats(doc, tl.duration).map((b) => Math.round(b * fps)) : []),
    [doc, tl.duration, fps],
  );
  const tolerance = beatSecs ? Math.floor(Math.min(0.12, beatSecs / 3) * fps) : 0;
  const onBeat = <T,>(items: Timed<T>[]) => lockToBeats(items, beatFrames, tolerance);
  // Overlays that last (a watermark, a chapter label) frame the video: their ends stay where they are.
  const momentsOnBeat = <T extends Pick<Anchored, "whole" | "until">>(items: Timed<T>[]) =>
    [...onBeat(items.filter((t) => !lasting(t.item))), ...items.filter((t) => lasting(t.item))].sort(
      (a, b) => a.from - b.from,
    );
  const tempoVars = useMemo((): Record<string, string> => {
    if (!beatSecs) return {};
    return { "--beat": `${beatSecs.toFixed(4)}s`, "--bar": `${(beatSecs * 4).toFixed(4)}s` };
  }, [beatSecs]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: onBeat derives from beatFrames and tolerance
  const zooms = useMemo(
    () => onBeat(placeAll(tl, doc.zooms, fps)),
    [tl, doc.zooms, fps, beatFrames, tolerance],
  );
  const captions = useMemo(() => placeAll(tl, doc.captions, fps), [tl, doc.captions, fps]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: onBeat derives from beatFrames and tolerance
  const titles = useMemo(
    () => momentsOnBeat(placeAll(tl, doc.titles, fps)),
    [tl, doc.titles, fps, beatFrames, tolerance],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: onBeat derives from beatFrames and tolerance
  const visuals = useMemo(
    () => momentsOnBeat(placeAll(tl, doc.visuals, fps)),
    [tl, doc.visuals, fps, beatFrames, tolerance],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: onBeat derives from beatFrames and tolerance
  const effects = useMemo(
    () => onBeat(placeAll(tl, doc.effects, fps)),
    [tl, doc.effects, fps, beatFrames, tolerance],
  );
  const tlFrames = Math.round(tl.duration * fps);
  const musicCues = useMemo(() => placeAll(tl, doc.musicCues, fps), [tl, doc.musicCues, fps]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: onBeat derives from beatFrames and tolerance
  const sfx = useMemo(
    () =>
      onBeat(
        placeAll(
          tl,
          // Built-ins play 2s; a clip's sound plays its stretch, or up to 10s of it.
          doc.sfx.map((s) => {
            const src = s.source ? sources.get(s.source) : undefined;
            const whole = src ? Math.max(0.05, Math.min(10, src.duration - (s.offset ?? 0))) : 2;
            return { ...s, duration: s.duration ?? whole };
          }),
          fps,
        ),
      ),
    [tl, doc.sfx, fps, sources, beatFrames, tolerance],
  );
  const musicClips = useMemo(() => placeAll(tl, doc.musicClips, fps), [tl, doc.musicClips, fps]);
  const spoken = spokenWords(doc);
  const pages = useMemo(() => captionPages(spoken, doc.captionStyle), [spoken, doc.captionStyle]);
  const speech = useMemo(() => speechSpans(pages, fps), [pages, fps]);
  const splits = useMemo(() => visuals.filter((v) => v.item.layout === "split"), [visuals]);
  const faces = useMemo<Faces>(
    () => new Map(doc.analyses.flatMap((a) => (a.face ? [[a.id, a.face] as const] : []))),
    [doc.analyses],
  );
  // What following a tracked face needs: the tracks, and the same layout the picture uses.
  const tracks = useMemo(
    () => new Map(doc.analyses.flatMap((a) => (a.tracks?.length ? [[a.id, a.tracks] as const] : []))),
    [doc.analyses],
  );
  const shotsJumped = useMemo(() => jumpedShots(tl), [tl]);
  const mapCtx = useMemo(
    () => ({
      tl,
      sources,
      faces,
      look: doc.look,
      jumped: shotsJumped,
      zooms,
      splits,
      visuals,
      fps,
      width,
      height,
    }),
    [tl, sources, faces, doc.look, shotsJumped, zooms, splits, visuals, fps, width, height],
  );
  // Times when something occupies the upper frame: captions then stay low rather than move above the face.
  const busy = useMemo(
    // Overlays that last (a corner logo) don't count: they'd move the captions in every shot.
    () =>
      [...titles, ...visuals.filter((v) => v.item.layout === "overlay")].filter(
        (x) => !lasting(x.item),
      ) as readonly FrameSpan[],
    [titles, visuals],
  );
  // On-screen text that may repeat what is being said: captions step aside for it.
  const echoes = useMemo<readonly Echo[]>(
    () => [
      ...titles.map((t) => ({ ...t, words: wordSet(t.item.text) })),
      ...visuals.flatMap((v) =>
        v.item.layout !== "split" && v.item.content.kind === "graphic"
          ? [{ ...v, words: wordSet(Object.values(v.item.content.params).flat().join(" ")) }]
          : [],
      ),
    ],
    [titles, visuals],
  );
  // Graphics, effects and transitions take the look's accent and font, falling back to the captions'.
  const theme = {
    accent: doc.look.accent ?? doc.captionStyle.accent,
    font: doc.look.font ? `'${doc.look.font.replace(/'/g, "")}', ${FONT_STACK}` : FONT_STACK,
  };
  // Effects, transitions and the grade are files (effects/, transitions/, grades/).
  const effectFiles = useMemo(() => new Map(doc.effectKinds.map((f) => [f.id, f.css])), [doc.effectKinds]);
  const transitionFiles = useMemo(
    () => new Map(doc.transitionKinds.map((f) => [f.id, f.css])),
    [doc.transitionKinds],
  );
  const gradeCss = (doc.grades.find((g) => g.id === doc.look.grade) ?? FALLBACK_GRADE)?.css ?? "";
  // The grade's colour (its header): run on the GPU, on every piece of footage (color.tsx).
  const gradeColor = useMemo(() => {
    try {
      return gradeColorOf(gradeCss);
    } catch {
      return null;
    }
  }, [gradeCss]);
  const gradeRef = useRef<HTMLDivElement>(null);
  const effectRefs = useMemo(
    () => Array.from({ length: EFFECT_SLOTS }, () => createRef<HTMLDivElement>()),
    [],
  );
  // The caption look's CSS; a missing look falls back to the built-in outline.
  const lookCss = (doc.captionLooks.find((l) => l.id === doc.captionStyle.look) ?? FALLBACK_LOOK)?.css ?? "";

  // Overlays marked clear lay out in the platform's clear area (portrait frames: off the app's buttons).
  const clearBox = useMemo(() => clearRect(doc.checkRules, width, height), [doc.checkRules, width, height]);
  // Drawn behind the subject only once the shot's cutout exists; until then, in front as usual.
  const behind = (item: { behindSubject?: boolean | undefined }) =>
    cutouts.size > 0 && item.behindSubject === true;
  const visualNode = (v: (typeof visuals)[number]) => (
    <Sequence
      key={v.item.id}
      from={v.from}
      durationInFrames={v.durationInFrames}
      premountFor={fps}
      name={v.item.id}
    >
      {/* A cutaway or a panel fills its place; an overlay pinned to a person follows them. */}
      <InArea rect={v.item.clear && v.item.layout === "overlay" && !v.item.follow ? clearBox : null}>
        <Keyframed keyframes={v.item.keyframes}>
          <VisualView
            visual={v.item}
            exitSeconds={exitOf(v, tl, fps)}
            graphic={v.item.content.kind === "graphic" ? graphics.get(v.item.content.graphic) : undefined}
            sources={sources}
            mediaBase={mediaBase}
            quality={quality}
            gradeCss={gradeCss}
            follow={
              v.item.follow
                ? (local: number) => followVars(v.item.follow!, tracks, mapCtx, v.from + local)
                : undefined
            }
            vars={{
              // The tempo, so a graphic's own animation can run on the beat (it starts on one).
              ...tempoVars,
              // Over the speaker, graphics get the face's place when they start, so they can keep off it.
              ...(v.item.layout === "overlay" && faces.size
                ? frameVars(faceBand(faceAt(tl, faces, v.from / fps), zooms, v.from, fps, width / height))
                : {}),
            }}
            {...theme}
          />
        </Keyframed>
      </InArea>
    </Sequence>
  );
  // Which visuals this render draws: cutaways and full or split visuals are the picture (footage),
  // overlays go over it (overlays).
  const inLayers = (v: (typeof visuals)[number]) =>
    v.item.content.kind === "cutaway" || v.item.layout !== "overlay" ? footage : overlays;
  const titleNode = (t: (typeof titles)[number]) => (
    <Sequence key={t.item.id} from={t.from} durationInFrames={t.durationInFrames} layout="none">
      <InArea rect={t.item.clear ? clearBox : null}>
        <Keyframed keyframes={t.item.keyframes}>
          <TitleView title={t.item} animate={t.from > 0} font={theme.font} />
        </Keyframed>
      </InArea>
    </Sequence>
  );

  return (
    <ProjectFontsContext.Provider value={projectFonts}>
      <GradeProvider grade={gradeColor} doc={doc} mediaBase={mediaBase}>
        <LivePreview.Provider value={quality === "preview" && !getRemotionEnvironment().isRendering}>
          <FitContext.Provider value={{ fit: doc.look.fit, backdrop: doc.look.fitBackdrop }}>
            <AbsoluteFill
              style={{
                backgroundColor: layers === "overlay" ? "transparent" : doc.look.background,
                fontFamily: theme.font,
              }}
            >
              {footage && (
                <Camera
                  zooms={zooms}
                  splits={splits}
                  tl={tl}
                  faces={faces}
                  gradeRef={gradeRef}
                  effectRefs={effectRefs}
                >
                  <Scenes
                    tl={tl}
                    faces={faces}
                    sources={sources}
                    look={doc.look}
                    mediaBase={mediaBase}
                    quality={quality}
                    muted={muteSources}
                    transitions={transitionFiles}
                    accent={theme.accent}
                    jlFade={doc.mix.jlFade}
                    cutFade={doc.mix.cutFade}
                    cutouts={cutouts}
                    ramps={ramps}
                    flows={flows}
                    steadies={steadies}
                    framed={framed}
                    layer="base"
                  />
                </Camera>
              )}
              {/* Behind the subject: drawn over the footage, then the cut-out person over them. */}
              {layers === "all" &&
                layered(visuals)
                  .filter((v) => behind(v.item))
                  .map(visualNode)}
              {layers === "all" && titles.filter((t) => behind(t.item)).map(titleNode)}
              {footage && (
                <Camera
                  zooms={zooms}
                  splits={splits}
                  tl={tl}
                  faces={faces}
                  gradeRef={subjectGradeRef}
                  effectRefs={subjectEffectRefs}
                >
                  <Scenes
                    tl={tl}
                    faces={faces}
                    sources={sources}
                    look={doc.look}
                    mediaBase={mediaBase}
                    quality={quality}
                    muted
                    transitions={transitionFiles}
                    accent={theme.accent}
                    jlFade={doc.mix.jlFade}
                    cutFade={doc.mix.cutFade}
                    cutouts={cutouts}
                    ramps={ramps}
                    flows={flows}
                    steadies={steadies}
                    framed={framed}
                    layer="subject"
                  />
                </Camera>
              )}
              {footage && (
                <GradeLayer css={gradeCss} target={[gradeRef, subjectGradeRef]} accent={theme.accent} />
              )}
              {footage && doc.look.vignette && (
                <AbsoluteFill
                  style={{
                    background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${doc.look.vignetteStrength}) 100%)`,
                  }}
                />
              )}
              {layered(visuals)
                .filter((v) => !behind(v.item) && !v.item.onTop)
                // Cutaways, and graphics that fill the frame or a panel of it, are the picture; overlays are drawn over it.
                .filter(inLayers)
                .map(visualNode)}
              {overlays && titles.filter((t) => !behind(t.item) && !t.item.onTop).map(titleNode)}
              {/* Captions page on cue by design: left out of measuring motion. */}
              {layers === "all" && (
                <Captions
                  manual={captions}
                  pages={doc.captionStyle.speech ? pages : []}
                  style={doc.captionStyle}
                  tl={tl}
                  faces={faces}
                  zooms={zooms}
                  busy={busy}
                  echoes={echoes}
                  splits={splits}
                  lookCss={lookCss}
                />
              )}
              {/* Camera effects (a flash, a shake) are moves on the footage, not graphics: left out of measuring. */}
              {layers === "all" && (
                <Effects
                  effects={effects}
                  files={effectFiles}
                  slots={effectRefs.map((r, i) => ({ base: r, subject: subjectEffectRefs[i]! }))}
                  cutAt={(t) => {
                    const p = sceneAt(tl, t);
                    return !!p && cutouts.has(p.scene.id);
                  }}
                  accent={theme.accent}
                />
              )}
              {/* Over everything: overlays marked onTop (a watermark, a logo), captions and effects included. */}
              {layered(visuals)
                .filter((v) => !behind(v.item) && v.item.onTop)
                .filter(inLayers)
                .map(visualNode)}
              {overlays && titles.filter((t) => !behind(t.item) && t.item.onTop).map(titleNode)}
              {doc.exportSettings.creditsInVideo && doc.music.source && doc.music.credit ? (
                <Sequence from={Math.max(0, tlFrames - Math.round(fps * 3))} layout="none">
                  <MusicCredit text={doc.music.credit} font={theme.font} />
                </Sequence>
              ) : null}
              {audio && doc.music.source && sources.has(doc.music.source) ? (
                <Music doc={doc} speech={speech} cues={musicCues} mediaBase={mediaBase} />
              ) : null}
              {(audio ? musicClips : [])
                .filter((m) => sources.has(m.item.source))
                .map((m) => (
                  <Sequence
                    key={m.item.id}
                    from={m.from}
                    durationInFrames={m.durationInFrames}
                    // Loaded a second ahead, so it sounds on its frame. (Premounting needs a layer: an empty one.)
                    premountFor={fps}
                    style={SILENT_LAYER}
                  >
                    <MusicClipAudio
                      clip={m}
                      speech={speech}
                      mediaBase={mediaBase}
                      level={doc.mix.musicLevel}
                      ramp={doc.music.duckRamp}
                    />
                  </Sequence>
                ))}
              {(audio ? sfx : []).map((s) => (
                <Sequence
                  key={s.item.id}
                  from={s.from}
                  durationInFrames={s.durationInFrames}
                  premountFor={fps}
                  style={SILENT_LAYER}
                >
                  <SoundEffect sfx={s} mediaBase={mediaBase} level={doc.mix.sfxLevel} />
                </Sequence>
              ))}
              {(audio ? visuals : []).map((v) => {
                const name = doc.mix.entrySounds ? ENTRY_SFX(v.item) : null;
                return name ? (
                  <Sequence
                    key={`${v.item.id}-sfx`}
                    from={v.from}
                    durationInFrames={Math.round(fps * 2)}
                    // Loaded a second ahead, so it sounds on its frame. (Premounting needs a layer: an empty one.)
                    premountFor={fps}
                    style={SILENT_LAYER}
                  >
                    <Sound
                      src={`${mediaBase}sfx/${name}`}
                      volume={(v.item.sfxVolume ?? 0.7) * doc.mix.sfxLevel}
                    />
                  </Sequence>
                ) : null;
              })}
            </AbsoluteFill>
          </FitContext.Provider>
        </LivePreview.Provider>
      </GradeProvider>
    </ProjectFontsContext.Provider>
  );
};

/**
 * Playing in the editor (not rendering): sound goes through an <audio> element, which never holds the
 * player while it loads. @remotion/media holds it until a fifth of a second is decoded, a 230ms hitch
 * at every cut and sound effect (measured in the app). Renders keep @remotion/media: sample-exact.
 */
const LivePreview = createContext(false);

interface SoundProps {
  readonly src: string;
  readonly volume: VolumeProp;
  readonly trimBefore?: number;
  readonly trimAfter?: number;
  readonly loop?: boolean;
  readonly playbackRate?: number;
  readonly muted?: boolean;
}

function Sound(p: SoundProps) {
  const live = useContext(LivePreview);
  const props = {
    src: p.src,
    volume: p.volume,
    ...(p.trimBefore !== undefined && { trimBefore: p.trimBefore }),
    ...(p.trimAfter !== undefined && { trimAfter: p.trimAfter }),
    ...(p.loop !== undefined && { loop: p.loop }),
    ...(p.playbackRate !== undefined && { playbackRate: p.playbackRate }),
    ...(p.muted !== undefined && { muted: p.muted }),
  };
  return live ? <Html5Audio {...props} pauseWhenBuffering={false} /> : <Audio {...props} />;
}

/** The layer a sound's sequence draws: nothing, and nothing that takes a click. */
const SILENT_LAYER: CSSProperties = { pointerEvents: "none" };

/**
 * The box an overlay lays itself out in: the whole frame, or (an overlay marked clear) the platform's
 * clear area, off the app's buttons. Titles and media boxes measure from it; a graphic's stage fills it.
 */
const AreaContext = createContext<Rect | null>(null);

/** The size an overlay lays itself out in. */
function useArea(): { width: number; height: number } {
  const area = useContext(AreaContext);
  const { width, height } = useVideoConfig();
  return area ? { width: area.width, height: area.height } : { width, height };
}

/** An overlay inside `rect` (the clear area) when it has one, the whole frame otherwise. */
function InArea({ rect, children }: { rect: Rect | null; children: ReactNode }) {
  if (!rect) return <>{children}</>;
  return (
    <AbsoluteFill
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: "auto",
        bottom: "auto",
      }}
    >
      <AreaContext.Provider value={rect}>{children}</AreaContext.Provider>
    </AbsoluteFill>
  );
}

/** How footage fills a frame of another shape (look.fit). */
const FitContext = createContext<{ fit: Look["fit"]; backdrop: Look["fitBackdrop"] }>({
  fit: "auto",
  backdrop: { blur: 48, brightness: 0.55, saturation: 1.1, zoom: 1.15 },
});

/** A shot's framing: where its person is, and their path through it when the frame follows them. */
interface Framed {
  readonly face?: Face;
  readonly path?: { readonly x: Float32Array; readonly y: Float32Array };
}

/** Frames where someone is talking, merged across short gaps. Drives music ducking. */
function speechSpans(pages: readonly CaptionPage[], fps: number): FrameSpan[] {
  const spans: FrameSpan[] = [];
  for (const p of pages) {
    const s = frameSpan({ start: p.start, end: p.words.at(-1)!.end }, fps);
    const last = spans.at(-1);
    if (last && s.from - (last.from + last.durationInFrames) < fps * 0.3)
      spans[spans.length - 1] = {
        from: last.from,
        durationInFrames: s.from + s.durationInFrames - last.from,
      };
    else spans.push(s);
  }
  return spans;
}

// --- Camera --------------------------------------------------------------------------------------

/** 0 = speaker full screen, 1 = speaker in the bottom half, moving in step with split panels. */
interface SplitState {
  /** 0 no split, 1 fully open. */
  readonly amount: number;
  /** Share of the frame the visual takes. */
  readonly ratio: number;
  /** Where the visual sits; the speaker gets the rest. */
  readonly side: "top" | "bottom";
}

/** How open a split is at a frame, and its shape (visual.split, visual.enter). */
function splitState(splits: readonly Timed<Visual>[], frame: number, fps: number): SplitState {
  let best: SplitState = { amount: 0, ratio: 0.5, side: "top" };
  for (const s of splits) {
    const end = s.from + s.durationInFrames;
    if (frame < s.from - 1 || frame > end + 1) continue;
    const n = Math.max(1, Math.round((s.item.enter ?? 0.4) * fps));
    const amount = ramp(frame, s.from, n, EASE_IN_OUT) - ramp(frame, end - n, n, EASE_IN_OUT);
    if (amount > best.amount)
      best = { amount, ratio: s.item.split?.ratio ?? 0.5, side: s.item.split?.side ?? "top" };
  }
  return best;
}

/** Scale over a zoom's life: ease in, hold, ease out. "punch" snaps in on a spring. */
function zoomScale(z: Timed<Zoom>, frame: number, fps: number): number {
  const local = frame - z.from;
  const n = z.durationInFrames;
  const edge = Math.min(Math.round(fps * (z.item.edge ?? 0.35)), Math.floor(n / 2));
  const curve = z.item.curve?.split(",").map(Number) as [number, number, number, number] | undefined;
  const easing = curve ? Easing.bezier(...curve) : Easing.inOut(Easing.cubic);
  const outro = interpolate(local, [n - edge, n], [1, 0], { ...clamp, easing });
  const intro =
    z.item.ease === "punch" && !curve
      ? spring({ frame: local, fps, config: { damping: 18, stiffness: 260, mass: 0.6 } })
      : interpolate(local, [0, edge], [0, 1], { ...clamp, easing });
  return 1 + (z.item.scale - 1) * Math.min(intro, outro);
}

/** How many effects can act on the picture at once (more are skipped until one ends). */
const EFFECT_SLOTS = 3;

function Camera({
  zooms,
  splits,
  tl,
  faces,
  gradeRef,
  effectRefs,
  children,
}: {
  zooms: readonly Timed<Zoom>[];
  splits: readonly Timed<Visual>[];
  tl: Timeline;
  faces: Faces;
  /** The grade's file styles this wrapper (StyleLayer copies onto it). */
  gradeRef: RefObject<HTMLDivElement | null>;
  /** One nested wrapper per effect slot. */
  effectRefs: readonly RefObject<HTMLDivElement | null>[];
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const face = faceAt(tl, faces, frame / fps);
  const zoom = zooms.find((z) => isActive(z, frame));
  const scale = zoom ? zoomScale(zoom, frame, fps) : 1;
  const origin = zoom
    ? `${zoom.item.focus.x * 100}% ${zoom.item.focus.y * 100}%`
    : `${face.x * 100}% ${face.y * 100}%`;
  // In a split the speaker moves into the rest of the frame, framed so their face sits in its middle.
  const sp = splitState(splits, frame, fps);
  const panel = sp.amount * sp.ratio * height;
  const top = sp.side === "top" ? panel : 0;
  const room = (1 - sp.ratio) * height;
  const windowOffset = Math.min(sp.ratio * height, Math.max(0, face.y * height - room / 2));
  // The wrappers are always there, so effects coming and going never remount the footage.
  const picture = effectRefs.reduceRight<ReactNode>(
    (inner, ref, i) => (
      <AbsoluteFill key={i} ref={ref}>
        {inner}
      </AbsoluteFill>
    ),
    children,
  );
  return (
    <AbsoluteFill style={{ top, height: height - panel, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          top: -sp.amount * windowOffset,
          height,
          transform: `scale(${scale})`,
          transformOrigin: origin,
          willChange: "transform",
        }}
      >
        <AbsoluteFill ref={gradeRef}>{picture}</AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** The colour grade (grades/<id>.css) on all the footage, on the video's clock. */
function GradeLayer({
  css,
  target,
  accent,
}: {
  css: string;
  target: RefObject<HTMLDivElement | null> | readonly RefObject<HTMLDivElement | null>[];
  accent: string;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <StyleLayer
      css={css}
      t={frame / fps}
      duration={durationInFrames / fps}
      accent={accent}
      targets={{ picture: target }}
    />
  );
}

/** Effects placed in time, each run by its file (effects/<kind>.css) on its own clock. */
function Effects({
  effects,
  files,
  slots,
  cutAt,
  accent,
}: {
  effects: readonly Timed<Effect>[];
  files: ReadonlyMap<string, string>;
  /** Per slot, the wrappers it moves: the footage's, and its cutout's. */
  slots: readonly {
    readonly base: RefObject<HTMLDivElement | null>;
    readonly subject: RefObject<HTMLDivElement | null>;
  }[];
  /** Whether the shot at a time (seconds) has the person cut out. */
  cutAt: (t: number) => boolean;
  accent: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = effects.filter((e) => isActive(e, frame) && files.has(e.item.kind)).slice(0, slots.length);
  return (
    <>
      {active.map((e, i) => {
        const slot = slots[i]!;
        // .subject and .background style the person and what's behind them apart, once the shot is cut
        // out; until then they do nothing (greying the whole picture would grey the person too).
        const apart = cutAt(e.from / fps);
        return (
          <StyleLayer
            key={`${e.item.id}:${i}`}
            css={files.get(e.item.kind)!}
            t={(frame - e.from) / fps}
            duration={e.durationInFrames / fps}
            accent={accent}
            targets={
              apart
                ? { frame: [slot.base, slot.subject], subject: slot.subject, background: slot.base }
                : { frame: [slot.base, slot.subject] }
            }
          />
        );
      })}
    </>
  );
}

const Scenes = memo(function Scenes({
  tl,
  faces,
  sources,
  look,
  mediaBase,
  quality,
  muted,
  transitions,
  accent,
  jlFade,
  cutFade,
  cutouts,
  ramps,
  flows,
  steadies,
  framed,
  layer,
}: {
  tl: Timeline;
  faces: Faces;
  sources: ReadonlyMap<string, Source>;
  look: Look;
  mediaBase: string;
  quality: "preview" | "export";
  muted: boolean;
  /** transitions/<id>.css by id. */
  transitions: ReadonlyMap<string, string>;
  accent: string;
  /** Crossfade at J/L cuts (mix.jlFade). */
  jlFade: number;
  /** The short crossfade at every hard cut (mix.cutFade). */
  cutFade: number;
  /** Shots with the person cut out: the cutout's media key and where it starts in the clip. */
  cutouts: ReadonlyMap<string, { key: string; from: number; to: number; plate?: string }>;
  /** Ramped shots: their rendered footage's media key. */
  ramps: ReadonlyMap<string, string>;
  /** Shots slowed by their speed, made smooth: the file and the stretch of the clip it covers. */
  flows: ReadonlyMap<string, { key: string; from: number; to: number }>;
  steadies: ReadonlyMap<string, Steadied>;
  /** Each shot's framing on its person. */
  framed: ReadonlyMap<string, Framed>;
  /** The footage, or the cut-out person drawn over it (and over anything behind the subject). */
  layer: "base" | "subject";
}) {
  const { fps, width, height } = useVideoConfig();
  // Jump cuts: back-to-back shots of the same clip alternate between 1x and a slight zoom, so a cut
  // inside one take reads as a deliberate camera change instead of a glitch.
  const jumped = useMemo(() => jumpedShots(tl), [tl]);
  // Each shot gets a wrapper a transition can move; transitions overlap the two shots around the cut.
  const wrappers = useMemo(
    () => new Map(tl.scenes.map((p) => [p.scene.id, createRef<HTMLDivElement>()])),
    [tl],
  );
  const windows = useMemo(() => transitionWindows(tl, fps, transitions), [tl, fps, transitions]);
  const plan = useMemo(() => audioPlan(tl, jlFade, cutFade), [tl, jlFade, cutFade]);
  // Whole frames of output in `seconds` of footage at `speed` (what a cutout has to spare past a cut).
  const spare = (seconds: number, speed: number) => Math.max(0, Math.floor((seconds / speed) * fps + 1e-6));
  return (
    <>
      {tl.scenes.map((p, i) => {
        const span = frameSpan({ start: p.start, end: p.start + p.duration }, fps);
        const source = sources.get(p.scene.source);
        const cut = cutouts.get(p.scene.id);
        if (layer === "subject") {
          // The person alone, placed and moved exactly like the footage under them: through the
          // transitions either side too (as far as the cutout reaches), moved by them like the footage.
          if (!cut || !source) return null;
          const fr = framed.get(p.scene.id);
          const face = fr?.face ?? faces.get(p.scene.source);
          const speed = p.scene.speed ?? 1;
          const own = span.durationInFrames;
          const early = Math.min(windows.get(p.scene.id)?.before ?? 0, spare(p.scene.in - cut.from, speed));
          const late = Math.min(
            windows.get(tl.scenes[i + 1]?.scene.id ?? "")?.after ?? 0,
            spare(cut.to - p.scene.out, speed),
          );
          return (
            <Sequence
              key={p.scene.id}
              from={span.from - early}
              durationInFrames={early + own + late}
              premountFor={fps}
              name={`${p.scene.id} subject`}
            >
              <AbsoluteFill ref={wrappers.get(p.scene.id)}>
                <ShotWindow
                  from={0}
                  to={early + own + late}
                  filter={adjustFilter(p.scene.adjust)}
                  color={adjustColor(p.scene.adjust)}
                  flip={p.scene.flip ?? false}
                >
                  <ShotMotion
                    drift={look.drift ? (look.driftAmount ?? DRIFT) : 0}
                    zoom={jumped[i] ? look.jumpZoom : 1}
                    framing={p.scene.framing}
                    face={face}
                    offset={early}
                    length={own}
                    camera={p.scene.camera}
                  >
                    <SubjectLook
                      look={p.scene.subject}
                      id={p.scene.id}
                      accent={accent}
                      offset={early}
                      length={own}
                    >
                      <Steady
                        st={steadies.get(p.scene.id)}
                        at={(f) => p.scene.in + ((f - early) / fps) * speed}
                      >
                        <SceneMedia
                          scene={{
                            ...p.scene,
                            in: p.scene.in - (early / fps) * speed - cut.from,
                            out: p.scene.out + (late / fps) * speed - cut.from,
                          }}
                          face={face}
                          {...(fr?.path && { follow: { ...fr.path, offset: early } })}
                          backdrop={false}
                          source={source}
                          mediaKey={cut.key}
                          mediaBase={mediaBase}
                          quality={quality}
                          muted
                          volume={0}
                        />
                      </Steady>
                    </SubjectLook>
                  </ShotMotion>
                </ShotWindow>
              </AbsoluteFill>
            </Sequence>
          );
        }
        const ramp = ramps.get(p.scene.id);
        const fr = framed.get(p.scene.id);
        const face = fr?.face ?? faces.get(p.scene.source);
        const bg = cut ? p.scene.background : undefined;
        const bgSource = bg?.kind === "clip" && bg.source ? sources.get(bg.source) : undefined;
        const sound = plan[i]!;
        // Picture: into a transition, a shot shows early; out of one, it shows past its cut.
        const picEarly = windows.get(p.scene.id)?.before ?? 0;
        const picLate = windows.get(tl.scenes[i + 1]?.scene.id ?? "")?.after ?? 0;
        // Sound: J- and L-cuts and crossfades move where it's heard (see audioPlan).
        const soundEarly = Math.max(0, Math.round((p.start - (sound.from - sound.fadeIn / 2)) * fps));
        const soundLate = Math.max(
          0,
          Math.round((sound.to + sound.fadeOut / 2 - (p.start + p.duration)) * fps),
        );
        const media = source?.kind === "video" ? source.duration : Infinity;
        // Extra frames are output time; at a speed, they're more or less footage.
        const speed = p.scene.speed ?? 1;
        const from = ramp
          ? p.scene.in
          : Math.max(0, p.scene.in - (Math.max(picEarly, soundEarly) / fps) * speed);
        const to = ramp
          ? p.scene.out
          : Math.min(media, p.scene.out + (Math.max(picLate, soundLate) / fps) * speed);
        const lead = Math.round(((p.scene.in - from) / speed) * fps);
        const late = ramp ? 0 : Math.max(picLate, soundLate);
        const plateEarly = cut ? Math.min(picEarly, lead, spare(p.scene.in - cut.from, speed)) : 0;
        // Slowed by its speed and made smooth (a halo-free plate, when there is one, shows instead).
        const flow = ramp || (bg?.kind === "blur" && cut?.plate) ? undefined : flows.get(p.scene.id);
        const flowEarly = flow ? Math.min(picEarly, lead, spare(p.scene.in - flow.from, speed)) : 0;
        const steady = steadies.get(p.scene.id);
        const rmap = steady && ramp ? rampMap(p.scene) : null;
        const own = span.durationInFrames;
        const seqFrom = span.from - lead;
        const extended = lead > 0 || late > 0;
        return (
          <Sequence
            key={p.scene.id}
            from={seqFrom}
            durationInFrames={lead + own + late}
            premountFor={fps}
            name={p.scene.id}
          >
            <AbsoluteFill ref={wrappers.get(p.scene.id)}>
              <ShotWindow
                from={lead - Math.min(picEarly, lead)}
                to={lead + own + picLate}
                filter={adjustFilter(p.scene.adjust)}
                color={adjustColor(p.scene.adjust)}
                flip={p.scene.flip ?? false}
              >
                <ShotMotion
                  drift={look.drift ? (look.driftAmount ?? DRIFT) : 0}
                  zoom={jumped[i] ? look.jumpZoom : 1}
                  framing={p.scene.framing}
                  face={face}
                  offset={lead}
                  length={own}
                  camera={p.scene.camera}
                >
                  <Steady
                    st={steady}
                    at={(f) => (rmap ? p.scene.in + rmap.sourceAt(f / fps) : from + (f / fps) * speed)}
                  >
                    {/* Behind the cut-out person: the footage blurred, or dimmed (pushed a little so blurred edges stay off frame). */}
                    <AbsoluteFill
                      style={
                        bg?.kind === "blur" && cut?.plate
                          ? // The halo-free plate shows instead; the footage stays, unseen, for its sound in preview.
                            { opacity: 0 }
                          : bg?.kind === "blur"
                            ? { filter: `blur(${bg.amount ?? 18}px)`, transform: "scale(1.08)" }
                            : bg?.kind === "dim"
                              ? { filter: `brightness(${(1 - Math.min(1, bg.amount ?? 0.55)).toFixed(3)})` }
                              : bg?.kind === "mono"
                                ? {
                                    filter: `grayscale(${Math.min(1, bg.amount ?? 1).toFixed(3)}) contrast(1.06)`,
                                  }
                                : undefined
                      }
                    >
                      <AbsoluteFill style={flow ? { opacity: 0 } : undefined}>
                        <SceneMedia
                          scene={
                            ramp
                              ? { ...p.scene, in: 0, out: sceneLength(p.scene), speed: 1 }
                              : { ...p.scene, in: from, out: to }
                          }
                          face={face}
                          {...(fr?.path && { follow: { ...fr.path, offset: lead } })}
                          source={source}
                          {...(ramp && { mediaKey: ramp })}
                          mediaBase={mediaBase}
                          quality={quality}
                          muted={muted || !!ramp}
                          // Heard where the sound plan says, crossfading with its neighbours (a ramp drops it).
                          volume={
                            ramp
                              ? 0
                              : extended
                                ? (f: number) => p.scene.volume * gainAt(sound, (seqFrom + f) / fps)
                                : p.scene.volume
                          }
                        />
                      </AbsoluteFill>
                      {flow && source && (
                        // Smooth slow motion, picture only: from where the shot shows, as far as it reaches.
                        <Sequence from={lead - flowEarly} layout="none">
                          <SceneMedia
                            scene={{
                              ...p.scene,
                              in: (p.scene.in - (flowEarly / fps) * speed - flow.from) / speed,
                              out: (Math.min(to, flow.to) - flow.from) / speed,
                              speed: 1,
                            }}
                            face={face}
                            {...(fr?.path && { follow: { ...fr.path, offset: flowEarly } })}
                            source={source}
                            mediaKey={flow.key}
                            mediaBase={mediaBase}
                            quality={quality}
                            muted
                            volume={0}
                          />
                        </Sequence>
                      )}
                    </AbsoluteFill>
                    {bg?.kind === "blur" && cut?.plate && source && (
                      // Picture only: from where the shot shows (not where its sound starts), as far as the plate reaches.
                      <Sequence from={lead - plateEarly} layout="none">
                        <SceneMedia
                          scene={{
                            ...p.scene,
                            in: p.scene.in - (plateEarly / fps) * speed - cut.from,
                            out: Math.min(to, cut.to) - cut.from,
                          }}
                          face={face}
                          {...(fr?.path && { follow: { ...fr.path, offset: plateEarly } })}
                          source={source}
                          mediaKey={cut.plate}
                          mediaBase={mediaBase}
                          quality={quality}
                          muted
                          volume={0}
                        />
                      </Sequence>
                    )}
                  </Steady>
                  {/* Or replaced: a colour or another clip, with the person drawn over it. */}
                  {bg?.kind === "color" && (
                    <AbsoluteFill style={{ backgroundColor: bg.color ?? "#111111" }} />
                  )}
                  {bgSource && (
                    <AbsoluteFill>
                      <ClipMedia
                        source={bgSource}
                        from={bg?.in ?? 0}
                        framing={undefined}
                        volume={0}
                        muted
                        mediaBase={mediaBase}
                        quality={quality}
                        width={width}
                        height={height}
                      />
                    </AbsoluteFill>
                  )}
                </ShotMotion>
              </ShotWindow>
            </AbsoluteFill>
          </Sequence>
        );
      })}
      {tl.scenes.map((p, i) => {
        const w = windows.get(p.scene.id);
        const prev = tl.scenes[i - 1];
        if (!w || !prev) return null;
        return (
          <Sequence
            key={`tr:${p.scene.id}`}
            from={w.cut - w.before}
            durationInFrames={w.before + w.after}
            name={`transition ${p.scene.id}`}
          >
            <TransitionLayer
              css={w.css}
              accent={accent}
              targets={{ out: wrappers.get(prev.scene.id)!, in: wrappers.get(p.scene.id)! }}
            />
          </Sequence>
        );
      })}
    </>
  );
});

/**
 * The cut-out person's own look (scene.subject): an outline, a glow, a shadow, drawn from the cutout's
 * alpha by an SVG filter, easing on and off over its stretch of the shot.
 */
export function SubjectLook({
  look,
  id,
  accent,
  offset = 0,
  length,
  children,
}: {
  look: Scene["subject"];
  id: string;
  accent: string;
  /** Frames the shot starts early (into a transition); its look is timed to the shot itself. */
  offset?: number;
  /** The shot's length in frames. */
  length: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame() - offset;
  const { fps } = useVideoConfig();
  if (!look || (!look.outline && !look.glow && !look.shadow)) return <>{children}</>;
  const a = look.from ? Math.round(look.from * fps) : null;
  const b = look.to !== undefined ? Math.round(look.to * fps) : null;
  const on = a === null ? 1 : ramp(frame, a, Math.round(fps * 0.25));
  const off = b === null ? 0 : ramp(frame, b - Math.round(fps * 0.2), Math.round(fps * 0.2), EASE_IN_OUT);
  const k = Math.max(0, Math.min(on, 1 - off, frame < length ? 1 : 0));
  if (k <= 0.001) return <>{children}</>;
  const fid = `subject-${id}`;
  const { outline, glow, shadow } = look;
  const n = (v: number) => v.toFixed(3);
  return (
    <AbsoluteFill style={{ filter: `url(#${fid})` }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id={fid} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          {/* A firmer edge than the soft matte, so outlines come out clean. */}
          <feComponentTransfer in="SourceAlpha" result="edge">
            <feFuncA type="linear" slope="3" intercept="-1" />
          </feComponentTransfer>
          {shadow ? (
            <>
              <feGaussianBlur in="edge" stdDeviation="22" result="sb" />
              <feOffset in="sb" dy="18" result="so" />
              <feFlood floodColor="#000000" floodOpacity={n(shadow * k)} />
              <feComposite in2="so" operator="in" result="shadow" />
            </>
          ) : null}
          {glow ? (
            <>
              <feGaussianBlur in="edge" stdDeviation={n(glow.size / 2)} result="gb" />
              <feComponentTransfer in="gb" result="gb2">
                <feFuncA type="linear" slope="2.2" />
              </feComponentTransfer>
              <feFlood floodColor={glow.color ?? accent} floodOpacity={n(glow.strength * k)} />
              <feComposite in2="gb2" operator="in" result="glow" />
            </>
          ) : null}
          {outline ? (
            <>
              <feMorphology in="edge" operator="dilate" radius={n(outline.width * k)} result="grown" />
              <feFlood floodColor={outline.color} floodOpacity={n(Math.min(1, k * 1.5))} />
              <feComposite in2="grown" operator="in" result="outline" />
            </>
          ) : null}
          <feMerge>
            {shadow ? <feMergeNode in="shadow" /> : null}
            {glow ? <feMergeNode in="glow" /> : null}
            {outline ? <feMergeNode in="outline" /> : null}
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </svg>
      {children}
    </AbsoluteFill>
  );
}

/** The picture of a shot outside its own frames (kept running only for its sound) stays hidden. */
function ShotWindow({
  from,
  to,
  filter,
  color,
  flip,
  children,
}: {
  from: number;
  to: number;
  filter: string;
  /** The shot's own colour correction, run on its footage under the grade. */
  color: GradeColor | null;
  flip: boolean;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        visibility: frame >= from && frame < to ? "visible" : "hidden",
        ...(filter && { filter }),
        ...(flip && { transform: "scaleX(-1)" }),
      }}
    >
      <ShotColor color={color}>{children}</ShotColor>
    </AbsoluteFill>
  );
}

/** A shot's own colour and exposure (scene.adjust), corrected on the GPU before the grade. */
function adjustColor(a: Scene["adjust"]): GradeColor | null {
  return a ? shotColor(a) : null;
}

/** What of a shot's adjustment is CSS: its blur (the colour is the GPU's, adjustColor). */
function adjustFilter(a: Scene["adjust"]): string {
  return a?.blur ? `blur(${a.blur}px)` : "";
}

/** How loud a shot's sound is at output time `t`: full inside its span, ramping across crossfades. */
function gainAt(span: AudioSpan, t: number): number {
  const rampIn = span.fadeIn > 0 ? (t - (span.from - span.fadeIn / 2)) / span.fadeIn : t >= span.from ? 1 : 0;
  const rampOut = span.fadeOut > 0 ? (span.to + span.fadeOut / 2 - t) / span.fadeOut : t < span.to ? 1 : 0;
  return Math.max(0, Math.min(1, rampIn, rampOut));
}

/**
 * Jump cuts: back-to-back shots of the same clip alternate between 1x and a slight zoom, so a cut inside
 * one take reads as a deliberate camera change instead of a glitch (scene.jumpZoom false opts out).
 */
function jumpedShots(tl: Timeline): boolean[] {
  const out: boolean[] = [];
  tl.scenes.forEach((p, i) => {
    const prev = tl.scenes[i - 1];
    out.push(
      Boolean(
        prev &&
          prev.scene.source === p.scene.source &&
          // A reframe shared with the shot before (say, both pushed in to cut headroom) still alternates.
          (!p.scene.framing || JSON.stringify(p.scene.framing) === JSON.stringify(prev.scene.framing)) &&
          p.scene.jumpZoom !== false &&
          !out[i - 1],
      ),
    );
  });
  return out;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where a box in a shot's source picture (fractions of the source frame) lands in the output frame
 * (fractions of it) at an output frame: the same maths as coverBox, ShotMotion and Camera, so a graphic
 * can follow something in the footage. Effects and transitions are left out.
 */
function mapToFrame(
  ctx: {
    tl: Timeline;
    sources: ReadonlyMap<string, Source>;
    faces: Faces;
    look: Look;
    jumped: readonly boolean[];
    zooms: readonly Timed<Zoom>[];
    splits: readonly Timed<Visual>[];
    visuals: readonly Timed<Visual>[];
    fps: number;
    width: number;
    height: number;
  },
  frame: number,
  box: Box,
): Box | null {
  const { tl, sources, faces, look, fps, width: W, height: H } = ctx;
  const t = frame / fps;
  const placed = sceneAt(tl, t);
  const src = placed && sources.get(placed.scene.source);
  if (!placed || !src) return null;
  const face = faces.get(src.id);
  // The crop that fills the frame.
  const cb = coverBox(W, H, src, placed.scene.framing, face);
  const bw = typeof cb.width === "number" ? cb.width : W;
  const bh = typeof cb.height === "number" ? cb.height : H;
  const left = typeof cb.left === "number" ? cb.left : 0;
  const top0 = typeof cb.top === "number" ? cb.top : 0;
  let x = left + box.x * bw;
  let y = top0 + box.y * bh;
  let w = box.w * bw;
  let h = box.h * bh;
  // The shot's own push-in and jump-cut zoom.
  const local = frame - Math.round(placed.start * fps);
  const length = Math.round(placed.duration * fps);
  const drift = look.drift ? (look.driftAmount ?? DRIFT) : 0;
  const d =
    1 +
    drift *
      interpolate(local, [0, Math.max(1, length)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  const sm = (ctx.jumped[placed.index] ? look.jumpZoom : 1) * d;
  const o1x = (placed.scene.framing?.x ?? face?.x ?? 0.5) * W;
  const o1y = (placed.scene.framing?.y ?? face?.y ?? 0.42) * H;
  x = o1x + (x - o1x) * sm;
  y = o1y + (y - o1y) * sm;
  w *= sm;
  h *= sm;
  // The camera: punch-in zooms and split screens.
  const zoom = ctx.zooms.find((z) => isActive(z, frame));
  const cz = zoom ? zoomScale(zoom, frame, fps) : 1;
  const faceNow = faceAt(tl, faces, t);
  const o2x = (zoom ? zoom.item.focus.x : faceNow.x) * W;
  const o2y = (zoom ? zoom.item.focus.y : faceNow.y) * H;
  const sp = splitState(ctx.splits, frame, fps);
  const panel = sp.amount * sp.ratio * H;
  const room = (1 - sp.ratio) * H;
  const windowOffset = Math.min(sp.ratio * H, Math.max(0, faceNow.y * H - room / 2));
  const shift = (sp.side === "top" ? panel : 0) - sp.amount * windowOffset;
  x = o2x + (x - o2x) * cz;
  y = shift + o2y + (y - o2y) * cz;
  return { x: x / W, y: y / H, w: (w * cz) / W, h: (h * cz) / H };
}

/**
 * How long a cutaway fades out: its own exit, or a short fade, except when it ends on a cut, where a fade
 * would only uncover the last frames of the outgoing shot, so it cuts with the footage.
 */
function exitOf(v: Timed<Visual>, tl: Timeline, fps: number): number {
  if (v.item.exit !== undefined) return v.item.exit;
  const end = v.from + v.durationInFrames;
  const onCut = tl.scenes.some((p) => p.start > 0 && Math.abs(Math.round(p.start * fps) - end) <= 2);
  return onCut ? 0 : 0.23;
}

/** Keyframed motion on a graphic or title (keyframes), on top of its own animation. */
function Keyframed({
  keyframes,
  children,
}: {
  keyframes: readonly Keyframe[] | undefined;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (!keyframes?.length) return <>{children}</>;
  const p = poseAt(keyframes, frame / fps);
  return (
    <AbsoluteFill style={{ transform: poseTransform(p, width, height), opacity: p.opacity }}>
      {children}
    </AbsoluteFill>
  );
}

/** A visual's drawing layer: its own, or cutaways under graphics. */
const layerOf = (v: Visual) => v.layer ?? (v.content.kind === "cutaway" ? 0 : 1);

/** Visuals in drawing order: by layer, then list order. */
const layered = <T extends { item: Visual }>(visuals: readonly T[]): T[] =>
  visuals
    .map((v, i) => ({ v, i }))
    .sort((a, b) => layerOf(a.v.item) - layerOf(b.v.item) || a.i - b.i)
    .map((x) => x.v);

/** Cutaways on screen at a frame, topmost first. */
function onScreenCutaways(visuals: readonly Timed<Visual>[], frame: number): Timed<Visual>[] {
  return layered(visuals.filter((v) => v.item.content.kind === "cutaway" && isActive(v, frame))).reverse();
}

/**
 * Where a box in a cutaway's source picture lands in the output frame: the same maths as VisualView
 * (the clip covering its panel, the settle zoom around the panel's centre, the panel's place).
 */
function mapInCutaway(
  ctx: Parameters<typeof mapToFrame>[0],
  v: Timed<Visual>,
  frame: number,
  box: Box,
): Box | null {
  const content = v.item.content;
  if (content.kind !== "cutaway") return null;
  const src = ctx.sources.get(content.source);
  if (!src) return null;
  const { width: W, height: H } = ctx;
  const split = v.item.layout === "split";
  const ratio = split ? (v.item.split?.ratio ?? 0.5) : 1;
  const ph = ratio * H;
  const top = split && (v.item.split?.side ?? "top") === "bottom" ? H - ph : 0;
  const cb = coverBox(W, ph, src, content.framing);
  const bw = typeof cb.width === "number" ? cb.width : W;
  const bh = typeof cb.height === "number" ? cb.height : ph;
  const left = typeof cb.left === "number" ? cb.left : 0;
  const top0 = typeof cb.top === "number" ? cb.top : 0;
  const s = settleScale(content.settle, frame - v.from);
  const x = W / 2 + (left + box.x * bw - W / 2) * s;
  const y = top + ph / 2 + (top0 + box.y * bh - ph / 2) * s;
  return { x: x / W, y: y / H, w: (box.w * bw * s) / W, h: (box.h * bh * s) / H };
}

/** A cutaway's settle: a hard cut in, slightly pushed in, easing out to the full frame. */
const settleScale = (settle: number | undefined, local: number) =>
  interpolate(ramp(local, 0, 36), [0, 1], [settle ?? 1.08, 1]);

/** A track's box at a source time: interpolated between samples, clamped at its ends. */
function trackBoxAt(track: MotionTrack, t: number): Box {
  const pts = track.points;
  if (t <= pts[0]!.t) return pts[0]!;
  if (t >= pts.at(-1)!.t) return pts.at(-1)!;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const mix = (u: number, v: number) => u + (v - u) * k;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) };
}

/**
 * CSS variables for a graphic following a tracked face or person (visual.follow): the tracked box
 * (--track-x, --track-y, --track-w, --track-h, fractions of the frame), the point beside it where the
 * graphic should attach (--follow-x, --follow-y) and --track-visible (0..1, fading at the track's ends
 * and while another clip is on screen).
 */
function followVars(
  follow: NonNullable<Visual["follow"]>,
  tracks: ReadonlyMap<string, readonly MotionTrack[]>,
  ctx: Parameters<typeof mapToFrame>[0],
  frame: number,
): Record<string, string> {
  const t = frame / ctx.fps;
  const track = tracks.get(follow.source)?.find((x) => x.id === follow.track);
  if (!track) return { "--track-visible": "0" };
  // The footage may be on screen as a cutaway (the topmost one showing it), or as the shot underneath,
  // unless another clip covers the whole frame.
  const shown = onScreenCutaways(ctx.visuals, frame);
  const cut = shown.find((v) => v.item.content.kind === "cutaway" && v.item.content.source === follow.source);
  const placed = sceneAt(ctx.tl, t);
  let st: number;
  let at: (box: Box) => Box | null;
  if (cut) {
    st = (cut.item.content as { in: number }).in + (frame - cut.from) / ctx.fps;
    at = (box) => mapInCutaway(ctx, cut, frame, box);
  } else if (
    placed &&
    placed.scene.source === follow.source &&
    !shown.some((v) => v.item.layout !== "split")
  ) {
    st = sourceTime(placed, t);
    at = (box) => mapToFrame(ctx, frame, box);
  } else return { "--track-visible": "0" };
  const edge = 0.15;
  const visible =
    st < track.start
      ? Math.max(0, 1 - (track.start - st) / edge)
      : st > track.end
        ? Math.max(0, 1 - (st - track.end) / edge)
        : 1;
  const b = at(trackBoxAt(track, st));
  if (!b) return { "--track-visible": "0" };
  const g = follow.gap;
  const [fx, fy] =
    follow.side === "below"
      ? [b.x, b.y + b.h / 2 + g]
      : follow.side === "above"
        ? [b.x, b.y - b.h / 2 - g]
        : follow.side === "left"
          ? [b.x - b.w / 2 - g, b.y]
          : follow.side === "right"
            ? [b.x + b.w / 2 + g, b.y]
            : [b.x, b.y];
  const n = (v: number) => v.toFixed(4);
  return {
    "--track-x": n(b.x),
    "--track-y": n(b.y),
    "--track-w": n(b.w),
    "--track-h": n(b.h),
    "--follow-x": n(fx),
    "--follow-y": n(fy),
    "--track-visible": n(follow.fade ? visible : visible > 0 ? 1 : 0),
  };
}

interface TransitionWindow {
  readonly css: string;
  /** The cut, in frames. */
  readonly cut: number;
  /** Frames of the change before and after the cut. */
  readonly before: number;
  readonly after: number;
}

/** Each shot that comes in with a transition: the window of frames around its cut. */
function transitionWindows(
  tl: Timeline,
  fps: number,
  files: ReadonlyMap<string, string>,
): Map<string, TransitionWindow> {
  const out = new Map<string, TransitionWindow>();
  tl.scenes.forEach((p, i) => {
    const tr = p.scene.transition;
    const prev = tl.scenes[i - 1];
    const css = tr && files.get(tr.kind);
    if (!tr || !prev || css === undefined) return;
    // Never longer than either shot.
    const frames = Math.max(
      2,
      Math.min(Math.round(tr.duration * fps), Math.round(Math.min(prev.duration, p.duration) * fps)),
    );
    out.set(p.scene.id, {
      css,
      cut: toFrame(p.start, fps),
      before: Math.floor(frames / 2),
      after: frames - Math.floor(frames / 2),
    });
  });
  return out;
}

function TransitionLayer({
  css,
  accent,
  targets,
}: {
  css: string;
  accent: string;
  targets: { out: RefObject<HTMLDivElement | null>; in: RefObject<HTMLDivElement | null> };
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <StyleLayer
      css={css}
      t={frame / fps}
      duration={durationInFrames / fps}
      accent={accent}
      targets={targets}
    />
  );
}

/**
 * A steadied shot: each frame moved to where the smooth camera path puts it (cancelling the shake),
 * zoomed to keep the frame filled. `at`: the clip second showing at a frame of the shot's sequence.
 */
function Steady({
  st,
  at,
  children,
}: {
  st: Steadied | undefined;
  at: (frame: number) => number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  if (!st) return <>{children}</>;
  const m = steadyAt(st, at(frame));
  // Moves are shares of the footage as shown; the zoom makes room for them.
  const tx = (m.x * st.shown.w).toFixed(2);
  const ty = (m.y * st.shown.h).toFixed(2);
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${st.zoom.toFixed(4)}) translate(${tx}px, ${ty}px) rotate(${m.a.toFixed(5)}rad) scale(${Math.exp(m.s).toFixed(5)})`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** Per-shot movement: the drift push-in and the jump-cut zoom, around the framing point. */
function ShotMotion({
  drift,
  zoom,
  framing,
  face,
  offset,
  length,
  camera,
  children,
}: {
  /** How far the push-in goes over the shot (0 for none). */
  drift: number;
  zoom: number;
  framing: Scene["framing"];
  face: Face | undefined;
  /** Frames this shot starts early (into a transition); the drift is timed to the shot itself. */
  offset: number;
  length: number;
  /** Keyframed camera moves on the shot (scene.camera). */
  camera?: readonly Keyframe[] | undefined;
  children: ReactNode;
}) {
  const frame = useCurrentFrame() - offset;
  const { fps, width, height } = useVideoConfig();
  const pose = camera?.length ? poseAt(camera, frame / fps) : null;
  const d = drift
    ? 1 + drift * interpolate(frame, [0, length], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) })
    : 1;
  const origin = `${(framing?.x ?? face?.x ?? 0.5) * 100}% ${(framing?.y ?? face?.y ?? 0.42) * 100}%`;
  return (
    <AbsoluteFill
      style={{
        transform: `${pose ? `${poseTransform(pose, width, height)} ` : ""}scale(${(zoom * d).toFixed(4)})`,
        transformOrigin: origin,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/**
 * Where a clip sits in the frame: scaled to cover it, then shifted toward the framing point (the same
 * maths as CSS object-position) and zoomed. Done by hand because video renders to a canvas, where
 * object-position doesn't exist.
 */
export function coverBox(
  frameW: number,
  frameH: number,
  source: Pick<Source, "width" | "height">,
  framing: Scene["framing"],
  focus?: Face,
): CSSProperties {
  if (!source.width || !source.height) return { width: "100%", height: "100%" };
  const scale = Math.max(frameW / source.width, frameH / source.height) * (framing?.scale ?? 1);
  const w = source.width * scale;
  const h = source.height * scale;
  // Without explicit framing, crop toward the face: centred across, about 40% down.
  const fit = (frame: number, size: number, at: number, target: number) =>
    frame === size ? 0.5 : Math.min(1, Math.max(0, (frame * target - at * size) / (frame - size)));
  const px = framing?.x ?? (focus ? fit(frameW, w, focus.x, 0.5) : 0.5);
  const py = framing?.y ?? (focus ? fit(frameH, h, focus.y, 0.4) : 0.5);
  return { position: "absolute", width: w, height: h, left: (frameW - w) * px, top: (frameH - h) * py };
}

function ClipMedia({
  speed = 1,
  mediaKey,
  source,
  focus,
  from,
  to,
  framing,
  volume,
  muted,
  mediaBase,
  quality,
  width,
  height,
  backdrop = true,
}: {
  source: Source;
  focus?: Face;
  from: number;
  to?: number;
  framing: Scene["framing"];
  volume: VolumeProp;
  muted: boolean;
  mediaBase: string;
  quality: "preview" | "export";
  width: number;
  height: number;
  speed?: number;
  mediaKey?: string;
  /** When the footage is fitted inside the frame: draw a blurred copy of it behind (not for cutouts). */
  backdrop?: boolean;
}) {
  const { fps } = useVideoConfig();
  const fitting = useContext(FitContext);
  const live = useContext(LivePreview);
  // The shot's correction and the grade, on the GPU (color.tsx); none when they'd change nothing.
  const effects = useColorEffects();
  const graded = effects ? { effects } : {};
  const fit = fitsInside(fitting.fit, source, { width, height });
  const b = fitting.backdrop;
  const style = fit
    ? fitBox(width, height, source, framing)
    : coverBox(width, height, source, framing, focus);
  const src = mediaKey
    ? `${mediaBase}${encodeURIComponent(mediaKey)}`
    : `${mediaBase}${encodeURIComponent(source.id)}${quality === "preview" && source.proxy ? "?proxy" : ""}`;
  // Fitted footage sits over a blurred, darkened copy of itself filling the frame.
  const behind =
    fit && backdrop ? (
      <AbsoluteFill
        style={{
          filter: `blur(${b.blur}px) brightness(${b.brightness}) saturate(${b.saturation})`,
          transform: `scale(${b.zoom})`,
        }}
      >
        {source.kind === "video" ? (
          <Video
            src={src}
            trimBefore={trimFrom(from, fps)}
            {...(to !== undefined && { trimAfter: trimTo(to, fps, from) })}
            playbackRate={speed}
            volume={0}
            muted
            objectFit="fill"
            style={coverBox(width, height, source, undefined)}
            {...graded}
          />
        ) : source.kind === "image" ? (
          <Img
            src={src}
            style={{ ...coverBox(width, height, source, undefined), objectFit: "fill" }}
            {...graded}
          />
        ) : null}
      </AbsoluteFill>
    ) : null;
  // A photo's cutout plays like a clip's (held still).
  if (source.kind === "video" || (source.kind === "image" && mediaKey)) {
    // In the live preview the picture and the sound play apart: the sound through <audio> (see Sound).
    const apart = live && source.hasAudio && !muted;
    return (
      <>
        {behind}
        <Video
          src={src}
          trimBefore={trimFrom(from, fps)}
          {...(to !== undefined && { trimAfter: trimTo(to, fps, from) })}
          playbackRate={speed}
          volume={apart ? 0 : volume}
          muted={apart || muted}
          objectFit={style.position ? "fill" : "cover"}
          style={style}
          {...graded}
        />
        {apart && (
          <Sound
            src={src}
            trimBefore={trimFrom(from, fps)}
            {...(to !== undefined && { trimAfter: trimTo(to, fps, from) })}
            {...(speed !== undefined && { playbackRate: speed })}
            volume={volume}
          />
        )}
      </>
    );
  }
  if (source.kind === "image")
    return (
      <>
        {behind}
        <Img src={src} style={{ ...style, objectFit: style.position ? "fill" : "cover" }} {...graded} />
      </>
    );
  if (source.kind === "solid") return <Placeholder color={source.color ?? "#333"} />;
  return <AbsoluteFill style={{ backgroundColor: "#000" }} />;
}

function SceneMedia({
  scene,
  face,
  follow,
  backdrop,
  source,
  mediaKey,
  mediaBase,
  quality,
  muted,
  volume,
}: {
  scene: Scene;
  /** The person's path through the shot, frame by frame from `offset` frames in, to follow them. */
  follow?: { readonly x: Float32Array; readonly y: Float32Array; readonly offset: number };
  backdrop?: boolean;
  /** Footage made from the clip (a cutout, a ramp) instead of the clip itself. */
  mediaKey?: string;
  face: Face | undefined;
  source: Source | undefined;
  mediaBase: string;
  quality: "preview" | "export";
  muted: boolean;
  volume: VolumeProp;
}) {
  const { width, height } = useVideoConfig();
  if (!source) return <Placeholder color="#3A1F1F" />;
  if (follow)
    return (
      <Following path={follow} size={face?.size ?? 0.3}>
        {(focus) => (
          <SceneMedia
            scene={scene}
            face={focus}
            {...(backdrop !== undefined && { backdrop })}
            source={source}
            {...(mediaKey && { mediaKey })}
            mediaBase={mediaBase}
            quality={quality}
            muted={muted}
            volume={volume}
          />
        )}
      </Following>
    );
  return (
    <ClipMedia
      source={source}
      from={scene.in}
      to={scene.out}
      framing={scene.framing}
      {...(backdrop !== undefined && { backdrop })}
      {...(face && { focus: face })}
      volume={volume}
      speed={scene.speed ?? 1}
      {...(mediaKey && { mediaKey })}
      muted={muted}
      mediaBase={mediaBase}
      quality={quality}
      width={width}
      height={height}
    />
  );
}

/** The person's place at this frame of a shot whose frame follows them. */
function Following({
  path,
  size,
  children,
}: {
  path: { readonly x: Float32Array; readonly y: Float32Array; readonly offset: number };
  size: number;
  children: (focus: Face) => ReactNode;
}) {
  const i = Math.max(0, Math.min(path.x.length - 1, useCurrentFrame() - path.offset));
  return <>{children({ x: path.x[i]!, y: path.y[i]!, size })}</>;
}

/** Footage fitted inside the frame, whole, centred (framing.scale still zooms it). */
function fitBox(
  frameW: number,
  frameH: number,
  source: Pick<Source, "width" | "height">,
  framing: Scene["framing"],
): CSSProperties {
  const scale = Math.min(frameW / source.width!, frameH / source.height!) * (framing?.scale ?? 1);
  const w = source.width! * scale;
  const h = source.height! * scale;
  return { position: "absolute", width: w, height: h, left: (frameW - w) / 2, top: (frameH - h) / 2 };
}

/** Stand-in for footage: a lit color field with a horizon, so the demo reads as a shot, not a slide. */
function Placeholder({ color }: { color: string }) {
  return (
    <AbsoluteFill style={{ backgroundColor: color }}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.35) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "58%",
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.18)",
        }}
      />
    </AbsoluteFill>
  );
}

// --- Visuals -------------------------------------------------------------------------------------

/** A deep, almost still backdrop with one soft pool of the accent: a keynote stage between slides. */
function Backdrop({ accent, color }: { accent: string; color?: string | undefined }) {
  if (color) return <AbsoluteFill style={{ backgroundColor: color }} />;
  return (
    <AbsoluteFill style={{ backgroundColor: "#060608" }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse 70% 45% at 50% 38%, ${accent}33 0%, transparent 70%)` }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 110%, rgba(255,255,255,0.05) 0%, transparent 70%)",
        }}
      />
    </AbsoluteFill>
  );
}

function VisualView({
  visual,
  exitSeconds,
  graphic,
  sources,
  mediaBase,
  quality,
  gradeCss,
  follow,
  vars,
  accent,
  font,
}: {
  visual: Visual;
  /** How long a cutaway fades out over at its end. */
  exitSeconds: number;
  graphic: Graphic | undefined;
  sources: ReadonlyMap<string, Source>;
  mediaBase: string;
  quality: "preview" | "export";
  gradeCss: string;
  /** For a graphic pinned to a tracked face or person: its variables at a local frame. */
  follow: ((frame: number) => Record<string, string>) | undefined;
  vars: Record<string, string> | undefined;
  accent: string;
  font: string;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const content = visual.content;
  const exitFrames = Math.round(exitSeconds * fps);
  const exit = exitFrames
    ? ramp(frame, durationInFrames - exitFrames, exitFrames, Easing.bezier(0.7, 0, 0.84, 0))
    : 0;
  const graded = useRef<HTMLDivElement>(null);
  const seconds = durationInFrames / fps;

  if (content.kind === "media")
    return (
      // A picture-in-picture box keeps its own colours, as it always has.
      <Ungraded>
        <MediaBox
          content={content}
          source={sources.get(content.source)}
          mediaBase={mediaBase}
          quality={quality}
          enterSeconds={visual.enter ?? 0.35}
        />
      </Ungraded>
    );

  const body =
    content.kind === "graphic" ? (
      <GraphicView
        graphic={graphic}
        params={content.params}
        duration={seconds}
        accent={accent}
        font={font}
        vars={follow ? { ...vars, ...follow(frame) } : vars}
        mediaBase={mediaBase}
        visual={visual.id}
      />
    ) : (
      (() => {
        const src = sources.get(content.source);
        if (!src) return <Placeholder color="#3A1F1F" />;
        // A hard cut in, then the shot settles: the camera move does the work, not an effect.
        const settle = settleScale(content.settle, frame);
        const h = visual.layout === "split" ? (visual.split?.ratio ?? 0.5) * height : height;
        return (
          <AbsoluteFill style={{ transform: `scale(${settle})` }}>
            {/* Cutaways get the same grade as the footage around them. */}
            <AbsoluteFill ref={graded}>
              <ClipMedia
                source={src}
                from={content.in}
                framing={content.framing}
                volume={content.volume ?? 0}
                muted={!content.volume}
                mediaBase={mediaBase}
                quality={quality}
                width={width}
                height={h}
              />
            </AbsoluteFill>
            <StyleLayer
              css={gradeCss}
              t={frame / fps}
              duration={durationInFrames / fps}
              accent={accent}
              targets={{ picture: graded }}
            />
          </AbsoluteFill>
        );
      })()
    );

  const enter = Math.max(1, Math.round((visual.enter ?? 0.4) * fps));
  if (visual.layout === "split") {
    // The panel wipes in from its edge while the speaker slides into the rest, on the same curve.
    const ratio = visual.split?.ratio ?? 0.5;
    const side = visual.split?.side ?? "top";
    const open = ramp(frame, 0, enter, EASE_IN_OUT);
    const close = ramp(frame, durationInFrames - enter, enter, EASE_IN_OUT);
    const covered = Math.min(100, 100 * (1 - open) + 100 * close);
    return (
      <AbsoluteFill
        style={{
          top: side === "top" ? 0 : (1 - ratio) * height,
          height: ratio * height,
          overflow: "hidden",
          clipPath: side === "top" ? `inset(0 0 ${covered}% 0)` : `inset(${covered}% 0 0 0)`,
        }}
      >
        {content.kind === "graphic" && <Backdrop accent={accent} color={visual.backdrop} />}
        {body}
      </AbsoluteFill>
    );
  }
  if (visual.layout === "full" || content.kind === "cutaway") {
    const fade = content.kind === "cutaway" ? 1 : ramp(frame, 0, enter, EASE_IN_OUT);
    return (
      <AbsoluteFill style={{ opacity: fade * (1 - (content.kind === "cutaway" ? exit : 0)) }}>
        {content.kind === "graphic" && <Backdrop accent={accent} color={visual.backdrop} />}
        {body}
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill>{body}</AbsoluteFill>;
}

/**
 * A reaction GIF, sticker, meme or clip in a box over the video, at its own shape: it pops in on a
 * spring, loops while it's on screen, and shrinks away at the end. A card has rounded corners, a thin
 * light border and a shadow; a sticker floats on a shadow of its own (see-through media).
 */
function MediaBox({
  content,
  source,
  mediaBase,
  quality,
  enterSeconds,
}: {
  content: Extract<VisualContent, { kind: "media" }>;
  source: Source | undefined;
  mediaBase: string;
  quality: "preview" | "export";
  enterSeconds: number;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { width, height } = useArea();
  if (!source) return <Placeholder color="#3A1F1F" />;
  const aspect = source.width && source.height ? source.width / source.height : 1;
  const w = content.box.width * width;
  const h = w / aspect;
  const enter = Math.max(1, Math.round(enterSeconds * fps));
  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 190 }, durationInFrames: enter * 2 });
  const out = ramp(frame, durationInFrames - Math.round(0.22 * fps), Math.round(0.22 * fps), EASE_IN_OUT);
  const scale = (0.55 + 0.45 * pop) * (1 - 0.35 * out);
  const style = content.style;
  const media = (
    <ClipMedia
      source={source}
      from={content.in}
      framing={undefined}
      volume={content.volume ?? 0}
      muted={!content.volume}
      mediaBase={mediaBase}
      quality={quality}
      width={w}
      height={h}
      backdrop={false}
    />
  );
  // A clip shorter than the visual plays again from its start (GIFs are a second or three).
  const clipFrames = Math.max(1, Math.round((source.duration - content.in) * fps));
  const looped =
    source.kind === "video" && content.loop && clipFrames < durationInFrames ? (
      <Loop durationInFrames={clipFrames}>{media}</Loop>
    ) : (
      media
    );
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: content.box.x * width - w / 2,
          top: content.box.y * height - h / 2,
          width: w,
          height: h,
          opacity: Math.min(1, pop * 1.4) * (1 - out),
          transform: `rotate(${content.rotate}deg) scale(${scale})`,
          overflow: style === "card" ? "hidden" : "visible",
          borderRadius: style === "card" ? Math.round(w * 0.05) : 0,
          ...(style === "card" && {
            boxShadow: "0 18px 48px rgba(0,0,0,0.45), 0 0 0 3px rgba(255,255,255,0.92)",
          }),
          ...(style === "sticker" && { filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.45))" }),
        }}
      >
        <AbsoluteFill>{looped}</AbsoluteFill>
      </div>
    </AbsoluteFill>
  );
}

/** A white flash as a cut accent: up in two frames, gone over the effect's length. */
// --- Text ----------------------------------------------------------------------------------------

/**
 * A title (overlays/titles.json), styled by its own fields. Titles animate in, except one that opens
 * the video without an explicit animation: frame 0 is the thumbnail, so it must be there.
 */
function TitleView({ title, animate, font }: { title: Title; animate: boolean; font: string }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { width } = useArea();
  const mode = title.animateIn ?? "rise";
  const run = animate || title.animateIn !== undefined;
  const t = run ? spring({ frame, fps, config: { damping: 20, stiffness: 200 } }) : 1;
  const out = title.animateOut ?? "none";
  const exitFrames = Math.round(fps * 0.35);
  const leave = out === "none" ? 0 : ramp(frame, durationInFrames - exitFrames, exitFrames, EASE_IN_OUT);
  const isHook = title.role === "hook";
  const align = title.align ?? "left";
  const left = title.position.x * width;
  const right =
    title.width !== undefined ? width - left - title.width * width : isHook ? width * 0.2 : width * 0.08;
  const typed =
    mode === "type" && run ? Math.round(title.text.length * Math.min(1, frame / (fps * 0.8))) : undefined;
  const opacity = (mode === "none" ? 1 : mode === "type" ? 1 : t) * (1 - leave);
  const transform = [
    mode === "rise" ? `translateY(${(1 - t) * 24}px)` : "",
    mode === "pop" ? `scale(${0.6 + 0.4 * t})` : "",
    out === "drop" ? `translateY(${leave * 40}px)` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      style={{
        position: "absolute",
        left: align === "center" && title.width === undefined ? width * 0.08 : left,
        right: align === "center" && title.width === undefined ? width * 0.08 : Math.max(0, right),
        top: `${title.position.y * 100}%`,
        textAlign: align,
        fontFamily: title.font ? `'${title.font.replace(/'/g, "")}', ${font}` : font,
        color: title.color ?? "#FFFFFF",
        fontSize: title.size,
        fontWeight: title.weight ?? 700,
        lineHeight: 1.12,
        letterSpacing: "-0.01em",
        ...(title.outline
          ? {
              WebkitTextStroke: `${Math.round(title.size * 0.08)}px rgba(0,0,0,0.85)`,
              paintOrder: "stroke fill",
            }
          : { textShadow: title.box ? "none" : "0 4px 0 rgba(0,0,0,0.55), 0 0 24px rgba(0,0,0,0.35)" }),
        opacity,
        ...(transform && { transform }),
        transformOrigin: align === "center" ? "center" : align === "right" ? "right center" : "left center",
      }}
    >
      <span
        style={
          title.box
            ? {
                background: title.box,
                padding: "0.12em 0.3em",
                borderRadius: "0.18em",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }
            : undefined
        }
      >
        {typed === undefined ? title.text : title.text.slice(0, typed)}
      </span>
    </div>
  );
}

const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

interface Line {
  readonly start: number;
  readonly words: readonly { text: string; at: number; emphasis: boolean }[];
}

/**
 * One caption page at a time. Manual captions (montage text) win over spoken ones while they show;
 * spoken pages come straight from the transcript, so karaoke timing is exact through every cut.
 */
function Captions({
  manual,
  pages,
  style,
  tl,
  faces,
  zooms,
  busy,
  echoes,
  splits,
  lookCss,
}: {
  manual: readonly Timed<Caption>[];
  pages: readonly CaptionPage[];
  style: CaptionStyle;
  tl: Timeline;
  faces: Faces;
  zooms: readonly Timed<Zoom>[];
  busy: readonly FrameSpan[];
  echoes: readonly Echo[];
  splits: readonly Timed<Visual>[];
  lookCss: string;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  let line: Line | null = null;
  const m = manual.find((c) => isActive(c, frame));
  if (m) {
    const parts = m.item.text.split(/\s+/).filter(Boolean);
    const step = (m.durationInFrames / fps / Math.max(parts.length, 1)) * 0.8;
    const emphasis = new Set(m.item.emphasis.map(clean));
    line = {
      start: m.from / fps,
      words: parts.map((text, i) => ({
        text,
        at: m.from / fps + i * step,
        emphasis: emphasis.has(clean(text)),
      })),
    };
  } else {
    const page = pageAt(pages, t);
    // A title or graphic already showing these words says them: don't caption them twice.
    if (
      page &&
      !(
        style.hideRepeats > 0 &&
        echoes.some((e) => isActive(e, frame) && repeats(page, e.words, style.hideRepeats))
      )
    )
      line = {
        start: page.start,
        words: page.words.map((w) => ({ text: w.text, at: w.start, emphasis: w.emphasis })),
      };
  }
  if (!line) return null;
  // In a split the speaker is in the other part: captions sit by the seam, off the speaker's face.
  const sp = splitState(splits, frame, fps);
  const seam = sp.amount > 0.5;
  const above =
    seam || style.place === "fixed" || !faces.size
      ? null
      : captionY(
          style.y,
          faceBand(faceAt(tl, faces, t), zooms, frame, fps, width / height),
          busyShot(tl, busy, t, fps),
        );
  // During a split: on the bottom edge of a panel on top (under the seam the speaker's head is right
  // there), or on the speaker's chest above a panel at the bottom (or captionStyle.splitY).
  const seamY = sp.side === "top" ? sp.ratio - 0.045 : 1 - sp.ratio - 0.07;
  const y = seam ? (style.splitY ?? seamY) : (above ?? style.y);
  // Above the head, a caption that wraps grows upward: its last line stays where one line would end.
  const lift = above === null ? "-50%" : `calc(-100% + ${(style.size * 1.15) / 2}px)`;
  return (
    <CaptionView
      css={lookCss}
      words={line.words}
      start={line.start}
      t={t}
      style={style}
      place={seam ? "seam" : above === null ? "usual" : "above"}
      box={{
        position: "absolute",
        // A wide frame has no app buttons down its right side: centred, with the wider margin each side.
        ...(width > height
          ? { left: width * style.wideMargin, right: width * style.wideMargin }
          : { left: width * style.marginLeft, right: width * style.marginRight }),
        top: `${y * 100}%`,
        transform: `translateY(${lift})`,
      }}
    />
  );
}

interface Echo extends FrameSpan {
  readonly words: ReadonlySet<string>;
}

const FILLER = new Set("a an the and or of to in on it is so that this".split(" "));

const wordSet = (text: string) => new Set(text.replace(/\*/g, "").split(/\s+/).map(clean).filter(Boolean));

/** Whether most of what a caption page says is already on screen. */
function repeats(page: CaptionPage, shown: ReadonlySet<string>, share: number): boolean {
  const words = page.words.map((w) => clean(w.text)).filter((w) => w && !FILLER.has(w));
  return words.length > 0 && words.filter((w) => shown.has(w)).length / words.length >= share;
}

/**
 * Whether anything holds the upper frame at some point during the current shot. Decided per shot, not
 * per frame, so captions keep one place through a shot instead of jumping when a graphic ends.
 */
function busyShot(tl: Timeline, busy: readonly FrameSpan[], t: number, fps: number): boolean {
  const placed = sceneAt(tl, t);
  if (!placed) return false;
  const from = toFrame(placed.start, fps);
  const to = toFrame(placed.start + placed.duration, fps);
  return busy.some((b) => b.from < to && b.from + b.durationInFrames > from);
}

const FALLBACK_LOOK = STARTER_CAPTION_LOOKS.find((l) => l.id === "outline");

type Faces = ReadonlyMap<string, Face>;

/** Without face detection, assume the upper middle of the frame. */
const DEFAULT_FACE: Face = { x: 0.5, y: 0.42, size: 0.3 };

function faceAt(tl: Timeline, faces: Faces, t: number): Face {
  const placed = sceneAt(tl, t);
  return (placed && faces.get(placed.scene.source)) || DEFAULT_FACE;
}

/** The speaker's face on screen (fractions of the frame height), after any punch-in. */
interface FaceBand {
  readonly x: number;
  readonly center: number;
  readonly top: number;
  readonly bottom: number;
  /** Where the hair or a cap reaches: about a face-height above the face's centre. */
  readonly head: number;
}

function faceBand(
  face: Face,
  zooms: readonly Timed<Zoom>[],
  frame: number,
  fps: number,
  aspect: number,
): FaceBand {
  const zoom = zooms.find((z) => isActive(z, frame));
  const scale = zoom ? zoomScale(zoom, frame, fps) : 1;
  const ox = zoom ? zoom.item.focus.x : face.x;
  const oy = zoom ? zoom.item.focus.y : face.y;
  const center = oy + (face.y - oy) * scale;
  const half = face.size * aspect * 0.75 * scale;
  return {
    x: ox + (face.x - ox) * scale,
    center,
    top: center - half,
    bottom: center + half,
    head: center - half * 2.2,
  };
}

const CAPTION_BAND = 0.06;

/**
 * Where captions go when their usual line would cover the speaker's face: above the head, or just under
 * a graphic holding the upper third. Null when the usual line is clear.
 */
function captionY(preferred: number, band: FaceBand | null, busy: boolean): number | null {
  if (!band) return null;
  if (preferred + CAPTION_BAND < band.top || preferred - CAPTION_BAND > band.bottom) return null;
  return Math.max(busy ? 0.4 : 0.26, band.head - CAPTION_BAND);
}

/**
 * The top of a clear slot for a short block of text (a name, a label) that keeps off the face and the
 * captions: under the chin when there's room above the caption line, otherwise above the head, high
 * enough that captions moved above the head still fit under it.
 */
function clearY(band: FaceBand): number {
  const slot = 0.12;
  if (band.bottom + 0.02 + slot <= 0.64) return band.bottom + 0.02;
  return Math.min(0.22, Math.max(0.1, band.head - slot - 0.02));
}

/** What a graphic knows about the frame it sits on, as CSS variables (see graphic.ts). */
function frameVars(band: FaceBand | null): Record<string, string> {
  if (!band) return {};
  const n = (v: number) => v.toFixed(3);
  return {
    "--face-x": n(band.x),
    "--face-top": n(band.top),
    "--face-bottom": n(band.bottom),
    "--clear-y": n(clearY(band)),
  };
}

function pageAt(pages: readonly CaptionPage[], t: number): CaptionPage | null {
  let lo = 0;
  let hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid]!;
    if (t < p.start) hi = mid - 1;
    else if (t >= p.end) lo = mid + 1;
    else return p;
  }
  return null;
}

// --- Sound ---------------------------------------------------------------------------------------

/** The music's credit line, small at the bottom of the last seconds (exportSettings.creditsInVideo). */
function MusicCredit({ text, font }: { text: string; font: string }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.06,
        right: width * 0.22,
        bottom: "4%",
        fontFamily: font,
        fontSize: 24,
        color: "rgba(255,255,255,0.75)",
        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
        opacity: ramp(frame, 0, Math.round(fps * 0.4), EASE_IN_OUT),
      }}
    >
      ♪ {text}
    </div>
  );
}

/** A sound effect: a built-in, or the sound of any clip in the project, with optional fades. */
function SoundEffect({ sfx, mediaBase, level }: { sfx: Timed<Sfx>; mediaBase: string; level: number }) {
  const { fps } = useVideoConfig();
  const s = sfx.item;
  const n = sfx.durationInFrames;
  const fade = Math.max(0, Math.min(n / 2, (s.fade ?? 0) * fps));
  const volume = (f: number) =>
    level * (fade > 0 ? s.volume * interpolate(f, [0, fade, n - fade, n], [0, 1, 1, 0], clamp) : s.volume);
  return s.source ? (
    <Sound
      src={`${mediaBase}${encodeURIComponent(s.source)}`}
      trimBefore={trimFrom(s.offset ?? 0, fps)}
      trimAfter={trimFrom(s.offset ?? 0, fps) + Math.max(1, n)}
      volume={volume}
    />
  ) : (
    <Sound src={`${mediaBase}sfx/${s.name}`} volume={volume} />
  );
}

/** How far music sits under speech at a frame: full away from it, ramping down to duckTo during it. */
function duckGain(speech: readonly FrameSpan[], f: number, duckTo: number, ramp: number): number {
  let nearest = Infinity;
  for (const s of speech) {
    if (isActive(s, f)) return duckTo;
    nearest = Math.min(nearest, Math.abs(s.from - f), Math.abs(s.from + s.durationInFrames - f));
  }
  return interpolate(nearest, [0, ramp], [duckTo, 1], { extrapolateRight: "clamp" });
}

/** More music placed in the cut (audio/music-clips.json): a song change, a needle drop, a sting. */
function MusicClipAudio({
  clip,
  speech,
  mediaBase,
  level,
  ramp,
}: {
  clip: Timed<MusicClip>;
  speech: readonly FrameSpan[];
  mediaBase: string;
  level: number;
  ramp: number;
}) {
  const { fps } = useVideoConfig();
  const m = clip.item;
  const n = clip.durationInFrames;
  const fi = Math.max(1, Math.min(n / 2, m.fadeIn * fps));
  const fo = Math.max(1, Math.min(n / 2, m.fadeOut * fps));
  return (
    <Sound
      src={`${mediaBase}${encodeURIComponent(m.source)}`}
      trimBefore={trimFrom(m.offset, fps)}
      loop={m.loop}
      volume={(f) =>
        level *
        m.volume *
        interpolate(f, [0, fi, n - fo, n], [0, 1, 1, 0], clamp) *
        (m.duckUnderSpeech && speech.length
          ? duckGain(speech, clip.from + f, 0.28, Math.max(1, Math.round(fps * ramp)))
          : 1)
      }
    />
  );
}

function Music({
  doc,
  speech,
  cues,
  mediaBase,
}: {
  doc: ProjectDoc;
  speech: readonly FrameSpan[];
  /** Volume changes over stretches of the cut (audio/music-cues.json). */
  cues: readonly Timed<MusicCue>[];
  mediaBase: string;
}) {
  const { fps, durationInFrames } = useVideoConfig();
  const { volume, duckUnderSpeech, offset, source, duckTo, fadeIn, fadeOut } = doc.music;
  const ramp = Math.max(1, Math.round(fps * doc.music.duckRamp));
  // Fade in over the first half second and out over the last second and a half, like an editor would.
  const fades = (f: number) =>
    interpolate(
      f,
      [0, Math.max(1, fps * fadeIn), durationInFrames - Math.max(1, fps * fadeOut), durationInFrames],
      [0, 1, 1, 0],
      clamp,
    );
  // Each cue eases from 1 to its volume over its fade, holds, and eases back; cues multiply.
  const cueGain = (f: number) => {
    let g = 1;
    for (const c of cues) {
      const fade = Math.max(1, c.item.fade * fps);
      const end = c.from + c.durationInFrames;
      if (f < c.from - fade || f > end + fade) continue;
      const k = interpolate(f, [c.from - fade, c.from, end, end + fade], [0, 1, 1, 0], clamp);
      g *= 1 + (c.item.volume - 1) * k;
    }
    return g;
  };
  const ducked = (f: number) => {
    if (!duckUnderSpeech || !speech.length) return volume;
    // Distance (in frames) to the nearest speech, so the duck ramps instead of clicking.
    let nearest = Infinity;
    for (const s of speech) {
      if (isActive(s, f)) return volume * duckTo;
      nearest = Math.min(nearest, Math.abs(s.from - f), Math.abs(s.from + s.durationInFrames - f));
    }
    return interpolate(nearest, [0, ramp], [volume * duckTo, volume], { extrapolateRight: "clamp" });
  };
  // The part of the track in use (music.section), looped to fill the video when music.loop is on.
  const section = doc.music.section;
  return (
    <Sound
      src={`${mediaBase}${encodeURIComponent(source!)}`}
      trimBefore={trimFrom(section ? section.start : offset, fps)}
      {...(section && section.end > section.start && { trimAfter: trimTo(section.end, fps, section.start) })}
      loop={doc.music.loop}
      volume={(f) => doc.mix.musicLevel * ducked(f) * fades(f) * cueGain(f)}
    />
  );
}
