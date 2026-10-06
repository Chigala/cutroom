/**
 * The built-in inspirations: editing styles that work on TikTok, Reels and Shorts, each written the
 * way a senior editor briefs another (what the video is for, its structure, its rhythm, what moves and
 * what doesn't, what to avoid, how to tell it's working), with the settings that make the numbers real
 * and, where the style needs one, its own caption look. See inspiration.ts for the format.
 *
 * Graphics, effects, transitions and grades named in the briefs are the project's built-ins (every
 * project has them); the caption looks made for a style come with it.
 */

import type { InspirationPack } from "./inspiration.ts";
import {
  BEAT_TITLE,
  CAMPFIRE,
  CHAPTER_CARD,
  END_CARD,
  GUIDE,
  HEADLINE,
  HEADLINE_CARD,
  PLACE_STAMP,
  POINT_MARKER,
  POP,
  STEP_BADGE,
  TOPIC_BANNER,
} from "./inspiration-assets.ts";
import type { CaptionLook, Graphic } from "./schema.ts";

const look = (id: string, meta: object, css: string): CaptionLook => ({
  id,
  css: `/* look ${JSON.stringify(meta)} */\n${css.trim().replace(/^ {4}/gm, "")}\n`,
});

/** The style's own files: its caption look and its signature graphics. */
interface Signature {
  readonly looks?: readonly CaptionLook[];
  readonly graphics?: readonly Graphic[];
}

const pack = (
  id: string,
  header: Record<string, unknown>,
  brief: string,
  { looks = [], graphics = [] }: Signature = {},
): InspirationPack => ({
  id,
  md: `<!-- inspiration ${JSON.stringify(
    {
      ...header,
      version: 2,
      files: [...looks.map((l) => `captionLooks/${l.id}`), ...graphics.map((g) => `graphics/${g.id}`)],
    },
    null,
    2,
  )} -->\n\n${brief.trim().replace(/^ {2}/gm, "")}\n`,
  files: {
    ...(looks.length && { captionLooks: looks }),
    ...(graphics.length && { graphics }),
  },
});

// --- Caption looks made for a style -------------------------------------------------------------

const PUNCH = look(
  "punch",
  {
    name: "Punch",
    description: "Heavy caps, two or three words at a time; the word being said jumps in the accent",
    defaults: { maxWords: 3, uppercase: true, size: 74, preset: "plain" },
  },
  `
    .caption {
      font-family: var(--font, "Montserrat");
      font-size: var(--size);
      font-weight: 900;
      line-height: 1.08;
      letter-spacing: -0.01em;
      color: var(--color);
      text-wrap: balance;
      -webkit-text-stroke: calc(var(--size) * 0.12) #000;
      paint-order: stroke fill;
      text-shadow: 0 0.06em 0.18em rgba(0, 0, 0, 0.55);
      /* The page lands with a snap. */
      animation: land 0.18s cubic-bezier(0.2, 1.6, 0.4, 1) both;
    }
    .word { display: inline-block; margin: 0 0.05em; transform-origin: 50% 70%; }
    /* The word being said jumps; said words keep the accent only when emphasized. */
    .word.now { color: var(--accent); animation: hit 0.16s cubic-bezier(0.2, 1.8, 0.4, 1) both; }
    .word.hl { color: var(--accent); }
    @keyframes land { from { transform: scale(0.86); opacity: 0.4; } }
    @keyframes hit { from { transform: scale(1.22); } to { transform: scale(1.08); } }
    `,
);

const DIARY = look(
  "diary",
  {
    name: "Diary",
    description: "Quiet lowercase lines that fade in word by word, like thoughts",
    defaults: { maxWords: 6, uppercase: false, size: 46, preset: "plain" },
  },
  `
    .caption {
      font-family: var(--font, "Inter Tight");
      font-size: var(--size);
      font-weight: 500;
      line-height: 1.25;
      letter-spacing: -0.005em;
      color: var(--color);
      text-transform: lowercase;
      text-wrap: balance;
      text-shadow: 0 0.04em 0.5em rgba(0, 0, 0, 0.55), 0 0 0.12em rgba(0, 0, 0, 0.35);
    }
    /* Each word arrives softly as it's said; the line is there, waiting, before it. */
    .word { display: inline-block; animation: arrive 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
    .word.hl { color: var(--accent); }
    @keyframes arrive { from { opacity: 0.28; filter: blur(0.04em); transform: translateY(0.06em); } }
    `,
);

const STUDIO = look(
  "studio",
  {
    name: "Studio",
    description:
      "Big confident white words; the one being said lights up in the accent, the rest wait dimmed",
    defaults: { maxWords: 4, uppercase: false, size: 68, preset: "plain" },
  },
  `
    .caption {
      font-family: var(--font, "Montserrat");
      font-size: var(--size);
      font-weight: 800;
      line-height: 1.12;
      color: var(--color);
      text-wrap: balance;
      -webkit-text-stroke: calc(var(--size) * 0.1) rgba(0, 0, 0, 0.9);
      paint-order: stroke fill;
      text-shadow: 0 0.05em 0.25em rgba(0, 0, 0, 0.5);
    }
    .word { display: inline-block; margin: 0 0.04em; }
    .word.next { opacity: 0.55; }
    .word.now { color: var(--accent); transform: scale(1.06); }
    .word.hl.said { color: var(--accent); }
    `,
);

