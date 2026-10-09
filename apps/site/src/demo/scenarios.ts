import type { Look } from "./Stage.tsx";

/**
 * The hero's scripted runs, all on one real clip (public/demo/creator.mp4, 8 s). What it "sees" comes from
 * Cutroom's own models run on that clip: the person matte drives every effect, and the face and person boxes
 * are in sees.json.
 */

export type Lane = "video" | "cutout" | "background" | "titles" | "look" | "sound";

export interface Added {
  lane: Lane;
  /** Seconds. */
  from: number;
  to: number;
  label: string;
}

export interface Scenario {
  key: string;
  /** The words in the hero sentence. */
  word: string;
  prompt: string;
  look: Look;
  thinking: string;
  tools: string[];
  /** The file the agent edits, and the lines it adds. */
  file: string;
  diff: string[];
  reply: string;
  chips: string[];
  added: Added[];
}

export const DURATION = 8;

export const scenarios: Scenario[] = [
  {
    key: "tokyo",
    word: "Tokyo at night",
    prompt: "Put me in Tokyo at night and match the light",
    look: 1,
    thinking: "Looking at every frame…",
    tools: [
      "Cut her out on 240/240 frames",
      "Picked a plate: Kabukichō, dusk",
      "Matched light: neon rim, cool key",
    ],
    file: "background.json",
    diff: [
      '{ "cutout": "person_1",',
      '  "plate": "tokyo_night.jpg",',
      '  "relight": ["pink rim", "cyan rim"] }',
    ],
    reply:
      "Cut you out on every frame and put Kabukichō behind you. Added pink and cyan rims so the street lights you.",
    chips: ["Cut out person 1", "Add background", "Relight"],
    added: [
      { lane: "cutout", from: 0, to: 8, label: "person_1 · 240 frames" },
      { lane: "background", from: 0, to: 8, label: "tokyo_night.jpg" },
      { lane: "look", from: 0, to: 8, label: "Neon rim" },
    ],
  },
  {
    key: "behind",
    word: "a title behind her",
    prompt: "Put a huge title behind me, keep my head in front",
    look: 2,
    thinking: "Finding where her head is…",
    tools: [
      "Head tracked, top at 9% of the frame",
      "Wrote graphics/title-behind.html",
      "Layered it under person_1",
    ],
    file: "graphics/title-behind.html",
    diff: ['<h1 class="behind">MAIN', "  <em>CHARACTER</em></h1>", '<!-- layer: under "person_1" -->'],
    reply: "“MAIN CHARACTER” sits behind you, and your head stays in front of it on every frame.",
    chips: ["Add title behind", "Layer under person"],
    added: [
      { lane: "cutout", from: 0, to: 8, label: "person_1 · 240 frames" },
      { lane: "titles", from: 0.3, to: 8, label: "MAIN CHARACTER · behind" },
    ],
  },
  {
    key: "synth",
    word: "a synthwave music video",
    prompt: "Turn this into a synthwave music video",
    look: 3,
    thinking: "Reading the shot…",
    tools: [
      "Made graphics/sunset-grid.html",
      "Graded: magenta to cyan duotone",
      "Added a glow round her edge",
    ],
    file: "looks/synthwave.css",
    diff: [
      ".person { filter: duotone(#5a0d73, #66f2ff);",
      "  glow: 2px #66f2ff; }",
      ".background { src: sunset-grid.html }",
    ],
    reply: "Built a sunset and a grid running towards you, graded you magenta to cyan, and lit your edge.",
    chips: ["Add sunset grid", "Look: synthwave", "Add glow", "Add synth bed"],
    added: [
      { lane: "cutout", from: 0, to: 8, label: "person_1 · 240 frames" },
      { lane: "background", from: 0, to: 8, label: "sunset-grid.html" },
      { lane: "look", from: 0, to: 8, label: "Synthwave" },
      { lane: "sound", from: 0, to: 8, label: "synth_bed.mp3" },
    ],
  },
  {
    key: "cine",
    word: "a cinematic look",
    prompt: "Make it cinematic: shallow focus and a film grade",
    look: 4,
    thinking: "Measuring depth from the cutout…",
    tools: ["Blurred everything behind her", "Graded: teal and orange", "Framed 2.39:1, added grain"],
    file: "looks/cinematic.css",
    diff: [".background { blur: lens(85%) }", ".frame { grade: teal-orange;", "  bars: 2.39; grain: 0.06 }"],
    reply: "Shallow focus from the cutout, a teal and orange grade, scope bars and a little grain.",
    chips: ["Blur background", "Look: teal & orange", "Bars 2.39:1", "Add grain"],
    added: [
      { lane: "cutout", from: 0, to: 8, label: "person_1 · 240 frames" },
      { lane: "background", from: 0, to: 8, label: "Lens blur 85%" },
      { lane: "look", from: 0, to: 8, label: "Teal & orange · 2.39:1" },
    ],
  },
];

export type Phase = "typing" | "sent" | "thinking" | "tools" | "applying" | "done";

/** How long each phase lasts, in ms (typing is per character). */
export const timing = {
  perChar: 32,
  sent: 400,
  thinking: 2600,
  perTool: 700,
  applying: 1300,
  done: 6000,
};
