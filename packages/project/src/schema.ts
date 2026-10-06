/**
 * The project folder, as types. Every file in a project folder has a schema here, and the whole folder
 * loads into one immutable `ProjectDoc`. The video is a pure function of this document: nothing about
 * the edit lives anywhere else.
 *
 * Time model: scenes play back to back, so a scene's place on the timeline is derived from the order of
 * `scenes`, never stored. Everything else that happens "at a moment" (zooms, captions, titles, sound
 * effects, comments) is anchored to a scene plus an offset into it. Trim or reorder a scene and its
 * zooms and captions move with it, which is what an editor means by "the zoom on the laugh".
 *
 * Speech: indexing transcribes every clip into `transcripts` (word timings in source time). Spoken
 * captions are derived from those words and the cut, so they can never drift out of sync with an edit.
 * `wordEdits` holds corrections and emphasis per word, addressed as "<source id>:<word index>".
 */

import { z } from "zod";
import { EASES } from "./motion.ts";
import { SHAPES } from "./reframe.ts";

export const Id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "ids are 1-64 chars of letters, digits, _ or -")
  .describe("Stable id, unique within its collection");

const Seconds = z.number().nonnegative().describe("Seconds");
const Unit = z.number().min(0).max(1);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colors are #rrggbb");

export const Point = z.object({ x: Unit, y: Unit }).describe("Position on the frame, 0..1 from top-left");
export type Point = z.infer<typeof Point>;

export const Anchor = z
  .object({
    scene: Id.describe("Scene id this moment belongs to"),
    at: Seconds.describe("Offset into that scene, in seconds of output time"),
  })
  .describe("A moment in the video, pinned to a scene so it survives trims and reorders");
export type Anchor = z.infer<typeof Anchor>;

export const Format = z.object({
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: z.number().int().min(1).max(120),
});
export type Format = z.infer<typeof Format>;

/** project.json */
export const Meta = z.object({
  schema: z.literal(1),
  id: Id,
  name: z.string().min(1).max(200),
  format: Format,
  createdAt: z.string(),
  kit: Id.optional().describe("The brand kit this project uses: what it learns goes into the kit too"),
  inspiration: Id.optional().describe(
    "The inspiration this edit follows (inspirations/<id>.md): its recipe for structure, pacing and style",
  ),
  starters: z
    .number()
    .int()
    .optional()
    .describe(
      "Which built-in files (effects, graphics...) the project has been given; newer ones are added once",
    ),
});
export type Meta = z.infer<typeof Meta>;

export const SourceKind = z.enum(["video", "image", "audio", "solid"]);

/** sources/index.json: written by import and indexing, read-only to the agent. */
export const Source = z.object({
  id: Id,
  kind: SourceKind,
  label: z.string().max(200),
  path: z.string().optional().describe("Absolute path on disk; absent for solid color sources"),
  color: Color.optional().describe("Fill for solid sources, and the swatch for everything else"),
  duration: Seconds.describe("Length in seconds (0 for stills, which can be held for any length)"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  hdr: z.boolean().default(false),
  hasAudio: z.boolean().default(false),
  status: z
    .enum(["pending", "indexing", "ready", "failed"])
    .default("ready")
    .describe("Indexing state: transcripts and analysis exist once ready"),
  error: z.string().max(500).optional(),
  proxy: z.boolean().default(false).describe("A lightweight preview copy exists"),
  speech: z.boolean().default(false).describe("Someone talks in this clip"),
  summary: z.string().max(500).default("").describe("What happens in the clip, in a sentence"),
  tags: z.array(z.string()).default([]).describe("What is in the shot, from indexing"),
  origin: z
    .object({
      url: z.string().max(2000),
      provider: z.string().max(40).describe('"pexels", "pixabay", or "web" for a page capture'),
      license: z.string().max(200).default(""),
      author: z.string().max(200).default(""),
    })
    .optional()
    .describe("Where a file the agent fetched came from, for credits"),
});
export type Source = z.infer<typeof Source>;

/** Reframing for one shot: what part of the source fills the frame. */
export const Framing = z.object({
  x: Unit.default(0.5).describe("Horizontal center of interest in the source, 0..1"),
  y: Unit.default(0.5).describe("Vertical center of interest in the source, 0..1"),
  scale: z.number().min(1).max(4).default(1).describe("Extra zoom on top of filling the frame"),
});
export type Framing = z.infer<typeof Framing>;

/** One pose in keyframed motion; unset properties hold from the keyframe before. */
export const Keyframe = z.object({
  at: Seconds.describe("Seconds from the start of the item (or shot)"),
  x: z.number().min(-2).max(2).optional().describe("Moved right (+) or left, as a share of the frame width"),
  y: z.number().min(-2).max(2).optional().describe("Moved down (+) or up, as a share of the frame height"),
  scale: z.number().min(0.05).max(10).optional(),
  rotate: z.number().min(-720).max(720).optional().describe("Degrees"),
  opacity: z.number().min(0).max(1).optional(),
  ease: z
    .enum(EASES)
    .optional()
    .meta({ default: "inOut" })
    .describe("How it eases into this pose from the one before: linear, in, out, inOut, expoOut, back, hold"),
});
export type Keyframe = z.infer<typeof Keyframe>;

/** The person's look on a shot or a cover: outline, glow, shadow. */
const SubjectLook = z.object({
  outline: z
    .object({
      color: Color.default("#FFFFFF"),
      width: z.number().min(1).max(60).default(12).describe("Pixels"),
    })
    .optional()
    .describe("A solid outline around the person, the sticker look"),
  glow: z
    .object({
      color: Color.optional().describe("Unset: the accent"),
      size: z.number().min(2).max(200).default(48).describe("Pixels"),
      strength: z.number().min(0).max(1).default(0.8),
    })
    .optional()
    .describe("A soft glow of colour around the person"),
  shadow: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("A soft drop shadow under the person, lifting them off the background: how dark"),
});

/** timeline/scenes.json: the cut. Order is playback order. */
export const Scene = z
  .object({
    id: Id,
    source: Id,
    in: Seconds.describe("Start inside the source"),
    out: Seconds.describe("End inside the source; out - in is the scene length"),
    note: z.string().max(300).default("").describe("One sentence on what happens, shown on the story card"),
    volume: z.number().min(0).max(2).default(1).describe("Level of the clip's own sound"),
    speed: z
      .number()
      .min(0.25)
      .max(4)
      .optional()
      // Shown as the value when unset, without being written into the files.
      .meta({ default: 1 })
      .describe("Playback speed, 1 when unset: 0.5 is slow motion, 2 is double speed; the voice follows"),
    framing: Framing.optional().describe("How a landscape or off-center shot is cropped into the frame"),
    audioLead: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .meta({ default: 0 })
      .describe("J-cut: seconds of this shot's sound heard before its picture, over the shot before"),
    audioTail: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .meta({ default: 0 })
      .describe("L-cut: seconds this shot's sound keeps playing over the next shot"),
    adjust: z
      .object({
        brightness: z.number().min(0).max(3).default(1),
        contrast: z.number().min(0).max(3).default(1),
        saturation: z.number().min(0).max(3).default(1),
        warmth: z
          .number()
          .min(-1)
          .max(1)
          .default(0)
          .describe(
            "White balance: -1 cool/blue to 1 warm/orange. A clip measured warm (orange cast) wants about -0.4",
          ),
        tint: z.number().min(-1).max(1).default(0).describe("-1 green to 1 magenta"),
        blur: z.number().min(0).max(40).default(0).describe("Pixels"),
      })
      .optional()
      .describe("Colour and exposure for this shot only, on top of the grade: to match shots or fix one"),
    flip: z.boolean().optional().meta({ default: false }).describe("Mirror the shot left to right"),
    crossfade: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Crossfade of the sound into this shot from the one before, seconds; unset uses mix.cutFade. Longer (about 0.12) hides a cut in continuous speech",
      ),
    ramp: z
      .array(
        z.object({
          at: Seconds.describe("Seconds into the shot's footage, from its in point"),
          speed: z.number().min(0.1).max(8),
        }),
      )
      .min(2)
      .max(16)
      .optional()
      .describe(
        "A speed ramp, the velocity edit: speeds through the shot's footage, eased between (1 to 0.3 on the hit, then 2). Overrides speed; the shot's own sound is dropped",
      ),
    camera: z
      .array(Keyframe)
      .max(32)
      .optional()
      .describe(
        "Keyframed camera moves on this shot, on top of drift and zooms: position, scale and rotation over time",
      ),
    background: z
      .object({
        kind: z
          .enum(["blur", "dim", "color", "clip", "mono"])
          .describe("mono is the colour pop: the background in black and white, the person in colour"),
        amount: z
          .number()
          .min(0)
          .max(80)
          .optional()
          .describe(
            "Blur in pixels (default 18); for dim how dark, 0 to 1 (default 0.55); for mono how grey, 0 to 1 (default 1)",
          ),
        color: Color.optional().describe("For color"),
        source: Id.optional().meta({ ref: "sources" }).describe("For clip: what plays behind the person"),
        in: Seconds.optional().describe("For clip: where in it to start"),
      })
      .optional()
      .describe(
        "Change what's behind the person: blur it, dim it, or replace it with a colour or another clip. The person is cut out automatically",
      ),
    subject: SubjectLook.extend({
      from: Seconds.optional().describe("Seconds into the shot it comes on (eased in); unset from the start"),
      to: Seconds.optional().describe("Seconds into the shot it goes off; unset to the end"),
    })
      .optional()
      .describe("Style the person in this shot: outline, glow, shadow. The person is cut out automatically"),
    jumpZoom: z
      .boolean()
      .optional()
      .meta({ default: true })
      .describe("false: no automatic jump-cut zoom on this shot"),
    transition: z
      .object({
        kind: Id.describe("transitions/<kind>.css"),
        duration: z.number().min(0.1).max(2).default(0.4),
      })
      .optional()
      .describe("How this shot comes in from the one before it; a hard cut when unset"),
  })
  .refine((s) => s.out > s.in, { message: "out must be greater than in", path: ["out"] });