// --- The inspirations ----------------------------------------------------------------------------

const PUNCHY_EXPLAINER = pack(
  "punchy-explainer",
  {
    name: "Punchy explainer",
    description: "Dense, relentless talking-head edit that never lets the eye rest",
    bestFor: ["Talking to camera", "Explainers", "Business and education", "Hot takes"],
    energy: 5,
    length: "20-60s",
    tags: ["fast", "jump cuts", "bold captions", "graphics"],
    settings: {
      checkRules: { maxShot: 2.5, pace: 3, deadAir: 0.5, hookWithin: 1.5, sfxGap: 1.8 },
      captionStyle: {
        look: "punch",
        preset: "plain",
        uppercase: true,
        size: 74,
        accent: "#FFD400",
        maxWords: 3,
        minWords: 1,
        pauseBreak: 0.3,
        maxPageSeconds: 1.6,
      },
      mix: { loudness: -12, pauses: { sentence: 0.28, phrase: 0.16, word: 0.1 } },
      music: { volume: 0.22, duckTo: 0.16 },
      look: { grade: "punchy", jumpZoom: 1.12, drift: true, driftAmount: 0.04 },
    },
  },
  `
  # Punchy explainer

  ## The idea
  One person, one idea, delivered at full speed. The viewer should never have a second to think about scrolling: every pause is gone, the frame changes every two or three seconds, and every claim gets something on screen that proves or sharpens it. Think of the fastest business and education creators: dense, confident, useful.

  ## Structure
  1. Hook (0-1.5s): open on the boldest claim or the most surprising number the speaker says, even if it comes mid-video. A title of 3-5 words on the first frame states the promise ("Why your ads stop working"). No greeting, no "so", no name.
  2. The problem (to ~25%): why it matters, in one or two lines.
  3. The points (the middle): two to four points, each opened with its point-marker (the number and the point in a few words) on the marker line. Give each point its own visual too.
  4. The payoff (last 15%): the one line people will repeat. Land it with a punch-in and nothing else on screen.
  5. Out: end on the payoff or a single short call to action. Never on a trailing "yeah".

  ## Pacing
  - Cut every hesitation, breath gap, false start and filler. A pause longer than 0.3s doesn't survive unless it sets up the payoff.
  - Jump cuts are the style: back-to-back shots from one take alternate between 1x and 1.12x so each cut reads as deliberate.
  - Something changes on screen at least every 3 seconds: a cut, a zoom, a visual, a caption page.
  - Faster in the middle, a held beat before the payoff.

  ## Captions
  The Punch look: heavy uppercase, two or three words a page, the word being said jumps in yellow. Emphasize the one word per sentence that carries it (the number, the verb, the surprise). Captions sit in the lower middle, clear of the face.

  ## Motion
  - A punch-in (scale 1.15-1.25, ease punch) on every key claim, landing on the stressed word, every 4-6 seconds; release on the next cut.
  - Alternate framing so no two neighbouring shots feel the same.
  - A whip between sections, at most twice a video. A shake (with a boom) only on a genuinely shocking line, at most once.

  ## Visuals
  - Every number said: the number graphic (overlay), on the word.
  - Steps or several points: list or steps in a split, revealed point by point as they're said.
  - A contrast ("most people do X, winners do Y"): compare in a split.
  - The punchline or the turn: kinetic or callout with the key words in *stars*.
  - Evidence when the speaker cites something real: capture_page of the source as a cutaway, 2s.
  - A reaction meme at most once every 10 seconds, only for genuinely funny beats.
  - A visual every 3-5 seconds of speech, 1.5-3s each, never the same graphic twice in a row.

  ## Sound
  Visuals keep their entry pops and whooshes. A low-key, driving instrumental bed (hip-hop, lo-fi, light electronic), ducked hard under speech. A bass hit on the payoff. Loud, dense mix (-12 LUFS).

  ## Look
  Punchy grade, gentle drift on every shot, yellow accent.

  ## Make the footage better
  A phone on a desk becomes a produced video:
  - Framing: take the headroom fix when it's flagged, but no tighter: the captions need their room above or below the face, so the clear-face check must still pass after any reframe. Jump cuts alternate 1x and 1.12x so every cut looks like a second camera.
  - A slow talker (under about 150 words a minute) plays at 1.08-1.12 speed: it reads as energy, not haste. Never past 1.15.
  - Colour: correct the cast, then the punchy grade; skin must stay natural.
  - Sound: clean, close and loud. If the room echoes, voiceClean medium or strong.
  - Weak picture moments (looking away, reading notes, a long stumble that had to stay) get covered: a visual, a capture of the source, or a cut to the strongest take.

  ## Avoid
  - Dead air, slow b-roll montages, establishing shots.
  - Graphics that just repeat the caption word for word.
  - Two visuals at once, or a visual over the payoff.
  - Memes over serious information (prices, steps, safety).

  ## How to tell it's working
  - The first frame already shows the hook title over the speaker.
  - No stretch longer than 3 seconds without a change on screen.
  - No pause over 0.3s, except one deliberate beat before the payoff.
  - Every number said is on screen as a graphic.
  `,
  { looks: [PUNCH], graphics: [POINT_MARKER] },
);

