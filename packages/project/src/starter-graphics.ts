/**
 * The graphics every new project starts with. They are written into the project's graphics/ folder as
 * ordinary .html files: examples to edit, copy and learn from, not a fixed library.
 *
 * House style: things arrive fast and settle long (expo-out), leave quicker than they came, never bounce.
 * Sizes use container units (cqw/cqh) times --s, so one graphic fits everywhere: over the full frame it
 * sits in the upper third; in the top half of a split (a wide panel) it centres and scales up.
 */
import type { Graphic } from "./schema.ts";

/** The shared base every built-in graphic starts from (stage, exits, masks, scrims). */
export const GRAPHIC_BASE = `
  .stage { position: absolute; inset: 0; container: stage / size; font-family: var(--font); color: #fff;
           -webkit-font-smoothing: antialiased; }
  .out { position: absolute; inset: 0; --s: 1; animation: leave .35s cubic-bezier(.7,0,.84,0) var(--exit) both; }
  /* A wide panel is the top half of a split: centre the content and make it bigger. */
  @container stage (min-aspect-ratio: 1 / 1) {
    .out { --s: 1.3; }
    .scrim { display: none; }
    .place { top: 0 !important; bottom: 0 !important; margin-block: auto; height: fit-content; }
  }
  @keyframes leave { to { opacity: 0; transform: translateY(-1.5cqh); } }
  @keyframes rise { from { opacity: 0; transform: translateY(4cqh); } }
  @keyframes fade { from { opacity: 0; } }
  @keyframes mask { from { transform: translateY(110%); } }
  .scrim { position: absolute; inset: 0 0 auto 0; height: 55cqh;
           background: linear-gradient(180deg, rgba(0,0,0,.72), rgba(0,0,0,.35) 55%, transparent);
           animation: fade .4s var(--ease) both; }
  .line { display: block; overflow: hidden; padding-bottom: .12em; margin-bottom: -.12em; }
  .line > span { display: inline-block; text-wrap: balance; animation: mask .7s var(--ease) both; }
  .hl { font-style: normal; color: var(--accent); }
  .shadow { text-shadow: 0 .4cqw 3cqw rgba(0,0,0,.5); }
  .glass { background: rgba(20,20,22,.86); backdrop-filter: blur(40px) saturate(1.6);
           box-shadow: 0 4cqw 10cqw rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08); }
`;

/** A graphic file from its header, its own CSS (over the base) and its markup. */
export const graphic = (id: string, meta: object, css: string, html: string): Graphic => ({
  id,
  html: `<!-- graphic ${JSON.stringify(meta)} -->\n<style>${GRAPHIC_BASE}${css}</style>\n${html.trim()}\n`,
});

const STARS = "Wrap words in *stars* to color them with the accent.";

