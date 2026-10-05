/**
 * Starting points for STYLE.md, by the kind of video someone makes: offered at onboarding and in
 * Settings → Editing, then edited into their own. Each is plain taste in words, the way a creator would
 * brief an editor; the agent reads it before every edit and adjusts the project's settings to match.
 */

export interface StylePreset {
  readonly id: string;
  readonly name: string;
  /** One line on who it's for. */
  readonly line: string;
  readonly text: string;
}

const head = `# Style

How I like my videos. The agent reads this before every edit, and you can change it any time.
`;

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "talking",
    name: "Talking to camera",
    line: "TikTok, Reels and Shorts where you speak to the lens",
    text: `${head}
- Hook on screen in the first second. Short, plain words.
- Cut every retake, stumble and long pause. Keep the asides that sound like me.
- Fast cuts, nothing over 4 seconds unless someone is talking.
- Punch in on the lines that matter; never two zooms in a row.
- Cuts land on the beat when there is music.
- Warm colors. No emojis in captions.
`,
  },
  {
    id: "podcast",
    name: "Podcast clips",
    line: "Short clips cut from long conversations",
    text: `${head}
- Each clip is one complete thought that stands on its own: a hot take, a story, a laugh. 30 to 60 seconds.
- Open on the strongest line, even if it comes mid-answer. No warm-up, no "so, um".
- Frame whoever is talking; cut to the other person for a real reaction, never just to cut.
- Keep the natural back and forth. Trim crosstalk and long pauses, not the laughs.
- Big, bold captions, a word or two at a time, with the key words highlighted.
- No music under talking. A hook title that teases the payoff without giving it away.
`,
  },
  {
    id: "vlog",
    name: "Vlogs and day in the life",
    line: "Music-led stories told through moments and B-roll",
    text: `${head}
- The music carries it: cuts land on the beat, and the edit breathes with the song.
- Quick B-roll montages between talking bits, 1 to 2 seconds a shot.
- Keep the natural sound moments (a laugh, a door, the coffee pour) and let them play over the music.
- Talking bits stay tight but relaxed; keep the personality.
- Warm, soft, slightly filmic colors. Gentle transitions, never flashy.
- Captions only when I'm speaking, small and low.
`,
  },
  {
    id: "tutorial",
    name: "Tutorials and explainers",
    line: "Teaching something step by step",
    text: `${head}
- Clear beats fast. Each step gets the time it needs to be understood.
- Say the payoff up front: what they'll be able to do by the end.
- Number the steps on screen as titles. Punch in on the detail being shown.
- Keep pauses where I'm demonstrating something; cut the ones where I'm thinking.
- Captions always on, clean and easy to read. Key terms highlighted.
- No meme cutaways or sound effects over instructions. Calm, quiet music, or none.
`,
  },
  {
    id: "comedy",
    name: "Comedy and skits",
    line: "Sketches, bits and punchlines",
    text: `${head}
- Timing is everything: hold the beat before a punchline, cut hard right after it.
- Cut straight into the bit. No intro.
- Hard cuts between characters. Punch in on reactions.
- Sound effects and reaction memes only on the biggest laughs, never to explain a joke.
- No music under dialogue. Captions on, with the punchline word emphasized.
`,
  },
  {
    id: "brand",
    name: "Product and brand",
    line: "Polished videos for a product or business",
    text: `${head}
- Clean and polished. Every shot earns its place; no filler.
- Show the product in the first two seconds, then the problem it solves.
- Smooth, simple transitions. Steady pacing, never frantic.
- Brand colors and fonts on every title. Minimal captions, nothing slangy, no memes.
- Upbeat music, low under speech.
- End on a clear call to action.
`,
  },
  {
    id: "gaming",
    name: "Gaming and streams",
    line: "Highlights cut from gameplay and streams",
    text: `${head}
- Only the hype: cut the loading, the waiting and the dead time.
- Open on the best moment of the clip, then rewind to set it up if it needs it.
- Facecam reactions matter as much as the play. Zoom on big reactions.
- Meme sounds and reaction cutaways are welcome on the big moments, not everywhere.
- Captions keep the slang and the shouting, spelled the way I say it.
`,
  },
  {
    id: "narrated",
    name: "Faceless and narrated",
    line: "Voiceover over stock footage, clips or screen",
    text: `${head}
- Every line of narration gets a shot that shows what's being said.
- A new shot every 2 to 3 seconds; nothing static for long.
- Hook in the first line: a question, a surprising fact or a bold claim.
- Big captions in the middle of the frame, a few words at a time.
- Soft background music that never fights the voice. Light sound effects on transitions.
`,
  },
];