const CALM_VLOG = pack(
  "calm-vlog",
  {
    name: "Calm vlog",
    description: "Soft, music-led day-in-the-life edit that lets moments breathe",
    bestFor: ["Vlogs", "Day in the life", "Travel", "Lifestyle and aesthetic"],
    energy: 2,
    length: "30-90s",
    tags: ["slow", "music-led", "film look", "lowercase captions"],
    settings: {
      checkRules: { maxShot: 6, minShot: 1, pace: 8, deadAir: 2.5, hookWithin: 3, sfxGap: 6 },
      captionStyle: {
        look: "diary",
        preset: "plain",
        uppercase: false,
        size: 46,
        accent: "#F3E3C3",
        maxWords: 6,
        minWords: 3,
        pauseBreak: 0.8,
        maxPageSeconds: 3.5,
      },
      mix: {
        loudness: -16,
        entrySounds: false,
        voiceTone: "warm",
        sfxLevel: 0.6,
        pauses: { sentence: 0.6, phrase: 0.35, word: 0.18 },
      },
      music: { volume: 0.38, duckTo: 0.45, fadeIn: 1.5, fadeOut: 3, duckRamp: 0.6 },
      look: {
        grade: "kodak-warm",
        drift: true,
        driftAmount: 0.025,
        vignette: true,
        vignetteStrength: 0.3,
        jumpZoom: 1.04,
      },
    },
  },
  `
  # Calm vlog

  ## The idea
  A quiet, beautiful slice of life. The music sets the mood and the pictures carry the story; words, when there are any, feel like thoughts said softly. The viewer should feel like they're there, not like they're being sold to. Restraint is the whole style.

  ## Structure
  1. Open (0-3s): the single most beautiful or intriguing shot, held, with one soft line of voice or text that sets up the day ("slow sunday in lisbon").
  2. The day, in order: small moments (making coffee, walking out, the view, the food), each a short sequence of two or three shots: wide, then detail.
  3. A middle moment that matters a little more: hold it longer, let the natural sound come up.
  4. Close: a quiet ending shot (light fading, a door closing, the view from the window), the music resolving. No call to action.

  ## Pacing
  - Shots of 2-5 seconds, cut on movement (a hand reaching, a step, a pour), never mid-stillness for no reason.
  - Let moments breathe: a beat of natural sound between lines is good.
  - J and L cuts on every change of scene: the next place's sound arrives 0.4-0.8s before its picture (audioLead).
  - B-roll moments that feel dreamy can play at 0.75 speed.

  ## Captions
  The Diary look: lowercase, small, sentence-length pages that fade in word by word. No uppercase, no emoji, at most one soft accent word in a whole video. When there's no speech, a few handwritten-feeling lines of text (titles with fade in and out) can tell the story; keep them under eight words.

  ## Motion
  - No punch-ins. At most a gentle push (scale 1.04-1.06, ease smooth) on an emotional line.
  - Drift stays on, subtle.
  - Mostly hard cuts on motion; a crossfade (0.5-0.8s) only for a jump in time or place.

  ## Visuals
  No graphics, no memes. At most one place-stamp (the place and the time, lowercase) early, when the day starts or the place changes.

  ## Sound
  Music-led: soft acoustic, piano, lo-fi or ambient, chosen for the mood (find_music with words like "warm acoustic morning"). Music sits higher than usual and only dips gently under voice. Keep natural sound (footsteps, cups, waves, a street) under the music; it's what makes it feel real. No pops, whooshes or impacts. Quiet mix (-16 LUFS).

  ## Look
  Kodak warm grade, light vignette, slow drift. Footage should feel like film, not like a phone.

  ## Make the footage better
  Phone footage should come out looking like film:
  - Colour first: make every clip match (correct each cast so whites are white across the day), then the Kodak warm grade over all of it.
  - Trim every shot to its best moment of light or movement; drop the shaky starts and ends of handheld clips.
  - Slow the dreamy moments (hands, water, steam, a walk) to 0.75 and let them carry music.
  - Reframe for the vertical frame: the subject on a third, horizons level with the frame's edges, nothing important cut off.
  - Keep the natural sound, cleaned lightly (voiceClean light), under the music.

  ## Avoid
  - Fast cuts, punch-ins, shakes, whips, glitches.
  - Loud sound effects of any kind.
  - Uppercase, bold or boxed captions; walls of text.
  - Stock footage that doesn't match the day's footage.

  ## How to tell it's working
  - Every cut lands on movement or on a beat of the music.
  - No sound effect on any graphic or cut.
  - The music never drops out abruptly; scene changes are bridged by sound.
  - Nothing on screen is louder than the footage itself.
  `,
  { looks: [DIARY], graphics: [PLACE_STAMP] },
);