export type Scene = z.infer<typeof Scene>;

/** motion/zooms.json */
export const Zoom = z.object({
  id: Id,
  anchor: Anchor,
  duration: z.number().positive().max(30),
  scale: z.number().min(1).max(4).describe("1.15 is a gentle push, 1.6 is a punch-in"),
  focus: Point.describe("What to zoom toward"),
  ease: z.enum(["smooth", "punch"]).default("smooth"),
  curve: z
    .string()
    .regex(
      /^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/,
      'four numbers, like "0.16, 1, 0.3, 1"',
    )
    .optional()
    .describe("A cubic-bezier for the move in and out (overrides ease), like a CSS timing function"),
  edge: z
    .number()
    .min(0.05)
    .max(5)
    .optional()
    .meta({ default: 0.35 })
    .describe("Seconds to move in and out, 0.35 when unset"),
});
export type Zoom = z.infer<typeof Zoom>;

export const TimedWord = z.object({
  text: z.string(),
  start: Seconds.describe("Start in source time"),
  end: Seconds.describe("End in source time"),
  stress: Unit.optional().describe(
    "How hard it's said, 0..1, ranked within the clip: 0.85 and up is its most emphatic sixth (louder, higher or drawn out than the words around it; heard at indexing)",
  ),
});
export type TimedWord = z.infer<typeof TimedWord>;

/** sources/transcripts.json: what was said in each clip, word by word. Written by indexing. */
export const Transcript = z.object({
  id: Id.describe("The source id this transcript belongs to"),
  language: z.string().default("en"),
  words: z.array(TimedWord),
  aligned: z
    .number()
    .int()
    .optional()
    .describe(
      "Which word-timing correction has run on it (2: starts moved to where the voice really begins; 3: ends moved to where it fades; 4: times from the aligned transcription)",
    ),
});
export type Transcript = z.infer<typeof Transcript>;

/** One stretch of picture as a vision model saw it: the visual counterpart of a transcribed sentence. */
export const ShotSegment = z.object({
  start: Seconds,
  end: Seconds,
  what: z.string().max(300).describe("What's on screen and what happens"),
  shot: z.enum(["wide", "medium", "close", "detail", "aerial", "screen", "graphic"]).default("medium"),
  camera: z.enum(["static", "pan", "tilt", "zoom", "handheld", "tracking"]).default("static"),
  energy: z.number().int().min(1).max(5).default(2).describe("1 calm, 5 explosive"),
  quality: z.array(z.enum(["blurry", "shaky", "dark", "overexposed", "obstructed"])).default([]),
  highlight: z.boolean().default(false).describe("A standout shot worth building around"),
  tags: z.array(z.string().max(30)).max(8).default([]),
});
export type ShotSegment = z.infer<typeof ShotSegment>;

