import { STARTER_CAPTION_LOOKS } from "./caption-looks.ts";
import { newId } from "./history.ts";
import {
  type Caption,
  CaptionStyle,
  CheckRules,
  Cover,
  ExportSettings,
  Look,
  Mix,
  Music,
  type ProjectDoc,
  type Scene,
  type Source,
  type Zoom,
} from "./schema.ts";
import { STARTER_GRAPHICS } from "./starter-graphics.ts";
import { STARTER_VERSION } from "./starters.ts";
import { STYLE_PRESETS } from "./style-presets.ts";
import { STARTER_EFFECTS, STARTER_GRADES, STARTER_TRANSITIONS } from "./styles.ts";

/** STYLE.md for a new project when the user didn't choose one: the talking-to-camera starting point. */
export const DEFAULT_STYLE = STYLE_PRESETS[0]!.text;

/** A new project. `style`: the user's STYLE.md for new projects (Settings), else the default. */
export function emptyProject(name: string, style = DEFAULT_STYLE): ProjectDoc {
  return {
    meta: {
      schema: 1,
      id: newId("p"),
      name,
      format: { width: 1080, height: 1920, fps: 30 },
      createdAt: new Date().toISOString(),
      starters: STARTER_VERSION,
    },
    style: style.trim() ? style : DEFAULT_STYLE,
    look: Look.parse({}),
    sources: [],
    transcripts: [],
    analyses: [],
    scenes: [],
    zooms: [],
    captions: [],
    wordEdits: [],
    captionStyle: CaptionStyle.parse({}),
    titles: [],
    graphics: [...STARTER_GRAPHICS],
    captionLooks: [...STARTER_CAPTION_LOOKS],
    inspirations: [],
    effectKinds: [...STARTER_EFFECTS],
    transitionKinds: [...STARTER_TRANSITIONS],
    grades: [...STARTER_GRADES],
    fonts: [],
    shotLogs: [],
    musicCues: [],
    musicClips: [],
    visuals: [],
    effects: [],
    music: Music.parse({}),
    mix: Mix.parse({}),
    exportSettings: ExportSettings.parse({}),
    checkRules: CheckRules.parse({}),
    cover: Cover.parse({}),
    sfx: [],
    comments: [],
  };
}

/**
 * A complete project without any footage: solid color stand-ins for 14 shots, so the editor has
 * something real to play, check and edit the first time it opens. Drop clips in to replace them.
 */
export function demoProject(): ProjectDoc {
  const shots: [label: string, color: string, dur: number, note: string][] = [
    ["beach_walk", "#355761", 2.2, "Walking onto the beach"],
    ["waves", "#2B4F63", 1.6, "Waves, close up"],
    ["suya_shack", "#5A4A36", 2.4, "Suya at the beach shack"],
    ["laugh", "#45603F", 1.8, "He laughs at the joke"],
    ["race", "#3A3552", 2.0, "Racing to the water"],
    ["jump_wide", "#2F5A6B", 2.6, "Everyone jumps in"],
    ["market", "#5E4632", 1.4, "Market run for drinks"],
    ["sunset_drive", "#36545C", 2.2, "Drive at sunset"],
    ["pool", "#2B4F63", 1.8, "Pool jump"],
    ["dinner", "#4C5A3A", 2.4, "Dinner on the rooftop"],
    ["dance", "#3A3552", 2.0, "Dancing, slightly blurry"],
    ["lights", "#5A4A36", 2.6, "City lights from the car"],
    ["toast", "#2F5A6B", 1.6, "Toast at the table"],
    ["group", "#45603F", 3.4, "Group photo on the stairs"],
  ];
  const sources: Source[] = shots.map(([label, color, dur, note], i) => ({
    id: `clip_${i + 1}`,
    kind: "solid",
    label,
    color,
    duration: dur + 2,
    hdr: false,
    hasAudio: false,
    status: "ready",
    proxy: false,
    speech: false,
    summary: note,
    tags: [label.replace(/_/g, " ")],
  }));
  const scenes: Scene[] = shots.map(([, , dur, note], i) => ({
    id: `sc${i + 1}`,
    source: sources[i]!.id,
    in: 0.5,
    out: 0.5 + dur,
    note,
    volume: 1,
  }));
  const zoom = (
    id: string,
    scene: string,
    at: number,
    duration: number,
    scale: number,
    ease: Zoom["ease"],
  ): Zoom => ({
    id,
    anchor: { scene, at },
    duration,
    scale,
    focus: { x: 0.5, y: 0.45 },
    ease,
  });
  const caption = (
    id: string,
    scene: string,
    at: number,
    duration: number,
    text: string,
    emphasis: string,
  ): Caption => ({
    id,
    anchor: { scene, at },
    duration,
    text,
    emphasis: [emphasis],
  });
  const base = emptyProject("Weekend in Lagos");
  return {
    ...base,
    sources,
    scenes,
    zooms: [
      zoom("z1", "sc1", 1.2, 0.8, 1.12, "smooth"),
      zoom("z2", "sc4", 0.2, 1.2, 1.35, "punch"),
      zoom("z3", "sc7", 0.2, 1.0, 1.2, "smooth"),
      zoom("z4", "sc12", 0.2, 1.4, 1.18, "smooth"),
    ],
    captions: [
      caption("cap1", "sc1", 0.6, 2.6, "we did not plan any of this", "plan"),
      caption("cap2", "sc5", 0.4, 3.0, "and then everyone jumped in", "jumped"),
      caption("cap3", "sc10", 0.2, 3.2, "best weekend in Lagos", "Lagos"),
    ],
    titles: [
      {
        id: "hook",
        role: "hook",
        anchor: { scene: "sc1", at: 0 },
        duration: 2.4,
        text: "We did not plan this weekend.",
        position: { x: 0.07, y: 0.1 },
        size: 84,
      },
    ],
    sfx: [{ id: "sfx1", anchor: { scene: "sc9", at: 0.1 }, name: "whoosh", volume: 0.8 }],
    comments: [
      { id: "cm1", anchor: { scene: "sc4", at: 0.6 }, text: "Too slow here", status: "open" },
      { id: "cm2", anchor: { scene: "sc14", at: 1.0 }, text: "Hold the group photo longer", status: "open" },
    ],
  };
}