const PODCAST_CLIP = pack(
  "podcast-clip",
  {
    name: "Podcast clip",
    description: "One complete, quotable thought cut from a long conversation",
    bestFor: ["Podcast clips", "Interviews", "Panels and talks"],
    energy: 3,
    length: "30-75s",
    tags: ["cold open", "big captions", "speaker framing", "minimal music"],
    settings: {
      checkRules: { maxShot: 6, pace: 6, deadAir: 0.8, hookWithin: 2 },
      captionStyle: {
        look: "studio",
        preset: "plain",
        uppercase: false,
        size: 68,
        accent: "#3CF27A",
        maxWords: 4,
        minWords: 2,
        pauseBreak: 0.5,
        maxPageSeconds: 2.2,
      },
      mix: { loudness: -14, entrySounds: false, pauses: { sentence: 0.36, phrase: 0.2, word: 0.12 } },
      music: { volume: 0.12, duckTo: 0.2 },
      look: { grade: "clean", jumpZoom: 1.1, drift: true, driftAmount: 0.03 },
    },
  },
  `
  # Podcast clip

  ## The idea
  One thought, complete enough to stand on its own, from a long conversation: a hot take, a story, a confession, a laugh. The words do the work; the edit makes them impossible to miss and removes every second that isn't the thought.

  ## Structure
  1. Cold open (0-2s): start on the strongest line of the clip, mid-answer if needed, even if it's said later (cut it in first, then go back). Never start on "so", "yeah" or a question being set up.
  2. The topic-banner pinned at the top for the whole clip states the topic as a tension ("Why he quit a *$400k* job"), in the speaker's own terms, with the show's name above it when it's known. It's the frame of the clip: no other title at the top. A visual lasts 15 seconds at most, so chain segments back to back (continues on each after the first, holds on each before the last) to run it the whole way.
  3. The thought, in order, tightened: setup, the turn, the payoff.
  4. Out on the payoff line or the laugh after it. Hard out; no outro.

  ## Pacing
  - Tighten pauses, but keep the speaker's rhythm: this is a conversation, not a sprint.
  - With two or more people: cut on speaker change, and cut to the listener for reactions (a laugh, a nod, a stunned face). Use L-cuts so a speaker finishes a sentence over the listener's reaction (audioTail 0.3-0.6).
  - One person talking for a while: alternate framing on sentence breaks (jump cuts at 1x and 1.1x), never hold one framing over 6 seconds.

  ## Captions
  The Studio look: big white words, the one being said lit in green, the next ones dimmed. Four words a page, never fewer than two. Emphasize the words the speaker hits hardest. Fix misheard names and brands carefully: podcast audiences notice.

  ## Motion
  - A slow push (scale 1.05-1.08, ease smooth) across a monologue that's building.
  - One punch-in (1.15, ease punch) on the line the clip is about.
  - No shakes, whips or glitches.

  ## Visuals
  - The speaker's name and role once, early, with the name-tag following them or a lower-third (2.5s).
  - A number graphic when a figure is the point; a quote card (quote, full) for the single most quotable line if it isn't already the hook.
  - No memes unless the moment is plainly comic.

  ## Sound
  Mostly no music. If any, a barely-there bed under the whole clip. Keep laughter and reactions; never put a sound over them. No entry sounds on graphics.

  ## Look
  Clean grade. Faces framed on the thirds; correct colour casts between cameras so the people match.

  ## Make the footage better
  - One wide camera becomes a multicam: on each change of speaker, crop to them (framing scale 1.4-1.8 centred on their face, leaving room for the captions: check clear-face after) and come back to the wide two-shot for reactions and laughs.
  - Match the people: correct each camera's colour cast so skin matches between shots, and even the level jumps between speakers (inspect_joins finds them).
  - A noisy or echoey room gets voiceClean medium; never let one voice sound far away.
  - Faces sit on the thirds with headroom trimmed; a speaker leaning out of frame gets reframed (look reframe follow).

  ## Avoid
  - Cutting into a laugh or off the end of a reaction.
  - Music over talking that competes with the voice.
  - Context the clip doesn't need ("as I was saying earlier").

  ## How to tell it's working
  - The first two seconds are the most interesting thing said.
  - The clip makes complete sense to someone who never heard the episode.
  - Every reaction lands before the next cut.
  `,
  { looks: [STUDIO], graphics: [TOPIC_BANNER] },
);