/** sources/shots.json: what each clip shows, segment by segment. Written by indexing. */
export const ShotLog = z.object({
  id: Id.describe("The source id this log belongs to"),
  segments: z.array(ShotSegment),
  /** Loud stretches with no speech: crowds, applause, engines, music. [start, end] in source seconds. */
  loud: z.array(z.tuple([Seconds, Seconds])).default([]),
});
export type ShotLog = z.infer<typeof ShotLog>;

/** sources/analysis.json: what indexing measured in each clip. */
/** One tracked face or person: where it is over time, in source time and fractions of the frame. */
export const MotionTrack = z.object({
  id: z.string().max(40),
  kind: z.enum(["face", "person"]),
  start: Seconds,
  end: Seconds,
  points: z.array(
    z.object({ t: Seconds, x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0) }),
  ),
});
export type MotionTrack = z.infer<typeof MotionTrack>;

export const Analysis = z.object({
  id: Id.describe("The source id this analysis belongs to"),
  silences: z
    .array(z.tuple([Seconds, Seconds]))
    .default([])
    .describe("Quiet stretches, [start, end] in source time"),
  shots: z.array(Seconds).default([]).describe("Times where the picture changes shot"),
  bpm: z.number().optional(),
  beats: z.array(Seconds).optional().describe("Beat times, for music"),
  downbeats: z.array(Seconds).optional(),
  start: Seconds.optional().describe("Where a music track gets going"),
  drop: Seconds.optional().describe("A music track's biggest lift"),
  loudness: z.number().optional().describe("Integrated loudness, LUFS"),
  face: z
    .object({ x: Unit, y: Unit, size: Unit })
    .optional()
    .describe("Where the speaker's face usually is: centre and width, 0..1 of the frame"),
  tracks: z.array(MotionTrack).optional().describe("Faces and people tracked over stretches of the clip"),
  cutouts: z
    .array(
      z.object({
        from: Seconds,
        to: Seconds,
        blurs: z.array(z.number()).optional().describe("Background blur plates made for it, by blur amount"),
      }),
    )
    .optional()
    .describe("Stretches of the clip with the person cut out from the background, in its own time"),
  sounds: z
    .array(
      z.object({
        start: Seconds,
        end: Seconds,
        label: z.string().max(40).describe("laughter, applause, cheering, crowd, gasp, music, whispering..."),
        confidence: Unit,
      }),
    )
    .optional()
    .describe("Sounds heard in the clip, in its own time (from on-device sound recognition)"),
  instruments: z
    .array(z.object({ name: z.string().max(40), share: Unit.describe("Share of the track it's heard in") }))
    .optional()
    .describe("A music track's instruments, most present first"),
  voice: z
    .object({
      bands: z.array(z.number()).length(5),
      noiseFloor: z.number(),
    })
    .optional()
    .describe(
      "The voice's tonal balance: low end, body, clarity, presence and air, dB against the body band; and the room's noise floor",
    ),
  picture: z
    .object({ brightness: Unit, warmth: z.number(), tint: z.number() })
    .optional()
    .describe("The picture's average brightness and colour cast (warmth > 6 is warm, < -6 cool)"),
});
export type Analysis = z.infer<typeof Analysis>;

/** captions/captions.json: corrections and emphasis for spoken words. */
export const WordEdit = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}:\d+$/, 'word ids are "<source id>:<word index>"')
    .describe('"<source id>:<word index>"'),
  text: z.string().max(80).optional().describe("Replacement text for a misheard word"),
  emphasis: z.boolean().optional().describe("Color this word with the accent"),
  hidden: z.boolean().optional().describe("Keep the audio but leave the word out of captions"),
});
export type WordEdit = z.infer<typeof WordEdit>;

/** captions/captions.json: manual text segments, for footage with no speech. */
export const Caption = z.object({
  id: Id,
  anchor: Anchor,
  duration: z.number().positive().max(30),
  text: z.string().max(500),
  emphasis: z.array(z.string()).default([]).describe("Words to color with the accent"),
});
export type Caption = z.infer<typeof Caption>;

/** captions/captions.json: style */
export const CaptionStyle = z.object({
  speech: z.boolean().default(true).describe("Caption what is said, from the transcripts"),
  preset: z.enum(["karaoke", "pop", "plain"]).default("karaoke"),
  y: Unit.default(0.74).describe("Vertical center of the caption block"),
  place: z
    .enum(["auto", "fixed"])
    .default("auto")
    .describe(
      "auto keeps captions off the speaker's face, moving above it when the face is low; fixed always uses y",
    ),
  size: z.number().min(16).max(160).default(64),
  color: Color.default("#FFFFFF"),
  accent: Color.default("#F5A524"),
  uppercase: z.boolean().default(false),
  maxWords: z.number().int().min(1).max(12).default(4).describe("Words per caption page"),
  marginLeft: z
    .number()
    .min(0)
    .max(0.4)
    .default(0.07)
    .describe("Space left of the caption box, share of the width"),
  marginRight: z
    .number()
    .min(0)
    .max(0.4)
    .default(0.2)
    .describe("Space right of it (0.2 keeps clear of app buttons)"),
  wideMargin: z
    .number()
    .min(0)
    .max(0.4)
    .default(0.18)
    .describe(
      "In a landscape frame (16:9, no app buttons down the side): space each side of the caption box, which is centred",
    ),
  splitY: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Caption line during a split; unset sits on the panel's edge by the seam, off the speaker's head",
    ),
  pauseBreak: z
    .number()
    .min(0)
    .max(3)
    .default(0.45)
    .describe("Start a new page after a pause this long, in seconds; 0 never breaks on pauses"),
  maxPageSeconds: z.number().min(0.5).max(10).default(2.4).describe("Longest a page stays up"),
  sentenceBreak: z.boolean().default(true).describe("Always start a new page after a sentence ends"),
  minWords: z
    .number()
    .int()
    .min(1)
    .max(6)
    .default(1)
    .describe(
      "Pages shorter than this join their neighbour in the same sentence, so lines don't come in scraps",
    ),
  hideRepeats: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .describe("Hide a caption when a title or graphic already shows this share of its words; 0 never hides"),
  look: Id.default("outline").describe("The caption look: captions/looks/<look>.css"),
  font: z.string().max(80).default("").describe("A font family for the captions; empty uses the look's own"),
});
export type CaptionStyle = z.infer<typeof CaptionStyle>;

