/**
 * The signature pieces of the built-in inspirations: the caption looks and graphics that give each style
 * its own identity, so following one doesn't just change the rhythm but the whole feel. They come into a
 * project when it follows the style, as ordinary files to edit.
 *
 * Same house rules as the built-in graphics: things arrive fast and settle long, leave quicker than they
 * came, sizes in container units times --s, the accent once per graphic.
 */
import type { CaptionLook, Graphic } from "./schema.ts";
import { graphic } from "./starter-graphics.ts";

const look = (id: string, meta: object, css: string): CaptionLook => ({
  id,
  css: `/* look ${JSON.stringify(meta)} */\n${css.trim().replace(/^ {4}/gm, "")}\n`,
});

const STARS = "Wrap words in *stars* to color them with the accent.";

// --- Caption looks ----------------------------------------------------------------------------------

export const CAMPFIRE = look(
  "campfire",
  {
    name: "Campfire",
    description: "Warm cream words that rise in as they're told; the emotional ones glow in the accent",
    defaults: { maxWords: 4, uppercase: false, size: 66, preset: "plain" },
  },
  `
    .caption {
      font-family: var(--font, "Poppins");
      font-size: var(--size);
      font-weight: 700;
      line-height: 1.12;
      letter-spacing: -0.01em;
      color: #fff6e6;
      text-wrap: balance;
      text-shadow: 0 0.05em 0.3em rgba(20, 8, 0, 0.6), 0 0 0.08em rgba(0, 0, 0, 0.5);
    }
    /* Each word arrives as it's said, rising out of the line. */
    .word { display: inline-block; animation: tell 0.32s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .word.hl { color: var(--accent); text-shadow: 0 0 0.4em color-mix(in srgb, var(--accent) 45%, transparent), 0 0.05em 0.3em rgba(20, 8, 0, 0.6); }
    @keyframes tell { from { opacity: 0; transform: translateY(0.28em); filter: blur(0.05em); } }
    `,
);

export const GUIDE = look(
  "guide",
  {
    name: "Guide",
    description: "Clear sentence-case lines on a soft dark plate: readable over screens and busy footage",
    defaults: { maxWords: 5, uppercase: false, size: 54, preset: "plain" },
  },
  `
    .caption {
      font-family: var(--font, "Inter Tight");
      font-size: var(--size);
      font-weight: 600;
      line-height: 1.28;
      letter-spacing: -0.005em;
      color: var(--color);
      text-wrap: balance;
    }
    /* A plate around the page: readable over a white screen recording or a bright kitchen. */
    .caption {
      width: fit-content;
      max-width: 100%;
      margin-inline: auto;
      background: rgba(12, 12, 14, 0.72);
      padding: 0.14em 0.46em 0.18em;
      border-radius: 0.3em;
      animation: in 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .word.hl { color: var(--accent); }
    .word.next { opacity: 0.62; }
    @keyframes in { from { opacity: 0; transform: translateY(0.15em); } }
    `,
);

export const HEADLINE = look(
  "headline",
  {
    name: "Headline",
    description: "Condensed newsroom caps; the word being said gets an accent underline",
    defaults: { maxWords: 3, uppercase: true, size: 76, preset: "plain" },
  },
  `
    .caption {
      font-family: var(--font, "Anton");
      font-size: var(--size);
      font-weight: 400;
      line-height: 1.04;
      letter-spacing: 0.01em;
      color: var(--color);
      text-wrap: balance;
      text-shadow: 0 0.04em 0 rgba(0, 0, 0, 0.55), 0 0.08em 0.4em rgba(0, 0, 0, 0.6);
    }
    .word { display: inline-block; position: relative; margin: 0 0.06em; }
    /* A bar slides in under the word being said, like a newsroom marker. */
    .word::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0.02em;
      height: 0.09em;
      background: var(--accent);
      transform: scaleX(0);
      transform-origin: left;
    }
    .word.now::after { transform: scaleX(1); }
    .word.hl { color: var(--accent); }
    `,
);

export const POP = look(
  "pop",
  {
    name: "Pop",
    description: "Bold rounded words, two or three at a time; the one being said pops a size bigger",
    defaults: { maxWords: 3, uppercase: false, size: 72, preset: "plain" },
  },
  `
    .caption {
      font-family: var(--font, "Poppins");
      font-size: var(--size);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.015em;
      color: var(--color);
      text-wrap: balance;
      -webkit-text-stroke: calc(var(--size) * 0.08) rgba(0, 0, 0, 0.85);
      paint-order: stroke fill;
      text-shadow: 0 0.06em 0.22em rgba(0, 0, 0, 0.45);
    }
    .word { display: inline-block; margin: 0 0.03em; transform-origin: 50% 80%; }
    .word.now { animation: pop 0.2s cubic-bezier(0.2, 1.7, 0.4, 1) both; transform: scale(1.1); }
    .word.hl { color: var(--accent); }
    @keyframes pop { from { transform: scale(0.85); } }
    `,
);