const STORYTIME = pack(
  "storytime",
  {
    name: "Storytime",
    description: "A personal story told to camera, building suspense to a reveal",
    bestFor: ["Storytime", "Personal stories", "Confessions", "Talking to camera"],
    energy: 3,
    length: "40-120s",
    tags: ["suspense", "reveal", "memes", "builds"],
    settings: {
      checkRules: { maxShot: 4.5, pace: 5, deadAir: 1.2, hookWithin: 2.5 },
      captionStyle: {
        look: "campfire",
        preset: "plain",
        uppercase: false,
        size: 66,
        maxWords: 4,
        minWords: 2,
        pauseBreak: 0.45,
      },
      mix: { loudness: -14, pauses: { sentence: 0.45, phrase: 0.24, word: 0.14 } },
      music: { volume: 0.22, duckTo: 0.25 },
      look: { grade: "teal-orange", vignette: true, vignetteStrength: 0.4, jumpZoom: 1.08 },
    },
  },
  `
  # Storytime

  ## The idea
  Someone tells a story to camera and the edit turns it into a ride: the hook promises a payoff, tension builds, the reveal lands, and the reaction gets its moment. The edit's job is timing: speed where the story is setup, silence where it's suspense.

  ## Structure
  1. Hook (0-2.5s): open on the most dramatic line of the story (the outcome or the moment it went wrong), used as a flash-forward, with a title that opens a loop ("I got banned from my own wedding"). Then cut back to the start.
  2. Setup: who, where, what was supposed to happen. Tight; nothing the payoff doesn't need.
  3. Escalation: each beat a little worse or stranger than the last. Cuts get faster here.
  4. The reveal: hold a beat of silence right before it (keep the pause, drop the music to nothing), then land the line with a punch-in.
  5. The reaction and the aftermath: one or two lines, and end on the funniest or most honest one.

  ## Pacing
  - Setup at a steady pace (shots of 3-4s), escalation faster (1.5-2.5s), the reveal held.
  - Keep the storyteller's own pauses where they create tension; cut every other hesitation.
  - Never cut off a laugh, a sigh or a gasp.

  ## Captions
  The Campfire look: warm cream words that rise in as they're told, four a page; the emotional words and names glow in the accent.

  ## Motion
  - A slow push (1.06-1.1, ease smooth) through the build to the reveal.
  - A punch-in (1.2-1.3, ease punch) on the reveal line.
  - One shake with a boom on the most shocking line, at most once.
  - mono effect for a flashback within the story ("back in 2019"), with a crossfade in and out.

  ## Visuals
  - A reaction meme for a comic beat (cringe, side eye, disbelief) beside the face, every 10-15 seconds at most.
  - A screenshot of a text or message when the story mentions one: a media box or a cutaway, 2s.
  - The chapter-card for a time jump ("Three weeks *later*"), once or twice a story: it's the story's punctuation.

  ## Sound
  A music bed that fits the story's tone (tense, comedic or emotional), quiet under speech. A riser into the reveal, then a music cue at 0 for the beat of silence, and the music back after. A record scratch or awkward sting for a comic turn, once or twice.

  ## Look
  Teal and orange grade with a vignette: slightly cinematic, warm on the face.

  ## Make the footage better
  - Intimacy: frame tighter as the story builds (a framing push from 1 to about 1.12 over the escalation) so the reveal is the closest shot of the video, as long as the captions still clear the face (check clear-face after).
  - At the reveal, the world falls away: blur the background behind them (scene.background blur, then cutout) for that line only.
  - Warm the face (correct a cool cast first), and keep the vignette subtle so it frames rather than darkens.
  - Clean the voice so whispers and asides stay clear; never duck their own pauses into silence (keep room tone).

  ## Avoid
  - Revealing the payoff fully in the hook (tease it, don't spend it).
  - Music under the reveal line.
  - More than one meme in any 10 seconds, or any over the reveal.

  ## How to tell it's working
  - The hook makes you need to know how it happened.
  - The pace visibly quickens through the escalation.
  - There's a real beat of silence before the reveal, and the reveal gets the biggest move of the video.
  `,
  { looks: [CAMPFIRE], graphics: [CHAPTER_CARD] },
);