/** fonts/<file>: a font file the user dropped into the project; family and weight come from its name. */
export const FontFile = z.object({
  id: Id,
  file: z.string().regex(/^[^/\\]+\.(woff2|woff|ttf|otf)$/i, "a .woff2, .woff, .ttf or .otf file name"),
  family: z.string().min(1).max(80),
  weight: z.number().int().min(100).max(900).default(400),
  style: z.enum(["normal", "italic"]).default("normal"),
});
export type FontFile = z.infer<typeof FontFile>;

/**
 * effects/<id>.css, transitions/<id>.css, grades/<id>.css: how an effect, a transition between shots
 * and a colour grade look, as CSS (see styles.ts in this package for the hooks).
 */
export const StyleFile = z.object({
  id: Id,
  css: z.string().max(60_000),
});
export type StyleFile = z.infer<typeof StyleFile>;

/** captions/looks/<id>.css: how captions look (typography, fill, glow, per-word motion), as CSS. */
export const CaptionLook = z.object({
  id: Id,
  css: z.string().max(60_000),
});
export type CaptionLook = z.infer<typeof CaptionLook>;

/**
 * inspirations/<id>.md: an editing style to follow, the way an editor is told "cut it like this". A
 * brief in markdown (structure, pacing, captions, motion, sound, look) under a JSON header with the
 * settings it applies and the files it brings. See inspiration.ts.
 */
export const Inspiration = z.object({
  id: Id,
  md: z.string().max(40_000),
});
export type Inspiration = z.infer<typeof Inspiration>;

/** overlays/titles.json */
export const Title = z.object({
  id: Id,
  role: z.enum(["hook", "title", "label"]).describe("hook = the opening line that stops the scroll"),
  anchor: Anchor,
  behindSubject: z
    .boolean()
    .optional()
    .meta({ default: false })
    .describe(
      "Draw it behind the person in the shot, like text behind the subject. The person is cut out automatically",
    ),
  keyframes: z
    .array(Keyframe)
    .max(32)
    .optional()
    .describe(
      "Keyframed motion on top of its own animation: position, scale, rotation and opacity over time",
    ),
  duration: z.number().positive().max(60),
  text: z.string().max(300),
  position: Point.default({ x: 0.08, y: 0.12 }),
  size: z.number().min(16).max(200).default(84),
  font: z.string().max(80).optional().describe("A font family; unset uses the house font"),
  color: Color.optional().meta({ default: "#FFFFFF" }),
  weight: z.number().int().min(100).max(900).optional().meta({ default: 700 }),
  align: z.enum(["left", "center", "right"]).optional().meta({ default: "left" }),
  width: z.number().min(0.2).max(1).optional().describe("Share of the frame width the text may use"),
  box: Color.optional().describe("A solid box behind the text, in this colour"),
  outline: z.boolean().optional().meta({ default: false }).describe("A dark outline instead of a shadow"),
  animateIn: z.enum(["rise", "fade", "pop", "type", "none"]).optional().meta({ default: "rise" }),
  animateOut: z.enum(["none", "fade", "drop"]).optional().meta({ default: "none" }),
});
export type Title = z.infer<typeof Title>;

/** audio/music.json */
export const Music = z.object({
  source: Id.nullable().default(null).describe("An imported audio clip, or null for no music"),
  label: z.string().default(""),
  credit: z.string().max(300).default("").describe("Attribution line for licensed tracks"),
  volume: z.number().min(0).max(1).default(0.22),
  duckUnderSpeech: z.boolean().default(true),
  offset: Seconds.default(0).describe("Where in the track playback starts (when no section is set)"),
  section: z
    .object({ start: Seconds, end: Seconds })
    .nullable()
    .default(null)
    .describe(
      "The part of the track to use: it plays from start, and with loop on, start to end repeats for as long as the video runs. Null: from offset, the whole track",
    ),
  loop: z
    .boolean()
    .default(true)
    .describe(
      "Repeat the section (or the whole track) when the video runs longer; off, the music stops at its end",
    ),
  fitted: z
    .number()
    .optional()
    .describe(
      "The video length (s) fit_music fitted the section to; the agent refits it when the cut's length changes",
    ),
  lockToBeat: z
    .boolean()
    .default(true)
    .describe(
      "Snap the start and end of graphics, titles, zooms, effects and sound effects to the music's beat when they fall within a few frames of one",
    ),
  duckTo: z.number().min(0).max(1).default(0.28).describe("Share of the volume kept under speech"),
  fadeIn: Seconds.max(10).default(0.5),
  fadeOut: Seconds.max(10).default(1.5),
  duckRamp: Seconds.max(3).default(0.25).describe("How quickly the music dips and recovers around speech"),
});
export type Music = z.infer<typeof Music>;