// --- Graphics ---------------------------------------------------------------------------------------

export const POINT_MARKER: Graphic = graphic(
  "point-marker",
  {
    name: "Point marker",
    description: "Opens each point of an explainer: a big index number slams in beside the point's headline",
    duration: 2.2,
    params: {
      index: { type: "number", label: "Number", default: 1, description: "Which point this is: 1, 2, 3" },
      title: {
        type: "text",
        label: "Point",
        default: "Hook them in *one second*",
        description: `The point in under 7 words. ${STARS}`,
      },
    },
  },
  `
    .wrap { position: absolute; left: 7cqw; right: 7cqw; top: calc(var(--clear-y, .14) * 100cqh);
            display: grid; grid-template-columns: auto 1fr; align-items: center; gap: calc(3.5cqw * var(--s)); }
    .idx { font-size: calc(26cqw * var(--s)); font-weight: 800; line-height: .82; letter-spacing: -.06em;
           color: var(--accent); font-variant-numeric: tabular-nums;
           animation: slam .42s cubic-bezier(.2,1.5,.4,1) both; }
    .rule { width: calc(.9cqw * var(--s)); align-self: stretch; background: rgba(255,255,255,.85);
            transform-origin: top; animation: draw .4s var(--ease) .12s both; }
    .title { font-size: calc(8.4cqw * var(--s)); font-weight: 800; line-height: 1.02; letter-spacing: -.03em; }
    .title .line > span { animation-delay: .16s; }
    .box { display: flex; gap: calc(3.5cqw * var(--s)); align-items: center; }
    @keyframes slam { from { opacity: 0; transform: scale(1.6) translateY(-2cqh); filter: blur(1cqw); } }
    @keyframes draw { from { transform: scaleY(0); } }
  `,
  `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="wrap place shadow">
    <div class="idx">{{index}}</div>
    <div class="box"><div class="rule"></div>
      <div class="title"><span class="line"><span>{{title}}</span></span></div></div>
  </div>
</div></div>`,
);

export const TOPIC_BANNER: Graphic = graphic(
  "topic-banner",
  {
    name: "Topic banner",
    description:
      "The clip's topic pinned at the top for its whole run, the classic podcast-clip frame, with an optional show label. A visual lasts 15s at most: for a longer clip, place segments back to back with continues on every one after the first and holds on every one before the last, so it reads as one banner",
    duration: 15,
    params: {
      show: { type: "text", label: "Show", default: "", description: "The show or episode, small, optional" },
      topic: {
        type: "text",
        label: "Topic",
        default: "Why he quit a *$400k* job",
        description: `The clip's tension in under 8 words. ${STARS}`,
      },
      continues: {
        type: "boolean",
        label: "Continues",
        default: false,
        description: "This segment picks up from the one before: no entrance",
      },
      holds: {
        type: "boolean",
        label: "Holds",
        default: false,
        description: "The next segment carries on: no exit",
      },
    },
  },
  `
    /* A soft shade at the top so the banner reads over a bright set. */
    .top { position: absolute; inset: 0 0 auto 0; height: 30cqh;
           background: linear-gradient(180deg, rgba(0,0,0,.5), rgba(0,0,0,.18) 55%, transparent); animation: fade .4s var(--ease) both; }
    .bar { position: absolute; left: 6cqw; right: 6cqw; top: 6.5cqh; padding: calc(2.4cqw * var(--s)) calc(4cqw * var(--s));
           border-radius: calc(2.6cqw * var(--s)); text-align: center;
           animation: drop .55s var(--ease) both; }
    .show { font-size: calc(2.7cqw * var(--s)); font-weight: 700; letter-spacing: .2em; text-transform: uppercase;
            color: rgba(255,255,255,.6); margin-bottom: calc(1cqw * var(--s)); }
    .topic { font-size: calc(5.6cqw * var(--s)); font-weight: 800; line-height: 1.08; letter-spacing: -.02em; text-wrap: balance; }
    .topic .line > span { animation-delay: .12s; }
    /* Segments chained into one banner: no entrance after the first, no exit before the last. */
    .holds .out { animation: none; }
    .continues .top, .continues .bar, .continues .line > span { animation: none !important; }
    @keyframes drop { from { opacity: 0; transform: translateY(-3cqh) scale(.97); } }
  `,
  `
<div class="stage {{#continues}}continues{{/continues}} {{#holds}}holds{{/holds}}"><div class="out">
  <div class="top"></div>
  <div class="bar glass">
    {{#show}}<div class="show">{{show}}</div>{{/show}}
    <div class="topic"><span class="line"><span>{{topic}}</span></span></div>
  </div>
</div></div>`,
);