const TUTORIAL = pack(
  "tutorial",
  {
    name: "Clear tutorial",
    description: "Show the result, then the steps, each one impossible to miss",
    bestFor: ["Tutorials and how-to", "Screen recordings", "Recipes and DIY", "Software tips"],
    energy: 3,
    length: "30-90s",
    tags: ["steps", "zoom to detail", "result first", "save-worthy"],
    settings: {
      checkRules: { maxShot: 8, pace: 4, deadAir: 0.8, hookWithin: 2 },
      captionStyle: {
        look: "guide",
        preset: "plain",
        uppercase: false,
        size: 54,
        maxWords: 5,
        minWords: 2,
        pauseBreak: 0.5,
        maxPageSeconds: 2.6,
      },
      mix: { loudness: -14, pauses: { sentence: 0.34, phrase: 0.2, word: 0.12 } },
      music: { volume: 0.14, duckTo: 0.2 },
      look: { grade: "clean", vignette: false, drift: false },
    },
  },
  `
  # Clear tutorial

  ## The idea
  Someone should be able to follow along, pausing, and get the result. Clarity beats energy: every step is labelled, every click or detail is shown close up, and dead time (loading, typing, waiting, stirring) is gone. The finished result comes first, so they know it's worth watching.

  ## Structure
  1. The result (0-2s): show what they'll end up with (the finished dish, the working feature, the edited photo), with a title that names it and the effort ("Clean audio in 3 steps").
  2. The steps, in order, each opened by its step-badge ("Step 2 of 4", the step in a few words, the progress bar) held for the step. One idea per step.
  3. The recap: the steps graphic with every step listed (or a list), 2-3 seconds, the moment people screenshot or save.
  4. Out: one line telling them to try it or save it.

  ## Pacing
  - Each step 4-10 seconds. Speed up anything slow but necessary (typing, loading, cooking) to 2-4x, or cut it with a jump.
  - Cut every hesitation, but keep a short beat after each step lands so it sinks in.
  - Never hold a wide view of a screen for more than about 3 seconds: zoom in on what matters.

  ## Captions
  The Guide look: clear sentence-case lines on a soft dark plate, five words a page, readable over any screen. Emphasize the exact name of the thing to click, the setting, the ingredient, the number.

  ## Motion
  - On screen recordings: zoom into the region being used (scale 1.4-1.8, ease smooth, focus on the cursor or the button) for the duration of the action, then back out.
  - On camera footage: a gentle push (1.08) when showing a detail.
  - No drift on screen recordings (it makes text swim), no shakes, no glitches.

  ## Visuals
  - step-badge to mark each step, steps for the recap; callout for a warning or a tip ("don't skip this"); number for measurements and results.
  - Keyboard shortcuts and settings as a kinetic or callout overlay when they're said.
  - Before and after: compare in a split at the end, when the result is a change.

  ## Sound
  A light, unobtrusive bed (lo-fi, soft electronic), low under the voice. A soft click or tap on clicks, a ding when a step is done. Nothing loud.

  ## Look
  Clean grade, no vignette, no drift. Screens must stay sharp and readable.

  ## Make the footage better
  - Screen recordings: crop out the desktop clutter and dock, zoom to the window being used, and speed up anything that waits (loading, typing, exporting) to 2-4x or jump it.
  - Readability beats beauty: never drift or blur a screen, and keep captions on their plate so they read over white UIs.
  - On camera: steady framing on the hands or the work surface, a gentle push into the detail being explained.
  - Sound: bright, close and clean (voiceTone bright), clicks kept subtle.

  ## Avoid
  - Skipping a step people need, even if it's boring (speed it up instead).
  - Graphics covering the part of the screen being used.
  - Fast cuts that make it impossible to follow.

  ## How to tell it's working
  - The result is visible in the first two seconds.
  - Every step has a marker on screen when it starts.
  - Every click or detail being described is shown close enough to read on a phone.
  `,
  { looks: [GUIDE], graphics: [STEP_BADGE] },
);

const HYPE_MONTAGE = pack(
  "hype-montage",
  {
    name: "Hype montage",
    description: "Beat-driven highlight reel: cut to the music, ramp into the action",
    bestFor: ["Sports and events", "Travel recaps", "Highlights", "Launches and trailers"],
    energy: 5,
    length: "15-45s",
    tags: ["beat sync", "speed ramps", "music-led", "no talking"],
    settings: {
      // The hero hold at the end runs 2-3s; everything else is far shorter (the brief says so).
      checkRules: {
        maxShot: 3.2,
        minShot: 0.25,
        pace: 3.2,
        deadAir: 0.6,
        beatTolerance: 0.03,
        sfxGap: 1.2,
        hookWithin: 1,
      },
      captionStyle: { speech: false },
      mix: { loudness: -11, musicLevel: 1.3, entrySounds: false },
      music: { volume: 0.85, duckTo: 0.5, lockToBeat: true, fadeIn: 0, fadeOut: 1 },
      look: { grade: "punchy", vignette: true, vignetteStrength: 0.5, drift: false, jumpZoom: 1.1 },
    },
  },
  `
  # Hype montage

  ## The idea
  The music is the script. Every cut, hit and move lands on the track, and the footage is ordered to build with it: a teaser, a build, the drop where everything hits hardest, and a hero ending. Energy is earned by contrast: slow-motion against fast cuts, a moment of silence against the drop.

  ## Structure
  Map the track first (listen): its build, its drop, its outro.
  1. Cold open (0-1s): the single biggest moment, a flash of it, then black or a hard cut to the start.
  2. The build (until the drop): wider, establishing shots, cut every beat or every second beat, energy rising.
  3. The drop: the best action, cut on every beat (or half beat at the hardest part), with the biggest moves.
  4. Hero ending: the best shot held in slow motion (0.5) for 2-3 seconds, then a title or the logo on the last downbeat, the music resolving.

  ## Pacing
  - Shots of 0.4-1.6 seconds (only the hero ending holds longer), every cut on a beat (lock to beat is on). Use the track's sections: don't cut at the same rate all the way through.
  - Speed ramps into the action (scene.ramp: normal, slow to 0.3 on the moment, snap to 2 back out) on the drop's best moments, two or three a video.
  - Pick moments of peak action only; trim every shot to its most dynamic part.

  ## Captions
  No speech captions. Text arrives on the beat: the beat-title (one word per beat) for the title or the drop, a location, a score or a date, sparingly.

  ## Motion
  - Transitions on the drop and section changes: whip-pan following the direction of motion, zoom-through into a new scene, flash-cut on a downbeat. Hard cuts everywhere else.
  - A shake with an impact on the biggest hits; rgb-split or glitch on one or two drop beats, 4-8 frames.
  - Punch zooms (1.15-1.3, ease punch) landing on beats during the drop.

  ## Visuals
  Minimal: a beat-title at the start or on the drop, maybe a stat (number) if it's a sports highlight. No memes, no lists.

  ## Sound
  The track drives everything and sits loud. A riser into the drop, impacts (boom) on the drop and on big hits, crowd or engine sound brought in under the music with J-cuts (audioLead) on big moments. Loud mix (-11 LUFS).

  ## Look
  Punchy grade with a strong vignette; locked-off frames (no drift), the movement comes from the footage and the cuts.

  ## Make the footage better
  - Every shot trimmed to its peak motion; shaky or empty starts gone.
  - Crop to the action for the vertical frame (reframe follow on moving subjects), so the subject fills it.
  - Contrast and colour from the grade, but match clips first so the cut doesn't flicker between cameras.
  - Speed: ramps into the big moments, 2-3x on anything that's slow but needed, and the hero shot slowed to 0.5.
  - Real sound of the moment (a roar, an engine, a crowd) brought up under the music with a J-cut.

  ## Avoid
  - Cuts that miss the beat; shots that run past their best moment.
  - Talking that fights the music (duck the music hard under any line that stays in).
  - The same transition twice in a row, or transitions on every cut.

  ## How to tell it's working
  - Every cut and hit lands on a beat (the beat check passes).
  - The drop is the densest, most energetic stretch.
  - The ending holds long enough to feel final.
  `,
  { graphics: [BEAT_TITLE] },
);