/** audio/mix.json: how the sound is finished. */
export const Mix = z.object({
  voiceEnhance: z
    .boolean()
    .default(true)
    .describe("EQ and compression that make phone mics sound close and clear"),
  denoise: z.boolean().default(true).describe("Reduce steady background noise under the voice"),
  voiceClean: z
    .enum(["off", "light", "medium", "strong"])
    .default("medium")
    .describe(
      "Neural clean-up (DeepFilterNet) that removes room echo and noise a denoiser can't: light keeps some room, strong takes it all",
    ),
  voiceTone: z
    .enum(["natural", "warm", "bright", "flat"])
    .default("natural")
    .describe("Character on top of the clean-up: warm adds body, bright adds presence and air"),
  voiceMatch: z
    .boolean()
    .default(true)
    .describe(
      "EQ each clip's voice toward broadcast balance, from its measured profile, so a boomy phone room and a thin one end up sounding alike",
    ),
  loudness: z
    .number()
    .min(-30)
    .max(-8)
    .default(-14)
    .describe("Target loudness in LUFS (-14 social, -16 YouTube/podcasts)"),
  truePeak: z.number().min(-6).max(0).default(-1.5),
  stereo: z.boolean().default(false).describe("Keep the clips' stereo sound instead of a centred voice"),
  musicLevel: z
    .number()
    .min(0)
    .max(3)
    .default(1)
    .describe("Overall level of all music, on top of each track's volume"),
  sfxLevel: z.number().min(0).max(3).default(1).describe("Overall level of all sound effects"),
  entrySounds: z.boolean().default(true).describe("Visuals make their default entry sound"),
  jlFade: Seconds.max(2).default(0.2).describe("Crossfade at a J- or L-cut"),
  roomTone: z
    .number()
    .min(0)
    .max(1)
    .default(0.3)
    .describe(
      "Room tone: the room's own quiet sound (its quietest stretch, looped) under the whole voice at export, so cuts and gaps never drop to dead silence or step in background noise; 0 for none, 1 at its natural level",
    ),
  pauses: z
    .object({
      sentence: Seconds.max(2).default(0.42).describe("After a sentence ends"),
      phrase: Seconds.max(2).default(0.24).describe("After a comma or a clause"),
      word: Seconds.max(2).default(0.14).describe("Mid-phrase"),
    })
    .default({ sentence: 0.42, phrase: 0.24, word: 0.14 })
    .describe(
      "The silence a cut leaves where it removes a pause, by what comes before it: natural speech breathes longer after a sentence than mid-phrase",
    ),
  speechFade: Seconds.max(0.5)
    .default(0.12)
    .describe(
      "The crossfade clean_cuts gives a cut that still lands while the voice is sounding (no breath to cut on), so it blends instead of chopping; 0 leaves those at cutFade",
    ),
  cutFade: Seconds.max(0.5)
    .default(0.05)
    .describe(
      "A short crossfade on the sound at every hard cut, so no cut clicks or chops a voice mid-sound (a couple of frames is the editor's standard); 0 for none",
    ),
});
export type Mix = z.infer<typeof Mix>;

/** export.json: what Export writes. */
export const ExportSettings = z.object({
  codec: z
    .enum(["h264", "h265", "prores"])
    .default("h264")
    .describe("prores writes a .mov for further editing"),
  quality: z.enum(["high", "standard", "small"]).default("standard"),
  audioBitrate: z.enum(["128k", "192k", "320k"]).default("192k"),
  fileName: z.string().max(120).default("").describe("Empty: the project name and the date"),
  creditsInVideo: z.boolean().default(false).describe("Burn the music credit into the last seconds"),
  formats: z
    .array(z.enum(SHAPES))
    .default([])
    .describe(
      "More shapes to export alongside the project's own, each reframed on the person: 9:16, 4:5, 1:1, 16:9",
    ),
  cover: z.boolean().default(true).describe("Also save the cover image (covers/cover.json), in every shape"),
});
export type ExportSettings = z.infer<typeof ExportSettings>;

/** checks.json: what the quality checks hold the edit to. */
export const CheckRules = z.object({
  platform: z
    .enum(["tiktok", "reels", "shorts", "youtube", "none"])
    .default("tiktok")
    .describe("Whose app buttons and captions to keep clear of"),
  minShot: Seconds.max(10).default(0.4),
  maxShot: Seconds.max(120).default(4),
  hookWithin: Seconds.max(30).default(2),
  pace: Seconds.max(120).default(8).describe("Something should change on screen at least this often"),
  deadAir: Seconds.max(10).default(1.2),
  beatTolerance: Seconds.max(0.5).default(0.06),
  sfxGap: Seconds.max(10)
    .default(2.5)
    .describe("Sound effects (graphic entry sounds included) closer together than this read as clutter"),
  sfxRepeat: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3)
    .describe("The most times one sound effect may be used"),
  faceHeight: Unit.default(0.42).describe(
    "Where the speaker's face should sit, from the top (0..1); more empty space above it gets flagged",
  ),
  maxReframe: z.number().min(1).max(2).default(1.35).describe("The most a headroom fix zooms in"),
  maxCast: z
    .number()
    .min(0)
    .max(40)
    .default(10)
    .describe("Colour cast (measured warmth) above which uncorrected footage gets flagged"),
  castCorrection: z
    .object({
      neutral: z
        .number()
        .min(0)
        .max(20)
        .default(4)
        .describe("Measured warmth this close to 0 needs no correction"),
      strength: z
        .number()
        .min(0)
        .max(0.2)
        .default(0.04)
        .describe("adjust.warmth per unit of measured cast beyond neutral"),
      max: z.number().min(0).max(1).default(0.6).describe("The strongest correction"),
      enough: z
        .number()
        .min(0)
        .max(1)
        .default(0.75)
        .describe("Share of the correction a shot needs to count as corrected"),
    })
    .default({ neutral: 4, strength: 0.04, max: 0.6, enough: 0.75 })
    .describe("How a measured colour cast is corrected (the fix, and what the agent is told for each clip)"),
  safeZone: z
    .object({ top: Unit, bottom: Unit, right: Unit })
    .optional()
    .describe("The clear area of the frame (shares), instead of the platform's: top, bottom and right edges"),
  motion: z
    .object({
      flicker: z
        .number()
        .min(0)
        .max(0.2)
        .default(0.01)
        .describe("Change in one frame (share of the frame) that counts as a flicker"),
      pop: z
        .number()
        .min(0)
        .max(0.2)
        .default(0.012)
        .describe("Change in one frame, with stillness around it, that counts as a pop"),
      still: z
        .number()
        .min(0)
        .max(0.05)
        .default(0.0015)
        .describe("Change per frame below which nothing is moving"),
      stop: z
        .number()
        .min(0)
        .max(1)
        .default(0.6)
        .describe("Last frame's speed, as a share of its fastest, that counts as a dead stop"),
      stutter: z
        .number()
        .min(0)
        .max(1)
        .default(0.2)
        .describe("A frame this much slower than its neighbours counts as a stutter"),
      offBeat: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(4)
        .describe("Frames off the beat that count as off-beat"),
      onBeat: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(2)
        .describe("Frames off the beat that still count as on it"),
      face: z.number().min(0).max(1).default(0.3).describe("How much of the face a graphic covers to count"),
      hold: z
        .number()
        .min(0)
        .max(3)
        .default(0.5)
        .describe("Seconds clipping or covering must last to count (a face: half of this)"),
    })
    .default({
      flicker: 0.01,
      pop: 0.012,
      still: 0.0015,
      stop: 0.6,
      stutter: 0.2,
      offBeat: 4,
      onBeat: 2,
      face: 0.3,
      hold: 0.5,
    })
    .describe(
      "What inspect_motion counts as a problem. Turn kinds off with off: motion:flicker, motion:pop, motion:stop, motion:stutter, motion:cut-off, motion:face, motion:safe-zone, motion:off-beat",
    ),
  joins: z
    .object({
      loudness: z
        .number()
        .min(0)
        .max(30)
        .default(6)
        .describe(
          "dB a level jump at a cut may go beyond what the speaker's level does across their own pauses",
        ),
      melody: z
        .number()
        .min(0)
        .max(24)
        .default(4)
        .describe(
          "Semitones the voice's pitch may jump at a mid-thought cut beyond what it does across the speaker's own pauses",
        ),
      room: z.number().min(0).max(30).default(5).describe("dB the room's background may step at a cut"),
      rushed: Seconds.max(2)
        .default(0.15)
        .describe(
          "Less pause than this after a sentence sounds rushed (unless the speaker paused less there themselves)",
        ),
      drag: Seconds.max(5).default(0.6).describe("More silence than this mid-thought drags"),
    })
    .default({ loudness: 6, melody: 4, room: 5, rushed: 0.15, drag: 0.6 })
    .describe("What inspect_joins counts as a rough cut in the dialogue"),
  off: z.array(z.string()).default([]).describe("Check ids not to run"),
});
export type CheckRules = z.infer<typeof CheckRules>;