export const CHAPTER_CARD: Graphic = graphic(
  "chapter-card",
  {
    name: "Chapter card",
    description: "A time jump in a story: cinematic bars close in around a small label and a title",
    duration: 2.4,
    params: {
      kicker: { type: "text", label: "Label", default: "Part two", description: "Small, above. Optional." },
      title: {
        type: "text",
        label: "Title",
        default: "Three weeks *later*",
        description: `The jump, in under 5 words. ${STARS}`,
      },
    },
  },
  `
    .bars::before, .bars::after { content: ""; position: absolute; left: 0; right: 0; height: 13cqh; background: #000;
                                  animation: close .6s var(--ease) both; }
    .bars::before { top: 0; transform-origin: top; }
    .bars::after { bottom: 0; transform-origin: bottom; }
    .dim { position: absolute; inset: 0; background: rgba(0,0,0,.42); animation: fade .5s var(--ease) both; }
    .wrap { position: absolute; left: 8cqw; right: 8cqw; top: 0; bottom: 0; margin-block: auto; height: fit-content;
            text-align: center; }
    .kicker { font-size: calc(3cqw * var(--s)); font-weight: 600; letter-spacing: .32em; text-transform: uppercase;
              color: rgba(255,255,255,.72); margin-bottom: calc(2.2cqw * var(--s)); animation: rise .5s var(--ease) .1s both; }
    .title { font-size: calc(9.5cqw * var(--s)); font-weight: 700; line-height: 1; letter-spacing: -.035em; }
    .title .line > span { animation-delay: .2s; }
    .rule { width: calc(12cqw * var(--s)); height: 2px; margin: calc(3cqw * var(--s)) auto 0; background: var(--accent);
            transform-origin: center; animation: grow .5s var(--ease) .38s both; }
    @keyframes close { from { transform: scaleY(0); } }
    @keyframes grow { from { transform: scaleX(0); } }
  `,
  `
<div class="stage"><div class="out">
  <div class="dim"></div><div class="bars"></div>
  <div class="wrap shadow">
    {{#kicker}}<div class="kicker">{{kicker}}</div>{{/kicker}}
    <div class="title"><span class="line"><span>{{title}}</span></span></div>
    <div class="rule"></div>
  </div>
</div></div>`,
);

export const STEP_BADGE: Graphic = graphic(
  "step-badge",
  {
    name: "Step badge",
    description: "Which step of a tutorial this is: a compact badge with a progress bar, held for the step",
    duration: 6,
    params: {
      step: { type: "number", label: "Step", default: 2 },
      of: { type: "number", label: "Of", default: 4, description: "How many steps there are" },
      title: {
        type: "text",
        label: "Step",
        default: "Turn on noise removal",
        description: "The step in under 6 words",
      },
    },
  },
  `
    .badge { position: absolute; left: 6cqw; top: 7cqh; max-width: 74cqw; padding: calc(2.2cqw * var(--s)) calc(3.4cqw * var(--s)) calc(2.6cqw * var(--s));
             border-radius: calc(2.4cqw * var(--s)); animation: slide .5s var(--ease) both; }
    .count { display: flex; align-items: baseline; gap: calc(1.4cqw * var(--s)); font-size: calc(2.7cqw * var(--s)); font-weight: 700;
             letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,.62); }
    .count b { color: var(--accent); font-size: 1.25em; letter-spacing: 0; }
    .title { margin-top: calc(1cqw * var(--s)); font-size: calc(5cqw * var(--s)); font-weight: 700; line-height: 1.1; letter-spacing: -.02em; }
    .title .line > span { animation-delay: .1s; }
    .track { margin-top: calc(2.2cqw * var(--s)); height: calc(.7cqw * var(--s)); border-radius: 99px; background: rgba(255,255,255,.16); overflow: hidden; }
    .fill { height: 100%; width: calc(var(--progress-of) * 100%); background: var(--accent); border-radius: 99px;
            transform-origin: left; animation: fill .7s var(--ease) .2s both; }
    @keyframes slide { from { opacity: 0; transform: translateX(-4cqw); } }
    @keyframes fill { from { transform: scaleX(calc(var(--prev-of, 0) / max(var(--progress-of), .01))); } }
  `,
  `
<div class="stage"><div class="out">
  <div class="badge glass" style="--progress-of: calc({{step}} / {{of}}); --prev-of: calc(({{step}} - 1) / {{of}})">
    <div class="count">Step <b>{{step}}</b> of {{of}}</div>
    <div class="title"><span class="line"><span>{{title}}</span></span></div>
    <div class="track"><div class="fill"></div></div>
  </div>
</div></div>`,
);