const NEWS_COMMENTARY = pack(
  "news-commentary",
  {
    name: "News commentary",
    description: "Fast, sourced take on what just happened, with the receipts on screen",
    bestFor: ["News and commentary", "Tech and business news", "Reactions with sources", "Explainers"],
    energy: 4,
    length: "30-75s",
    tags: ["sources on screen", "headline hook", "split screens", "credible"],
    settings: {
      checkRules: { maxShot: 3.5, pace: 4, deadAir: 0.7, hookWithin: 1.5 },
      captionStyle: {
        look: "headline",
        preset: "plain",
        uppercase: true,
        size: 76,
        maxWords: 3,
        minWords: 1,
        pauseBreak: 0.35,
        maxPageSeconds: 1.8,
      },
      mix: { loudness: -13, pauses: { sentence: 0.32, phrase: 0.18, word: 0.11 } },
      music: { volume: 0.16, duckTo: 0.18 },
      look: { grade: "clean", vignette: false, jumpZoom: 1.1 },
    },
  },
  `
  # News commentary

  ## The idea
  What happened, why it matters, and what the speaker thinks, in under a minute, with the receipts on screen. Credibility is the style: every claim is backed by the real headline, post or document, shown while it's discussed. Energetic, but never cheap.

  ## Structure
  1. Headline hook (0-1.5s): the news in six words or fewer as a title over the speaker ("Apple just killed the iPhone mini"), on the most dramatic line.
  2. The facts: what happened, with the source on screen (capture_page of the article, post or announcement, the quoted sentence highlighted) in a split while it's said.
  3. Why it matters: context, numbers, a comparison.
  4. The take: the speaker's opinion, on their face, no visuals over it.
  5. Out: a question to the viewer or the one-line verdict.

  ## Pacing
  - Cut hesitations and repetitions; keep the speaker's urgency.
  - Alternate: face (the take), source (the facts), face. A source on screen 2-3 seconds, never longer than the line about it.
  - Something changes every 3-4 seconds.

  ## Captions
  The Headline look: condensed newsroom caps, an accent bar under the word being said, three words a page. Emphasize names, numbers and the verb of the news ("banned", "bought", "leaked").

  ## Motion
  - A punch-in on each strong claim (1.12-1.2, ease punch).
  - A whip-pan between the news and the take, once or twice.
  - A stamp on a status word ("confirmed", "leaked", "banned") once.

  ## Visuals
  - Real sources first: capture_page with find set to the sentence being quoted, as a split panel or a cutaway. When a page can't be captured or is unreadable, the headline-card restates it (the real outlet, date and headline, the key words marked), never invented.
  - number for figures, compare for before/after or this vs that, trend for a change over time, bars for comparisons of size.
  - Check every fact and number with a web search before it goes on screen.
  - No memes on serious news (layoffs, safety, tragedy); a single reaction meme is fine for lighthearted tech or culture news.

  ## Sound
  A tense, minimal bed (low synth pulse), quiet. Type sounds on text reveals, a ding on a key number, a whoosh on the whip. Sparse.

  ## Look
  Clean grade, no vignette: neutral and trustworthy.

  ## Make the footage better
  - The speaker should look like a host: headroom trimmed (the headroom fix, no tighter, so captions keep clear of the face and the clear-face check passes), a colour cast corrected, a little contrast from the grade, background dimmed or blurred slightly if it's messy (scene.background with cutout) during the take.
  - Splits: sources at full readable width on top, the speaker's face whole in the bottom half; never crop a face in a split.
  - Ums and restarts all go; keep the urgency, not the stumbling.
  - Captures: crop to the headline and the quoted sentence, highlighted; a page that's mostly ads or menus gets cropped or replaced.

  ## Avoid
  - Claims on screen that aren't sourced or checked.
  - Stock footage that only vaguely matches (no hooded hackers, no glowing brains).
  - Visuals over the speaker's actual opinion: let the take land on their face.

  ## How to tell it's working
  - The first frame states the news.
  - Every factual claim has its source on screen while it's said.
  - The take is on camera, uncluttered.
  `,
  { looks: [HEADLINE], graphics: [HEADLINE_CARD] },
);