/**
 * audio/music-clips.json: more music placed in the cut, on top of the main track: a song change, a
 * needle drop, a sting. Silence the main track there with a music cue when the song should change.
 */
export const MusicClip = z.object({
  id: Id,
  anchor: Anchor,
  duration: z.number().min(0.1).max(3600),
  source: Id.meta({ ref: "sources" }).describe("An imported audio (or video) clip"),
  offset: Seconds.default(0).describe("Where in the clip it starts playing"),
  volume: z.number().min(0).max(1).default(0.22),
  fadeIn: Seconds.max(10).default(0.5),
  fadeOut: Seconds.max(10).default(1),
  duckUnderSpeech: z.boolean().default(true),
  loop: z.boolean().default(false).describe("Loop the clip if the stretch is longer than it"),
});
export type MusicClip = z.infer<typeof MusicClip>;

/**
 * audio/music-cues.json: the music's volume over a stretch of the cut ("no music while Wiseman walks
 * out", "lift it into the launch"), pinned to a shot so it moves with the edit.
 */
export const MusicCue = z.object({
  id: Id,
  anchor: Anchor,
  duration: z.number().min(0.1).max(600),
  volume: z
    .number()
    .min(0)
    .max(2)
    .default(0)
    .describe("Multiplies the music during this stretch: 0 silences it, 0.3 dips it, 1.5 lifts it"),
  fade: z.number().min(0).max(5).default(0.5).describe("Seconds to ease into and out of the change"),
});
export type MusicCue = z.infer<typeof MusicCue>;

export const SFX_NAMES = [
  "whoosh",
  "swipe",
  "pop",
  "ding",
  "type",
  "thump",
  "riser",
  "click",
  "stamp",
  "squeak",
  "tap",
  "boom",
  "scratch",
  "whistle",
  "gavel",
  "tiptoe",
  "snap",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];
/** A visual's entry sound: a built-in sound, or "none" for silence. */
export const VISUAL_SFX = [...SFX_NAMES, "none"] as const;

/** audio/sfx.json */
export const Sfx = z
  .object({
    id: Id,
    anchor: Anchor,
    name: z.enum(SFX_NAMES).optional().describe("A built-in sound"),
    source: Id.optional()
      .meta({ ref: "sources" })
      .describe(
        "Or the sound of any imported audio or video clip: the user's own whoosh, a sting, a crowd roar",
      ),
    offset: Seconds.optional().meta({ default: 0 }).describe("Where in that clip the sound starts"),
    duration: z
      .number()
      .min(0.05)
      .max(600)
      .optional()
      .describe("How long it plays; unset plays the whole sound (built-ins: 2s, clips: up to 10s)"),
    volume: z.number().min(0).max(2).default(0.8),
    fade: z.number().min(0).max(5).optional().meta({ default: 0 }).describe("Seconds to fade in and out"),
  })
  .refine((s) => s.name || s.source, { message: "a sound needs a built-in name or a source clip" });
export type Sfx = z.infer<typeof Sfx>;

/** look.json: the color grade, applied identically in preview and export. */
export const Look = z.object({
  grade: Id.default("clean").describe("The colour grade: grades/<grade>.css"),
  vignette: z.boolean().default(false),
  drift: z
    .boolean()
    .default(true)
    .describe("A slow push-in across every shot, so the frame is never locked off"),
  driftAmount: z.number().min(0).max(0.2).default(0.035).describe("How far the drift pushes in over a shot"),
  vignetteStrength: z.number().min(0).max(1).default(0.45),
  background: Color.default("#000000").describe("The canvas behind the footage"),
  accent: Color.optional().describe(
    "Accent for graphics, effects and transitions; unset uses the caption accent",
  ),
  font: z
    .string()
    .max(80)
    .optional()
    .describe("Font family for graphics and titles; unset uses the house font"),
  reframe: z
    .enum(["shot", "follow"])
    .default("shot")
    .describe(
      "Cropped footage is framed on the person: shot frames each shot on where they are; follow pans with them as they move",
    ),
  fit: z
    .enum(["auto", "cover", "fit"])
    .default("auto")
    .describe(
      "Footage of another shape: cover crops to fill the frame, fit shows all of it over a blurred copy, auto crops except portrait footage in a landscape frame",
    ),
  fitBackdrop: z
    .object({
      blur: z.number().min(0).max(200).default(48).describe("Pixels"),
      brightness: z.number().min(0).max(2).default(0.55),
      saturation: z.number().min(0).max(3).default(1.1),
      zoom: z.number().min(1).max(2).default(1.15).describe("Pushed in so blurred edges stay off frame"),
    })
    .default({ blur: 48, brightness: 0.55, saturation: 1.1, zoom: 1.15 })
    .describe("The blurred copy behind fitted footage"),
  follow: z
    .object({
      smooth: z
        .number()
        .min(0.05)
        .max(3)
        .default(0.35)
        .describe("Seconds of smoothing on the person's movement"),
      deadZone: z
        .number()
        .min(0)
        .max(0.3)
        .default(0.035)
        .describe("How far (share of the frame) they move before the frame follows"),
      speed: z
        .number()
        .min(0.01)
        .max(1)
        .default(0.12)
        .describe("How quickly it catches up, per frame (1: at once)"),
    })
    .default({ smooth: 0.35, deadZone: 0.035, speed: 0.12 })
    .describe("How the frame follows the person, with reframe: follow"),
  jumpZoom: z
    .number()
    .min(1)
    .max(1.3)
    .default(1.08)
    .describe("Back-to-back shots from the same clip alternate between 1x and this zoom, hiding jump cuts"),
});
export type Look = z.infer<typeof Look>;