export const HEADLINE_CARD: Graphic = graphic(
  "headline-card",
  {
    name: "Headline card",
    description:
      "A news headline as a card: the outlet and date, the headline, and a marker sweeping across the key words",
    duration: 3.2,
    params: {
      outlet: {
        type: "text",
        label: "Outlet",
        default: "The Verge",
        description: "Who reported it. Never invent one.",
      },
      date: { type: "text", label: "Date", default: "", description: "When, short. Optional." },
      headline: {
        type: "text",
        label: "Headline",
        default: "Apple quietly *kills the iPhone mini*",
        description: `The headline as reported (shortened is fine, never changed). ${STARS}`,
      },
    },
  },
  `
    .card { position: absolute; left: 6cqw; right: 6cqw; top: calc(var(--clear-y, .12) * 100cqh);
            padding: calc(3.6cqw * var(--s)) calc(4.4cqw * var(--s)); border-radius: calc(2.6cqw * var(--s));
            background: #fbfaf7; color: #121212; box-shadow: 0 3cqw 9cqw rgba(0,0,0,.45);
            animation: card .55s var(--ease) both; }
    .meta { display: flex; justify-content: space-between; align-items: center; font-size: calc(2.8cqw * var(--s)); font-weight: 700;
            letter-spacing: .14em; text-transform: uppercase; color: #6b6b6b; margin-bottom: calc(2cqw * var(--s)); }
    .meta .outlet { color: #121212; }
    .meta .outlet::before { content: ""; display: inline-block; width: .55em; height: .55em; margin-right: .5em; border-radius: 50%;
                            background: #e53935; vertical-align: .05em; animation: live 1.1s ease-in-out infinite; }
    .head { font-size: calc(6.4cqw * var(--s)); font-weight: 800; line-height: 1.1; letter-spacing: -.025em; text-wrap: balance; }
    .head .line > span { animation-delay: .12s; }
    /* The marker sweeps across the starred words a beat after the headline lands. */
    .head .hl { color: inherit; background: linear-gradient(transparent 52%, color-mix(in srgb, var(--accent) 75%, transparent) 52%, color-mix(in srgb, var(--accent) 75%, transparent) 92%, transparent 92%);
                background-repeat: no-repeat; background-size: 100% 100%; animation: mark .55s var(--ease) .55s both; }
    @keyframes card { from { opacity: 0; transform: translateY(3cqh) rotate(-1.2deg) scale(.97); } }
    @keyframes mark { from { background-size: 0% 100%; } }
    @keyframes live { 50% { opacity: .35; } }
  `,
  `
<div class="stage"><div class="out">
  <div class="card place">
    <div class="meta"><span class="outlet">{{outlet}}</span>{{#date}}<span>{{date}}</span>{{/date}}</div>
    <div class="head"><span class="line"><span>{{headline}}</span></span></div>
  </div>
</div></div>`,
);