const STARTERS: Graphic[] = [
  graphic(
    "callout",
    {
      name: "Callout",
      description: "A big statement over the video, with an optional pill above it",
      duration: 2.6,
      params: {
        kicker: {
          type: "text",
          label: "Pill",
          default: "",
          description: "A few words above, like a date or a topic. Optional.",
        },
        title: {
          type: "text",
          label: "Statement",
          default: "This changes *everything*",
          description: `The statement, under 9 words. ${STARS}`,
        },
      },
    },
    `
      .wrap { position: absolute; left: 8cqw; right: 8cqw; top: 15cqh; text-align: center; }
      .pill { display: inline-block; margin-bottom: calc(3cqw * var(--s)); padding: calc(1.2cqw * var(--s)) calc(3.2cqw * var(--s));
              border-radius: 99px; background: rgba(255,255,255,.14); backdrop-filter: blur(20px);
              font-size: calc(3.4cqw * var(--s)); font-weight: 700; color: var(--accent); animation: rise .5s var(--ease) both; }
      .title { font-size: calc(8cqw * var(--s)); font-weight: 700; line-height: 1.04; letter-spacing: -.03em; }
      .title .line > span { animation-delay: .08s; }
    `,
    `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="wrap place shadow">
    {{#kicker}}<div class="pill">{{kicker}}</div>{{/kicker}}
    <div class="title"><span class="line"><span>{{title}}</span></span></div>
  </div>
</div></div>`,
  ),
  graphic(
    "number",
    {
      name: "Number",
      description: "A figure that counts up, with a label and an optional trend line",
      duration: 3,
      params: {
        value: {
          type: "number",
          label: "Number",
          default: 1000000,
          description: "The figure the speaker says. Never invent one.",
        },
        prefix: { type: "text", label: "Before", default: "$" },
        suffix: { type: "text", label: "After", default: "", description: "Like %, x or k" },
        decimals: { type: "number", label: "Decimals", default: 0 },
        label: {
          type: "text",
          label: "Label",
          default: "raised in one week",
          description: `What the number is. ${STARS}`,
        },
        trend: { type: "choice", label: "Trend", options: ["", "up", "down"], default: "" },
      },
    },
    `
      .wrap { position: absolute; left: 6cqw; right: 6cqw; top: 13cqh; display: flex; flex-direction: column; align-items: center; }
      .glow { position: absolute; top: 2cqh; width: 70cqw; height: 22cqh; border-radius: 50%; filter: blur(6cqw);
              background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 55%, transparent), transparent);
              animation: fade .8s var(--ease) both; }
      .n { position: relative; font-size: calc(19cqw * var(--s)); font-weight: 700; letter-spacing: -.05em; line-height: 1;
           font-variant-numeric: tabular-nums; animation: rise .5s var(--ease) both;
           color: #fff; filter: drop-shadow(0 .5cqw 3cqw rgba(0,0,0,.6)); }
      .label { position: relative; margin-top: 2.4cqw; font-size: calc(4.8cqw * var(--s)); font-weight: 600; color: rgba(255,255,255,.9); }
      .label .line > span { animation-delay: .25s; }
      svg { margin-top: 2.4cqw; width: calc(44cqw * var(--s)); height: calc(10cqw * var(--s)); overflow: visible; }
      path { fill: none; stroke-width: 1.1; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1;
             animation: draw 1s cubic-bezier(.65,0,.35,1) .2s forwards; }
      .up path { stroke: #30D158; } .down path { stroke: #FF453A; }
      @keyframes draw { to { stroke-dashoffset: 0; } }
    `,
    `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="wrap place shadow">
    <div class="glow"></div>
    <div class="n">{{prefix}}<span data-count="{{value}}" data-decimals="{{decimals}}" data-count-duration="1.1">0</span>{{suffix}}</div>
    <div class="label"><span class="line"><span>{{label}}</span></span></div>
    {{#trend}}<svg class="{{trend}}" viewBox="0 0 56 16"><path pathLength="1" d="M0 14 L8 13 L14 12 L22 10 L30 8 L38 5 L46 3 L56 1" /></svg>{{/trend}}
  </div>
</div></div>`,
  ),
  graphic(
    "list",
    {
      name: "List",
      description: "Two to five points that land one after another",
      duration: 4,
      params: {
        title: { type: "text", label: "Heading", default: "Three things" },
        items: {
          type: "list",
          label: "Points",
          default: ["First point", "Second point", "Third point"],
          description: `Short points, 2-5 words each. ${STARS}`,
        },
      },
    },
    `
      .wrap { position: absolute; left: 9cqw; right: 9cqw; top: 13cqh; display: flex; gap: 3.4cqw; }
      .rule { width: .6cqw; border-radius: 1cqw; background: linear-gradient(180deg, var(--accent), transparent);
              transform-origin: top; animation: grow 1.2s cubic-bezier(.65,0,.35,1) both; }
      @keyframes grow { from { transform: scaleY(0); } }
      .head { font-size: calc(3.8cqw * var(--s)); font-weight: 600; color: rgba(255,255,255,.62); margin-bottom: 1.6cqw; animation: rise .5s var(--ease) both; }
      .item { font-size: calc(7cqw * var(--s)); font-weight: 700; line-height: 1.1; letter-spacing: -.02em; margin-bottom: 1.8cqw; }
      .item .line > span { animation-delay: calc(.15s + var(--i) * .45s); }
    `,
    `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="wrap place shadow">
    <div class="rule"></div>
    <div>
      {{#title}}<div class="head">{{title}}</div>{{/title}}
      {{#items}}<div class="item" style="--i: {{@index}}"><span class="line"><span>{{.}}</span></span></div>{{/items}}
    </div>
  </div>
</div></div>`,
  ),
  graphic(
    "steps",
    {
      name: "Steps",
      description: "A short sequence, each step connected to the next",
      duration: 4,
      params: {
        items: {
          type: "list",
          label: "Steps",
          default: ["Record", "Drop it in", "Post"],
          description: "2-5 steps of 1-3 words; the last one is highlighted.",
        },
      },
    },
    `
      .wrap { position: absolute; left: 10cqw; right: 10cqw; top: 12cqh; display: flex; flex-direction: column; align-items: center; }
      .unit { display: flex; flex-direction: column; align-items: center; }
      .step { padding: calc(2.6cqw * var(--s)) calc(6cqw * var(--s)); border-radius: calc(3.4cqw * var(--s)); background: rgba(28,28,30,.82);
              backdrop-filter: blur(30px); font-size: calc(5.6cqw * var(--s)); font-weight: 700; box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
              animation: rise .5s var(--ease) both; animation-delay: calc(var(--i) * .4s); }
      .unit:last-child .step { background: var(--accent); color: #111; }
      .unit:first-child .link { display: none; }
      .link { width: .5cqw; height: calc(4cqw * var(--s)); margin: 1.2cqw 0; background: rgba(255,255,255,.5); transform-origin: top;
              animation: grow .3s cubic-bezier(.65,0,.35,1) both; animation-delay: calc(var(--i) * .4s - .15s); }
      @keyframes grow { from { transform: scaleY(0); } }
    `,
    `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="wrap place">
    {{#items}}<div class="unit" style="--i: {{@index}}"><div class="link"></div><div class="step">{{.}}</div></div>{{/items}}
  </div>
</div></div>`,
  ),
  graphic(
    "quote",
    {
      name: "Quote",
      description: "Someone's words, with who said them",
      duration: 3.5,
      params: {
        text: {
          type: "text",
          label: "Quote",
          default: "We had no idea it would *get out*.",
          description: `Their exact words. ${STARS}`,
        },
        source: { type: "text", label: "Who said it", default: "" },
      },
    },
    `
      .wrap { position: absolute; left: 9cqw; right: 9cqw; top: 13cqh; }
      .mark { font-size: calc(24cqw * var(--s)); line-height: .6; font-weight: 700; color: var(--accent); animation: fade .4s var(--ease) both; }
      .text { margin-top: 2cqw; font-size: calc(6.6cqw * var(--s)); font-weight: 700; line-height: 1.16; letter-spacing: -.02em; }
      .text .line > span { animation-delay: .12s; }
      .src { margin-top: 3cqw; font-size: calc(4cqw * var(--s)); font-weight: 600; color: rgba(255,255,255,.65); animation: rise .5s var(--ease) .4s both; }
    `,
    `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="wrap place shadow">
    <div class="mark">“</div>
    <div class="text"><span class="line"><span>{{text}}</span></span></div>
    {{#source}}<div class="src">— {{source}}</div>{{/source}}
  </div>
</div></div>`,
  ),
  graphic(
    "bars",
    {
      name: "Bars",
      description: "Compare a few quantities; bars grow to scale",
      duration: 3.5,
      params: {
        title: { type: "text", label: "Heading", default: "Users in the first month" },
        items: {
          type: "list",
          label: "Bars",
          default: [
            { label: "Them", value: 120 },
            { label: "Us", value: 410 },
          ],
          description: "2-5 of {label, value}; the last one is highlighted.",
        },
        unit: { type: "text", label: "Unit", default: "" },
      },
    },
    `
      .card { position: absolute; left: 6cqw; right: 6cqw; top: 13cqh; padding: calc(5cqw * var(--s)); border-radius: 5cqw; animation: rise .55s var(--ease) both; }
      .head { font-size: calc(5.4cqw * var(--s)); font-weight: 700; letter-spacing: -.02em; margin-bottom: calc(4cqw * var(--s)); }
      .row { margin-bottom: calc(3.2cqw * var(--s)); }
      .meta { display: flex; justify-content: space-between; font-size: calc(4.4cqw * var(--s)); font-weight: 600; margin-bottom: 1.2cqw; }
      .track { height: calc(3cqw * var(--s)); border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
      .fill { height: 100%; border-radius: 99px; background: rgba(235,235,245,.35); transform-origin: left;
              animation: bar .9s var(--ease) both; animation-delay: calc(.25s + var(--i) * .18s); }
      .row:last-child .fill { background: var(--accent); }
      @keyframes bar { from { transform: scaleX(0); } }
    `,
    `
<div class="stage"><div class="out">
  <div class="card glass place">
    <div class="head">{{title}}</div>
    {{#items}}<div class="row">
      <div class="meta"><span>{{label}}</span><span>{{value}}{{unit}}</span></div>
      <div class="track"><div class="fill" data-bar="{{value}}" style="--i: {{@index}}"></div></div>
    </div>{{/items}}
  </div>
</div></div>`,
  ),
  graphic(
    "compare",
    {
      name: "Compare",
      description: "Two sides, marked bad and good",
      duration: 4,
      params: {
        leftTitle: { type: "text", label: "Left heading", default: "Before" },
        left: {
          type: "list",
          label: "Left points (bad)",
          default: ["Slow", "Manual"],
          description: "1-4 short points, 1-3 words each",
        },
        rightTitle: { type: "text", label: "Right heading", default: "After" },
        right: {
          type: "list",
          label: "Right points (good)",
          default: ["Instant", "Automatic"],
          description: "1-4 short points, 1-3 words each",
        },
      },
    },
    `
      .card { position: absolute; left: 5cqw; right: 5cqw; top: 13cqh; display: flex; gap: 4cqw; padding: calc(5cqw * var(--s)) 5cqw;
              border-radius: 5cqw; animation: rise .55s var(--ease) both; }
      .side { flex: 1; min-width: 0; }
      .divider { width: 1px; background: linear-gradient(180deg, transparent, rgba(255,255,255,.3), transparent); }
      h3 { margin: 0 0 calc(3.4cqw * var(--s)); font-size: calc(5.8cqw * var(--s)); font-weight: 700; letter-spacing: -.02em; }
      .item { display: flex; align-items: center; gap: 2.4cqw; margin-bottom: calc(2.8cqw * var(--s)); font-size: calc(4.8cqw * var(--s));
              font-weight: 600; line-height: 1.15; animation: rise .45s var(--ease) both; animation-delay: calc(var(--d) + var(--i) * .18s); }
      .dot { flex: none; width: calc(6cqw * var(--s)); height: calc(6cqw * var(--s)); border-radius: 50%; display: grid; place-items: center;
             font-size: calc(3.4cqw * var(--s)); font-weight: 700; }
      .bad .dot { background: rgba(255,69,58,.18); color: #FF453A; }
      .good .dot { background: rgba(48,209,88,.18); color: #30D158; }
    `,
    `
<div class="stage"><div class="out">
  <div class="card glass place">
    <div class="side bad" style="--d: .2s"><h3>{{leftTitle}}</h3>{{#left}}<div class="item" style="--i: {{@index}}"><span class="dot">✕</span>{{.}}</div>{{/left}}</div>
    <div class="divider"></div>
    <div class="side good" style="--d: 1s"><h3>{{rightTitle}}</h3>{{#right}}<div class="item" style="--i: {{@index}}"><span class="dot">✓</span>{{.}}</div>{{/right}}</div>
  </div>
</div></div>`,
  ),
  graphic(
    "lower-third",
    {
      name: "Lower third",
      description: "Who is talking: a name and a line under it",
      duration: 3.5,
      params: {
        name: { type: "text", label: "Name", default: "Your name" },
        role: { type: "text", label: "Line under it", default: "Founder" },
      },
    },
    `
      .wrap { position: absolute; left: calc(var(--follow-x, .07) * 100cqw); top: calc(var(--follow-y, var(--clear-y, .54)) * 100cqh); opacity: var(--track-visible, 1); display: flex; gap: 2.4cqw; align-items: stretch; }
      .bar { width: 1cqw; border-radius: 1cqw; background: var(--accent); transform-origin: bottom; animation: grow .5s var(--ease) both; }
      @keyframes grow { from { transform: scaleY(0); } }
      .name { font-size: 6.4cqw; font-weight: 700; letter-spacing: -.02em; }
      .name .line > span { animation-delay: .12s; }
      .role { font-size: 3.8cqw; font-weight: 600; color: rgba(255,255,255,.8); }
      .role .line > span { animation-delay: .26s; }
    `,
    `
<div class="stage"><div class="out">
  <div class="wrap shadow">
    <div class="bar"></div>
    <div>
      <div class="name"><span class="line"><span>{{name}}</span></span></div>
      <div class="role"><span class="line"><span>{{role}}</span></span></div>
    </div>
  </div>
</div></div>`,
  ),
  graphic(
    "stamp",
    {
      name: "Stamp",
      description: "A word slammed on screen like a rubber stamp",
      duration: 2,
      params: {
        text: {
          type: "text",
          label: "Word",
          default: "Banned",
          description: "One or two words: Banned, Leaked, Sold out",
        },
      },
    },
    `
      .stamp { position: absolute; left: 50%; top: 28cqh; padding: 1.4cqw 4.4cqw; border: 1.2cqw solid #FF3B30; border-radius: 2.4cqw;
               color: #FF3B30; font-size: calc(11cqw * var(--s)); font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
               white-space: nowrap; background: rgba(255,59,48,.08); transform: translateX(-50%) rotate(-9deg);
               animation: slam .16s cubic-bezier(.7,0,.84,0) both; }
      @keyframes slam { from { opacity: 0; transform: translateX(-50%) rotate(-9deg) scale(1.9); } }
    `,
    `<div class="stage"><div class="out"><div class="stamp">{{text}}</div></div></div>`,
  ),
  // Follows a tracked face or person (visual.follow): the renderer moves --follow-x/--follow-y every frame.
  graphic(
    "name-tag",
    {
      name: "Name tag",
      description:
        "A name and a line under it that follows a person around the frame (set the visual's follow)",
      duration: 3,
      params: {
        name: { type: "text", label: "Name", default: "Christina Koch" },
        role: { type: "text", label: "Line under it", default: "Mission specialist" },
      },
    },
    `
      .tag { position: absolute; left: calc(var(--follow-x, .5) * 100cqw); top: calc(var(--follow-y, .62) * 100cqh);
             transform: translateX(-50%); opacity: var(--track-visible, 1); text-align: center; white-space: nowrap; }
      .card { padding: 1.4cqw 2.8cqw; border-radius: 2cqw; animation: rise .5s var(--ease) both; }
      .name { font-size: calc(5.2cqw * var(--s)); font-weight: 700; letter-spacing: -.01em; }
      .role { font-size: calc(3.2cqw * var(--s)); font-weight: 600; color: var(--accent); margin-top: .4cqw; }
    `,
    `
<div class="stage"><div class="out">
  <div class="tag"><div class="card glass"><div class="name">{{name}}</div><div class="role">{{role}}</div></div></div>
</div></div>`,
  ),
  // Scripted: a GSAP timeline. The runtime seeks every tween to the video's time, so it's frame accurate.
  graphic(
    "kinetic",
    {
      name: "Kinetic type",
      description: "A statement whose words snap up one after another (GSAP)",
      duration: 3,
      libs: ["gsap"],
      params: {
        text: {
          type: "text",
          label: "Statement",
          default: "Nobody saw *this* coming",
          description: `Under 8 words, said by the speaker. ${STARS}`,
        },
      },
    },
    `
      .words { position: absolute; left: 7cqw; right: 7cqw; top: 13cqh; text-align: center; text-wrap: balance;
               font-size: calc(10cqw * var(--s)); font-weight: 700; line-height: 1.04; letter-spacing: -.03em; }
      .m { display: inline-block; overflow: hidden; vertical-align: top; padding: 0 .05em .12em; margin-bottom: -.12em; }
      .w { display: inline-block; transform-origin: 0 100%; }
    `,
    `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="words place shadow" id="words"></div>
</div></div>
<script>
  // Words in *stars* get the accent; build one masked span per word.
  const box = document.getElementById("words");
  let accent = false;
  for (const raw of String(graphic.params.text || "").split(/\\s+/).filter(Boolean)) {
    let word = raw;
    if (word.startsWith("*")) { accent = true; word = word.slice(1); }
    const closes = /\\*\\W*$/.test(word);
    word = word.replace(/\\*(\\W*)$/, "$1");
    const mask = document.createElement("span");
    mask.className = "m";
    const w = document.createElement("span");
    w.className = accent ? "w hl" : "w";
    w.textContent = word;
    mask.append(w);
    box.append(mask, " ");
    if (closes) accent = false;
  }
  const words = box.querySelectorAll(".w");
  gsap.from(words, { yPercent: 115, rotate: 7, duration: 0.6, ease: "expo.out", stagger: 0.075 });
  // Pulse the accented words' masks, not the words, so the mask doesn't clip them.
  gsap.to([...box.querySelectorAll(".hl")].map((w) => w.parentElement), {
    scale: 1.12, duration: 0.16, ease: "power2.out", yoyo: true, repeat: 1, delay: 0.3 + words.length * 0.075,
  });
</script>`,
  ),
  // Scripted: a canvas drawn from the time alone. f.random is seeded and fresh every frame, so each
  // particle is the same particle on every frame and every render.
  graphic(
    "burst",
    {
      name: "Burst",
      description: "One word pops on screen with a burst of particles (canvas)",
      duration: 2.2,
      params: {
        word: {
          type: "text",
          label: "Word",
          default: "Boom",
          description: "One or two words the speaker hits hard",
        },
      },
    },
    `
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .word { position: absolute; left: 0; right: 0; top: 24cqh; text-align: center; font-size: calc(15cqw * var(--s));
              font-weight: 700; letter-spacing: -.04em; line-height: 1; color: var(--accent);
              animation: pop .5s cubic-bezier(.2,1.5,.4,1) both; }
      @keyframes pop { from { opacity: 0; transform: scale(.4); } }
    `,
    `
<div class="stage"><div class="out">
  <canvas id="sparks"></canvas>
  <div class="word place shadow" id="word">{{word}}</div>
</div></div>
<script>
  const canvas = document.getElementById("sparks");
  const ctx = canvas.getContext("2d");
  const word = document.getElementById("word");
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  graphic.onFrame((t, f) => {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(f.width * dpr)) {
      canvas.width = Math.round(f.width * dpr);
      canvas.height = Math.round(f.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.width, f.height);
    const box = word.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    // A shock ring...
    if (t < 0.6) {
      const p = t / 0.6;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = f.accent;
      ctx.lineWidth = f.width * 0.012 * (1 - p);
      ctx.beginPath();
      ctx.arc(cx, cy, f.width * (0.08 + 0.42 * easeOut(p)), 0, Math.PI * 2);
      ctx.stroke();
    }
    // ...and sparks that fly out, fall a little and fade.
    for (let i = 0; i < 80; i++) {
      const angle = f.random() * Math.PI * 2;
      const reach = (0.12 + f.random() * 0.36) * f.width;
      const size = (0.004 + f.random() * 0.009) * f.width;
      const color = f.random() < 0.7 ? f.accent : "#fff";
      const life = 0.6 + f.random() * 0.7;
      const p = t / life;
      if (p >= 1) continue;
      const e = easeOut(p);
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * reach * e, cy + Math.sin(angle) * reach * e * 0.8 + f.width * 0.1 * p * p,
              size * (1 - p * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
</script>`,
  ),
  // Scripted: a D3 line chart drawn from the time alone (no d3 transitions: they run on timers).
  graphic(
    "trend",
    {
      name: "Trend",
      description: "A line chart that draws itself left to right, ending on the highlighted last value (D3)",
      duration: 4,
      libs: ["d3"],
      params: {
        title: { type: "text", label: "Heading", default: "Monthly revenue" },
        points: {
          type: "list",
          label: "Points",
          default: [
            { label: "Jan", value: 2 },
            { label: "Feb", value: 3.5 },
            { label: "Mar", value: 3.1 },
            { label: "Apr", value: 6.8 },
            { label: "May", value: 12 },
          ],
          description: "3-8 of {label, value}, in order; the last one is called out.",
        },
        unit: { type: "text", label: "Unit", default: "k", description: "After each value, e.g. k, %, M" },
        prefix: { type: "text", label: "Prefix", default: "$", description: "Before each value, e.g. $" },
      },
    },
    `
      .card { position: absolute; left: 6cqw; right: 6cqw; top: 13cqh; padding: calc(5cqw * var(--s)); border-radius: 5cqw; animation: rise .55s var(--ease) both; }
      .head { font-size: calc(5.4cqw * var(--s)); font-weight: 700; letter-spacing: -.02em; }
      .big { font-size: calc(11cqw * var(--s)); font-weight: 800; letter-spacing: -.04em; color: var(--accent); line-height: 1.05; }
      svg { display: block; width: 100%; overflow: visible; margin-top: calc(3cqw * var(--s)); }
      .axis text { fill: rgba(255,255,255,.65); font: 600 36px var(--font); }
    `,
    `
<div class="stage"><div class="out">
  <div class="card glass place">
    <div class="head">{{title}}</div>
    <div class="big" id="big"></div>
    <svg id="chart" viewBox="0 0 1000 520"></svg>
  </div>
</div></div>
<script>
  const pts = (graphic.params.points || []).map((p) => ({ label: String(p.label), value: Number(p.value) || 0 }));
  const unit = graphic.params.unit || "", prefix = graphic.params.prefix || "";
  const fmt = (v) => prefix + (Math.round(v * 10) / 10).toLocaleString() + unit;
  const W = 1000, H = 520, B = 56;
  const svg = d3.select("#chart");
  const x = d3.scalePoint().domain(pts.map((p) => p.label)).range([20, W - 20]);
  const y = d3.scaleLinear().domain([0, d3.max(pts, (p) => p.value) * 1.12 || 1]).range([H - B, 10]);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f5a524";
  const grad = svg.append("defs").append("linearGradient").attr("id", "fade").attr("x2", 0).attr("y2", 1);
  grad.append("stop").attr("offset", 0).attr("stop-color", accent).attr("stop-opacity", 0.35);
  grad.append("stop").attr("offset", 1).attr("stop-color", accent).attr("stop-opacity", 0);
  const clip = svg.append("clipPath").attr("id", "reveal").append("rect").attr("height", H).attr("width", 0);
  svg.append("g").attr("class", "axis").attr("transform", "translate(0," + (H - B + 44) + ")")
    .selectAll("text").data(pts).join("text").attr("x", (p) => x(p.label)).attr("text-anchor", "middle").text((p) => p.label);
  const curve = d3.curveMonotoneX;
  svg.append("path").attr("clip-path", "url(#reveal)").attr("fill", "url(#fade)")
    .attr("d", d3.area().x((p) => x(p.label)).y0(H - B).y1((p) => y(p.value)).curve(curve)(pts));
  svg.append("path").attr("clip-path", "url(#reveal)").attr("fill", "none").attr("stroke", accent).attr("stroke-width", 7)
    .attr("stroke-linecap", "round").attr("d", d3.line().x((p) => x(p.label)).y((p) => y(p.value)).curve(curve)(pts));
  const dots = svg.selectAll("circle").data(pts).join("circle").attr("cx", (p) => x(p.label)).attr("cy", (p) => y(p.value))
    .attr("fill", (p, i) => (i === pts.length - 1 ? accent : "#fff"));
  const big = document.getElementById("big");
  graphic.onFrame((t) => {
    // Draws across from 0.35s to 2.1s; each dot pops as the line reaches it; the headline counts along.
    const k = d3.easeCubicInOut(Math.min(1, Math.max(0, (t - 0.35) / 1.75)));
    const edge = 20 + (W - 40) * k;
    clip.attr("width", edge);
    dots.attr("r", (p, i) => {
      const reach = Math.min(1, Math.max(0, (edge - x(p.label) + 30) / 60));
      return (i === pts.length - 1 ? 13 : 8) * d3.easeBackOut(reach);
    });
    const at = Math.min(pts.length - 1, Math.max(0, Math.floor((edge - 20) / ((W - 40) / Math.max(1, pts.length - 1)))));
    big.textContent = pts.length ? fmt(k >= 1 ? pts[pts.length - 1].value : pts[at].value) : "";
  });
</script>`,
  ),
  // Particles from the runtime (graphic.particles): a pure function of time, so exports match exactly.
  graphic(
    "celebrate",
    {
      name: "Celebrate",
      description: "A headline lands as confetti bursts behind it: a win, a launch, a big number",
      duration: 3.2,
      params: {
        text: {
          type: "text",
          label: "Headline",
          default: "We hit *10k*",
          description: `2-5 words. ${STARS}`,
        },
      },
    },
    `
      .words { position: absolute; left: 6cqw; right: 6cqw; top: 20cqh; text-align: center; text-wrap: balance;
               font-size: calc(12cqw * var(--s)); font-weight: 800; line-height: 1; letter-spacing: -.04em;
               animation: land .6s cubic-bezier(.2,1.4,.4,1) both; animation-delay: .1s; }
      @keyframes land { from { opacity: 0; transform: translateY(6cqh) scale(.85); filter: blur(8px); } }
    `,
    `
<div class="stage"><div class="out">
  <div class="scrim"></div>
  <div class="words place shadow" id="words">{{text}}</div>
</div></div>
<script>
  // Confetti cannons from the bottom corners, fired up and in as the headline lands, behind it.
  graphic.particles({ preset: "confetti", at: 0.2, origin: { x: 0.04, y: 1 }, angle: -62, spread: 16, speed: [1700, 2700], count: 100, behind: true });
  graphic.particles({ preset: "confetti", at: 0.3, origin: { x: 0.96, y: 1 }, angle: -118, spread: 16, speed: [1700, 2700], count: 100, behind: true });
</script>`,
  ),
];

/** Sorted by id: the order a folder listing gives back, so a saved project reopens identically. */
export const STARTER_GRAPHICS: readonly Graphic[] = STARTERS.toSorted((a, b) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
);