/**
 * cover.json: the cover (thumbnail) of the video: a frame of it with the person cut out, a big
 * headline behind or in front of them, and the background changed. Exported as an image with the video.
 */
export const Cover = z.object({
  at: Anchor.nullable()
    .default(null)
    .describe(
      "The moment whose frame the cover is made from; null: the most expressive frame of the first shot",
    ),
  text: z
    .string()
    .max(160)
    .default("")
    .describe("The headline: 2-5 punchy words. Mark accent words with *stars*. Empty for none"),
  place: z
    .enum(["behind", "front"])
    .default("behind")
    .describe(
      "behind: the person stands in front of the headline (cut out automatically); front: over everything",
    ),
  y: Unit.optional().describe(
    "Vertical centre of the headline; unset places it: behind, just above the head so the head overlaps its last line; in front, in the lower third",
  ),
  size: z.number().min(40).max(400).default(200).describe("Headline size in pixels at 1080 wide"),
  font: z.string().max(80).optional().describe("Font family; unset: the look's font"),
  weight: z.number().int().min(100).max(900).default(900),
  uppercase: z.boolean().default(true),
  color: Color.default("#FFFFFF"),
  accent: Color.optional().describe("Colour of *starred* words; unset: the accent"),
  stroke: z.number().min(0).max(30).default(0).describe("An outline around the letters, pixels"),
  box: Color.optional().describe("A solid box behind the headline"),
  background: z
    .object({
      kind: z.enum(["frame", "blur", "dim", "color", "gradient"]).default("frame"),
      color: Color.default("#0B0B0F"),
      color2: Color.optional().describe("For gradient: the bottom colour (unset: the accent)"),
      amount: z.number().min(0).max(80).optional().describe("Blur pixels (default 24), or dim 0..1 (0.55)"),
    })
    .default({ kind: "frame", color: "#0B0B0F" })
    .describe("What's behind the person: the frame, blurred or dimmed, or replaced by a colour or gradient"),
  zoom: z.number().min(1).max(3).default(1.15).describe("Push in on the person"),
  overlap: z
    .number()
    .min(0)
    .max(1)
    .default(0.45)
    .describe("Behind with y unset: how much of the headline's last line the head covers"),
  shrink: z
    .number()
    .min(0.3)
    .max(1)
    .default(0.7)
    .describe("Behind with y unset: the smallest the headline may get to fit above the head (share of size)"),
  drop: z
    .number()
    .min(0)
    .max(0.5)
    .default(0.25)
    .describe(
      "Behind with y unset, over a colour, gradient or blur: the most the person may move down to make room (share of the frame); 0 never",
    ),
  lineHeight: z.number().min(0.6).max(2).default(0.92),
  tracking: z.number().min(-0.2).max(0.5).default(-0.02).describe("Letter spacing, em"),
  shadow: z.number().min(0).max(1).default(0.5).describe("Soft shadow behind a headline in front, how dark"),
  subject: SubjectLook.optional().describe("The person's outline, glow and shadow"),
  graphic: z
    .object({
      id: Id.describe("A graphic in graphics/"),
      params: z.record(z.string(), z.unknown()).default({}),
      place: z.enum(["behind", "front"]).default("front"),
      at: z.number().min(0).default(1).describe("Seconds into the graphic's animation to show"),
    })
    .optional()
    .describe("A motion graphic drawn on the cover, frozen at a moment: a badge, an arrow, a stat"),
});
export type Cover = z.infer<typeof Cover>;

/**
 * graphics/<id>.html: a motion graphic, written like a small web page. HTML for the content, CSS for the
 * look, CSS @keyframes for the motion (driven by the video's clock, so preview and export match frame
 * for frame). Text comes from {{params}}; a JSON comment at the top describes them:
 *
 *   <!-- graphic {"name": "Callout", "params": {"title": {"type": "text", "default": "Big point"}}} -->
 *
 * Scripts don't run: graphics are sanitized and rendered in an isolated shadow root.
 */
export const Graphic = z.object({
  id: Id.describe("File name without .html"),
  html: z.string().max(200_000),
});
export type Graphic = z.infer<typeof Graphic>;

/** What a visual shows: one of the project's graphics with its values, or a cutaway to other footage. */
export const VisualContent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("graphic"),
    graphic: Id.describe("A graphic in the project's graphics folder"),
    params: z.record(z.string(), z.unknown()).default({}).describe("Values for the graphic's {{params}}"),
  }),
  z.object({
    kind: z.literal("cutaway"),
    source: Id.meta({ ref: "sources" }).describe("Another video or photo clip to show"),
    in: Seconds.default(0).describe("Where in that clip to start"),
    volume: z.number().min(0).max(2).optional().meta({ default: 0 }).describe("Hear the cutaway's own sound"),
    settle: z
      .number()
      .min(1)
      .max(1.5)
      .optional()
      .meta({ default: 1.08 })
      .describe("Starting zoom that settles to 1x; 1 for none"),
    framing: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        scale: z.number().min(1).max(4).default(1),
      })
      .optional()
      .describe("Where to crop the cutaway"),
  }),
  z.object({
    kind: z.literal("media"),
    source: Id.meta({ ref: "sources" }).describe(
      "A reaction GIF, sticker, meme image or short clip, shown in a box over the video (not full frame)",
    ),
    in: Seconds.default(0).describe("Where in that clip to start"),
    loop: z.boolean().default(true).describe("Play the clip again from its start while the visual lasts"),
    volume: z.number().min(0).max(2).optional().meta({ default: 0 }).describe("Hear the clip's own sound"),
    box: z
      .object({
        x: z.number().min(0).max(1).describe("Centre, as a fraction of the frame width"),
        y: z.number().min(0).max(1).describe("Centre, as a fraction of the frame height"),
        width: z
          .number()
          .min(0.08)
          .max(1)
          .describe("As a fraction of the frame width; height follows its shape"),
      })
      .default({ x: 0.5, y: 0.3, width: 0.62 })
      .describe("Where it sits: keep it off the face and the captions"),
    rotate: z.number().min(-25).max(25).default(0).describe("Degrees; a few either way reads as hand-placed"),
    style: z
      .enum(["card", "sticker", "plain"])
      .default("card")
      .describe(
        "card: rounded corners, a soft shadow and a thin border (reaction GIFs, memes, clips); sticker: no box, for see-through stickers, with a soft shadow; plain: just the media",
      ),
  }),
]);
export type VisualContent = z.infer<typeof VisualContent>;