export const END_CARD: Graphic = graphic(
  "end-card",
  {
    name: "End card",
    description:
      "The last beat of an ad: the call to action, an optional offer pill, and an arrow to where to act",
    duration: 3,
    params: {
      offer: {
        type: "text",
        label: "Offer",
        default: "",
        description: "Like 20% off with SAVE20. Only a real one.",
      },
      action: {
        type: "text",
        label: "Call to action",
        default: "Get yours at the *link in bio*",
        description: `What to do now, under 7 words. ${STARS}`,
      },
    },
  },
  `
    .wrap { position: absolute; left: 8cqw; right: 8cqw; top: calc(var(--clear-y, .16) * 100cqh); text-align: center; }
    .offer { display: inline-block; margin-bottom: calc(3cqw * var(--s)); padding: calc(1.4cqw * var(--s)) calc(3.6cqw * var(--s));
             border-radius: 99px; background: var(--accent); color: #111; font-size: calc(3.8cqw * var(--s)); font-weight: 800;
             animation: pill .45s cubic-bezier(.2,1.5,.4,1) both; position: relative; overflow: hidden; }
    /* One light sweep across the offer. */
    .offer::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.65) 50%, transparent 70%);
                    transform: translateX(-120%); animation: shine .9s ease-in-out .5s both; }
    .action { font-size: calc(10.5cqw * var(--s)); font-weight: 800; line-height: 1; letter-spacing: -.035em; }
    .action .line > span { animation-delay: .1s; }
    .arrow { width: calc(14cqw * var(--s)); margin: calc(5cqw * var(--s)) auto 0; animation: point 1s var(--ease) .45s both; }
    .arrow path { fill: none; stroke: #fff; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
    @keyframes pill { from { opacity: 0; transform: scale(.7); } }
    @keyframes shine { to { transform: translateX(120%); } }
    @keyframes point { 0% { opacity: 0; transform: translateY(-2cqh); } 60% { opacity: 1; transform: translateY(1cqh); } 100% { transform: translateY(0); } }
  `,
  `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="wrap place shadow">
    {{#offer}}<div class="offer">{{offer}}</div>{{/offer}}
    <div class="action"><span class="line"><span>{{action}}</span></span></div>
    <svg class="arrow" viewBox="0 0 100 100"><path d="M50 10 V82 M22 56 L50 84 L78 56"/></svg>
  </div>
</div></div>`,
);

export const BEAT_TITLE: Graphic = graphic(
  "beat-title",
  {
    name: "Beat title",
    description:
      "Big condensed words that slam in one per beat of the music, for a montage's title or a drop",
    duration: 2.6,
    params: {
      words: {
        type: "list",
        label: "Words",
        default: ["Go", "for", "*launch*"],
        description: `One to five words, each arriving on its own beat. ${STARS}`,
      },
    },
  },
  `
    .wrap { position: absolute; left: 6cqw; right: 6cqw; top: 0; bottom: 0; margin-block: auto; height: fit-content; text-align: center; }
    .w { display: inline-block; margin: 0 .12em; font-family: "Anton", var(--font); font-size: calc(17cqw * var(--s));
         line-height: .95; text-transform: uppercase; letter-spacing: .01em;
         /* One beat apart: the music's tempo when there is one, a punchy 0.33s when not. */
         animation: slam .26s cubic-bezier(.2,1.4,.4,1) both; animation-delay: calc(var(--i) * var(--beat, .33s)); }
    @keyframes slam { 0% { opacity: 0; transform: scale(1.9); filter: blur(1.4cqw); } 70% { opacity: 1; filter: blur(0); } 100% { transform: scale(1); } }
  `,
  `
<div class="stage"><div class="out">
  <div class="wrap shadow">{{#words}}<span class="w" style="--i: {{@index}}">{{.}}</span> {{/words}}</div>
</div></div>`,
);

export const PLACE_STAMP: Graphic = graphic(
  "place-stamp",
  {
    name: "Place stamp",
    description: "A quiet lowercase place and time, low on the frame, with a hairline drawing in beside it",
    duration: 3.5,
    params: {
      place: { type: "text", label: "Place", default: "lisbon, portugal" },
      time: { type: "text", label: "Time", default: "sunday, 8:12am", description: "Optional" },
    },
  },
  `
    /* In the slot kept clear of the face and the captions. */
    .wrap { position: absolute; left: 8cqw; top: calc(var(--clear-y, .56) * 100cqh); display: flex; align-items: center; gap: calc(3cqw * var(--s)); }
    .rule { width: calc(10cqw * var(--s)); height: 1px; background: rgba(255,255,255,.85); transform-origin: left;
            animation: draw .9s cubic-bezier(.22,1,.36,1) both; }
    .text { text-transform: lowercase; animation: soft 1.1s cubic-bezier(.22,1,.36,1) .25s both; }
    .place { font-size: calc(5cqw * var(--s)); font-weight: 500; letter-spacing: -.01em; }
    .time { margin-top: calc(.6cqw * var(--s)); font-size: calc(3.2cqw * var(--s)); font-weight: 400; color: rgba(255,255,255,.72); letter-spacing: .02em; }
    .out { animation: settle 1s ease var(--exit) both; }
    @keyframes draw { from { transform: scaleX(0); } }
    @keyframes soft { from { opacity: 0; filter: blur(.6cqw); transform: translateY(1cqh); } }
    @keyframes settle { to { opacity: 0; } }
  `,
  `
<div class="stage"><div class="out">
  <div class="wrap shadow"><div class="rule"></div>
    <div class="text"><div class="place">{{place}}</div>{{#time}}<div class="time">{{time}}</div>{{/time}}</div>
  </div>
</div></div>`,
);