const PRODUCT_AD = pack(
  "product-ad",
  {
    name: "Creator product ad",
    description: "UGC-style ad: hook, problem, product as the fix, proof, offer",
    bestFor: ["Product demos", "UGC ads", "Brand deals", "Launches"],
    energy: 4,
    length: "15-45s",
    tags: ["hook-problem-solution", "product close-ups", "call to action", "bright"],
    settings: {
      checkRules: { maxShot: 3, pace: 3.5, hookWithin: 1.5, deadAir: 0.6 },
      captionStyle: {
        look: "pop",
        preset: "plain",
        uppercase: false,
        size: 72,
        maxWords: 3,
        minWords: 1,
        pauseBreak: 0.35,
        maxPageSeconds: 1.8,
      },
      mix: { loudness: -12, pauses: { sentence: 0.3, phrase: 0.18, word: 0.11 } },
      music: { volume: 0.3, duckTo: 0.22 },
      look: { grade: "punchy", vignette: false, jumpZoom: 1.1 },
    },
  },
  `
  # Creator product ad

  ## The idea
  A creator-made ad that doesn't feel like one until it has earned the pitch. It follows the shape that sells: stop the scroll, name a real problem, show the product fixing it, prove it, make the offer. The product is seen early and often, close up, in use.

  ## Structure
  1. Hook (0-1.5s): a pattern interrupt with the product visible: a bold result ("my skin in 14 days"), a relatable pain ("I was so tired of tangled cables"), or a surprising demo. Title of 3-6 words on the first frame.
  2. Problem (to ~25%): the frustration, felt, in one or two lines.
  3. The fix (the middle): the product in hand, then two or three benefits, each shown, not told: a close-up demo per benefit.
  4. Proof: a number (a result, a rating, a price comparison), a before and after, or a reaction.
  5. Offer and call to action (last 3s): what to do now (the link, a code, a price), said and on screen. When the footage has no offer or call to action (a review, an unboxing, a collector talking), end on the strongest line about the product instead: never invent one.

  ## Pacing
  - Shots of 1.5-3 seconds; product close-ups shorter, demos as long as they need to be understood.
  - The product appears in the first 3 seconds and in at least every third shot after.
  - Tight speech, no filler; keep genuine reactions.

  ## Captions
  The Pop look: bold rounded words, two or three at a time, the one being said popping a size bigger. Emphasize benefits and numbers. Keep captions clear of the product in frame (move them, or let them sit above).

  ## Motion
  - A punch-in on the product reveal and on each benefit's payoff (1.15-1.25, ease punch).
  - A flash-cut between before and after; a zoom-through into the product's close-up, once.
  - No shakes unless it's part of a demo.

  ## Visuals
  - callout for each benefit (two or three words, key word in *stars*), number for results and prices, compare for before and after, stamp for an offer ("50% off", "sold out").
  - The end-card in the last 2-3 seconds: the call to action, the real offer when there is one, the arrow to where to act, the product visible behind it.

  ## Sound
  An upbeat, current track, moderately loud under speech. A pop on each benefit graphic, a ding (or a cash register) on the price, a whoosh on the reveal. Loud mix (-12 LUFS).

  ## Look
  Punchy, bright grade; skin natural, product colours true. No vignette.

  ## Make the footage better
  - The product is the star: reframe so it's centred and large whenever it's in hand, and push in on its details.
  - Make it pop: a subtle background blur or dim behind the person and product on the reveal and the benefit shots (scene.background, cutout with keep: "subject" so the product stays sharp), true colours (correct casts, a touch more saturation only if it stays truthful).
  - Slow the satisfying moments (a pour, a click, an unboxing reveal) to 0.6-0.75, or ramp into them.
  - Clean, warm, close voice; no room echo.

  ## Avoid
  - Opening on a logo or a brand name.
  - Claims the footage doesn't support; invented numbers.
  - A long call to action: one line, one thing to do.

  ## How to tell it's working
  - The product is on screen within 3 seconds.
  - Each benefit is shown in use, not only described.
  - The last frame says exactly what to do next.
  `,
  { looks: [POP], graphics: [END_CARD] },
);

export const STARTER_INSPIRATIONS: readonly InspirationPack[] = [
  PUNCHY_EXPLAINER,
  PODCAST_CLIP,
  STORYTIME,
  TUTORIAL,
  NEWS_COMMENTARY,
  PRODUCT_AD,
  HYPE_MONTAGE,
  CALM_VLOG,
];