/** overlays/visuals.json: motion graphics and cutaways over the video. */
export const Visual = z.object({
  id: Id,
  anchor: Anchor,
  behindSubject: z
    .boolean()
    .optional()
    .meta({ default: false })
    .describe(
      "Draw it behind the person in the shot, like text behind the subject. The person is cut out automatically",
    ),
  keyframes: z
    .array(Keyframe)
    .max(32)
    .optional()
    .describe(
      "Keyframed motion on top of its own animation: position, scale, rotation and opacity over time",
    ),
  duration: z.number().min(0.5).max(15),
  layout: z
    .enum(["overlay", "full", "split"])
    .default("overlay")
    .describe(
      "overlay draws over the video; full replaces it; split fills the top half and moves the speaker to the bottom half",
    ),
  content: VisualContent,
  split: z
    .object({
      ratio: z.number().min(0.25).max(0.75).default(0.5).describe("Share of the frame the visual takes"),
      side: z
        .enum(["top", "bottom"])
        .default("top")
        .describe("Where the visual sits; the speaker gets the rest"),
    })
    .optional()
    .describe("For split layout"),
  enter: Seconds.max(3)
    .optional()
    .meta({ default: 0.4 })
    .describe("Seconds for a split to open or a full visual to fade in"),
  exit: Seconds.max(3)
    .optional()
    .meta({ default: 0.23 })
    .describe(
      "Seconds a cutaway fades out over at its end; 0 is a hard cut. Unset: 0.23, or a hard cut when it ends on a cut",
    ),
  layer: z
    .number()
    .int()
    .min(-10)
    .max(10)
    .optional()
    .describe(
      "Drawing order among visuals: higher draws on top. Unset, cutaways are 0 and graphics 1, so tags and titles sit over cutaway footage; equal layers keep list order",
    ),
  backdrop: Color.optional().describe(
    "Background behind a full or split graphic; unset is dark with an accent glow",
  ),
  sfxVolume: z.number().min(0).max(2).optional().meta({ default: 0.7 }),
  follow: z
    .object({
      source: Id.meta({ ref: "sources" }).describe("The clip the track belongs to"),
      track: z.string().max(40).describe("A track id from that clip's analysis (see the track tool)"),
      side: z.enum(["below", "above", "left", "right", "center"]).default("below"),
      gap: z.number().min(0).max(0.3).default(0.02).describe("Space between the tracked box and the graphic"),
      fade: z.boolean().default(true).describe("Fade out while the person isn't on screen"),
    })
    .optional()
    .describe(
      "Pin the graphic to a tracked face or person so it moves with them, in a shot or in a cutaway showing that clip",
    ),
  sfx: z
    .enum(VISUAL_SFX)
    .nullable()
    .optional()
    .describe('Entry sound. Omit for the default for this layout, "none" for silence'),
});
export type Visual = z.infer<typeof Visual>;

/** motion/effects.json: camera moves on the footage. */
export const Effect = z.object({
  id: Id,
  anchor: Anchor,
  kind: Id.describe("The effect: effects/<kind>.css (shake, whip, flash, mono, glitch...)"),
  duration: z.number().min(0.1).max(15).default(0.5),
});
export type Effect = z.infer<typeof Effect>;

/** comments/comments.json: notes pinned to a moment, which the agent resolves. */
export const Comment = z.object({
  id: Id,
  anchor: Anchor,
  point: Point.optional().describe("Where on the frame the comment points, if anywhere"),
  text: z.string().min(1).max(1000),
  status: z.enum(["open", "queued", "resolved"]).default("open"),
  resolution: z.string().max(300).optional(),
});
export type Comment = z.infer<typeof Comment>;

/** Collections are lists of items with ids; singletons are whole values. Ops address both. */
export const CollectionSchemas = {
  sources: Source,
  transcripts: Transcript,
  shotLogs: ShotLog,
  analyses: Analysis,
  scenes: Scene,
  zooms: Zoom,
  captions: Caption,
  wordEdits: WordEdit,
  titles: Title,
  graphics: Graphic,
  captionLooks: CaptionLook,
  inspirations: Inspiration,
  effectKinds: StyleFile,
  transitionKinds: StyleFile,
  grades: StyleFile,
  fonts: FontFile,
  visuals: Visual,
  effects: Effect,
  sfx: Sfx,
  musicCues: MusicCue,
  musicClips: MusicClip,
  comments: Comment,
} as const;

export const SingletonSchemas = {
  meta: Meta,
  captionStyle: CaptionStyle,
  music: Music,
  mix: Mix,
  exportSettings: ExportSettings,
  checkRules: CheckRules,
  look: Look,
  cover: Cover,
  style: z.string().max(20_000),
} as const;

export type Collection = keyof typeof CollectionSchemas;
export type Singleton = keyof typeof SingletonSchemas;
export const COLLECTIONS = Object.keys(CollectionSchemas) as Collection[];
export const SINGLETONS = Object.keys(SingletonSchemas) as Singleton[];

/** Collections only indexing writes. The agent reads them through tools, never edits them with ops. */
export const DERIVED: readonly Collection[] = ["transcripts", "shotLogs", "analyses"];

export type ItemOf<C extends Collection> = z.infer<(typeof CollectionSchemas)[C]>;
export type ValueOf<S extends Singleton> = z.infer<(typeof SingletonSchemas)[S]>;

export type ProjectDoc = { readonly [C in Collection]: readonly ItemOf<C>[] } & {
  readonly [S in Singleton]: ValueOf<S>;
};

export const ProjectDocSchema = z.object({
  ...Object.fromEntries(COLLECTIONS.map((c) => [c, z.array(CollectionSchemas[c])])),
  ...SingletonSchemas,
}) as unknown as z.ZodType<ProjectDoc>;
