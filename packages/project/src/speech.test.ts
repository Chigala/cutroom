import { describe, expect, it } from "vitest";
import {
  alignToOnsets,
  alignToSilences,
  applyOps,
  audioPlan,
  captionPages,
  cutWordsOps,
  emptyProject,
  type ProjectDoc,
  rangesFromKeeps,
  replaceTimelineOps,
  replaceWordsOps,
  splitSceneOps,
  spokenWords,
  timelineOf,
  trimSceneOps,
} from "./index.ts";

/** A talking head: a false start, a retake, and a long pause before the last line. */
const text = "so today I want to um so today I want to show you something wild . it took me a week".split(
  " ",
);
function talkingHead(): ProjectDoc {
  let t = 0.5;
  const words = text.map((w, i) => {
    if (i === 6) t += 0.9; // pause before the retake
    if (i === 16) t += 1.4; // long pause before the last sentence
    const word = { text: w, start: Number(t.toFixed(2)), end: Number((t + 0.25).toFixed(2)) };
    t += 0.32;
    return word;
  });
  const base = emptyProject("Talk");
  return {
    ...base,
    sources: [
      {
        id: "cam",
        kind: "video",
        label: "cam",
        path: "/cam.mov",
        duration: 12,
        hdr: false,
        hasAudio: true,
        status: "ready",
        proxy: false,
        speech: true,
        summary: "",
        tags: [],
      },
    ],
    transcripts: [{ id: "cam", language: "en", words }],
    scenes: [{ id: "sc1", source: "cam", in: 0, out: 12, note: "", volume: 1 }],
  };
}

describe("scene speed", () => {
  it("shortens the shot and moves words, splits and anchors with it", () => {
    const doc = talkingHead();
    const fast: ProjectDoc = { ...doc, scenes: [{ ...doc.scenes[0]!, speed: 2 }] };
    expect(timelineOf(fast).duration).toBeCloseTo(6, 5);
    const slow = spokenWords(doc);
    const quick = spokenWords(fast);
    expect(quick[5]!.start).toBeCloseTo(slow[5]!.start / 2, 5);
    // Splitting 3s of output into a 2x shot cuts 6s into the footage.
    const ops = splitSceneOps(fast, "sc1", 3);
    expect(ops[0]).toMatchObject({ op: "update", patch: { out: 6 } });
    const split = applyOps(fast, ops).doc;
    expect(timelineOf(split).duration).toBeCloseTo(6, 5);
    expect(split.scenes[1]).toMatchObject({ in: 6, out: 12, speed: 2 });
  });
});

describe("J- and L-cuts", () => {
  /** Two shots of the same 12s take: 0-5s, then 7-12s. */
  function twoShots(
    a: Partial<ProjectDoc["scenes"][number]> = {},
    b: Partial<ProjectDoc["scenes"][number]> = {},
  ) {
    const doc = talkingHead();
    return {
      ...doc,
      scenes: [
        { id: "sc1", source: "cam", in: 0, out: 5, note: "", volume: 1, ...a },
        { id: "sc2", source: "cam", in: 7, out: 12, note: "", volume: 1, ...b },
      ],
    } as ProjectDoc;
  }

  it("moves the sound handover and crossfades it, without moving the picture", () => {
    const plain = audioPlan(timelineOf(twoShots()));
    expect(plain.map((s) => [s.from, s.to, s.fadeIn])).toEqual([
      [0, 5, 0],
      [5, 10, 0],
    ]);
    const l = audioPlan(timelineOf(twoShots({ audioTail: 1.5 })));
    expect(l[0]).toMatchObject({ from: 0, to: 6.5, fadeOut: 0.2 });
    expect(l[1]).toMatchObject({ from: 6.5, to: 10, fadeIn: 0.2 });
    const j = audioPlan(timelineOf(twoShots({}, { audioLead: 1 })));
    expect(j[1]!.from).toBe(4);
    expect(timelineOf(twoShots({}, { audioLead: 1 })).duration).toBe(10);
    // Never past the middle of a shot.
    expect(audioPlan(timelineOf(twoShots({ audioTail: 5 })))[1]!.from).toBe(7.5);
  });

  it("captions follow the sound: an L-cut's words play over the next shot", () => {
    const words = (d: ProjectDoc) =>
      spokenWords(d).map((w) => `${w.source}:${w.index}@${w.start.toFixed(2)}`);
    const base = words(twoShots());
    const tailed = words(twoShots({ audioTail: 1.5 }));
    // The first shot is heard 1.5s longer, so it carries words from past its out point...
    expect(tailed.length).toBeGreaterThanOrEqual(base.length);
    const firstShotWords = spokenWords(twoShots({ audioTail: 1.5 })).filter((w) => w.scene === "sc1");
    expect(firstShotWords.at(-1)!.start).toBeGreaterThan(5);
    // ...and every word is still in output order, none twice.
    const refs = spokenWords(twoShots({ audioTail: 1.5 })).map((w) => w.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("speech", () => {
  it("maps words through the cut into output time", () => {
    const doc = talkingHead();
    const words = spokenWords(doc);
    expect(words).toHaveLength(text.length);
    expect(words[0]!.start).toBeCloseTo(0.5, 5);
    expect(spokenWords(doc)).toBe(words);
  });

  it("builds a tight cut from kept word ranges, dropping long pauses", () => {
    const doc = talkingHead();
    // Keep the retake ("so today I want to show you something wild .") and the last line.
    const ranges = rangesFromKeeps(doc, [{ source: "cam", from: 6, to: 21 }]);
    expect(ranges).toHaveLength(2); // split at the 1.4s pause
    const next = applyOps(doc, replaceTimelineOps(doc, ranges)).doc;
    const spoken = spokenWords(next).map((w) => w.text);
    expect(spoken).toEqual(text.slice(6));
    expect(timelineOf(next).duration).toBeLessThan(6);
  });

  it("cuts selected words out of the video", () => {
    const doc = talkingHead();
    const refs = new Set(
      spokenWords(doc)
        .slice(0, 6)
        .map((w) => w.ref),
    ); // the false start
    const next = applyOps(doc, cutWordsOps(doc, refs)).doc;
    expect(spokenWords(next).map((w) => w.text)).toEqual(text.slice(6));
    expect(timelineOf(next).duration).toBeLessThan(timelineOf(doc).duration);
  });

  it("cuts words from the middle by splitting the shot", () => {
    const doc = talkingHead();
    const refs = new Set(
      spokenWords(doc)
        .filter((w) => w.text === "um")
        .map((w) => w.ref),
    );
    const next = applyOps(doc, cutWordsOps(doc, refs)).doc;
    expect(next.scenes).toHaveLength(2);
    expect(spokenWords(next).map((w) => w.text)).not.toContain("um");
    expect(spokenWords(next)).toHaveLength(text.length - 1);
  });

  it("pulls word edges out of measured silences", () => {
    const words = [
      { text: "OpenAI", start: 0, end: 1.2 },
      { text: "just", start: 1.25, end: 1.5 },
    ];
    const aligned = alignToSilences(words, [[0, 0.886]]);
    expect(aligned[0]!.start).toBeCloseTo(0.886, 5);
    expect(aligned[1]).toBe(words[1]);
  });

  it("keeps zooms on their moment when cutting words splits a shot", () => {
    let doc = talkingHead();
    // A zoom on "wild" (word 15), late in the shot.
    const wild = doc.transcripts[0]!.words[15]!;
    doc = applyOps(doc, [
      {
        op: "insert",
        coll: "zooms",
        item: {
          id: "z1",
          anchor: { scene: "sc1", at: wild.start },
          duration: 0.5,
          scale: 1.3,
          focus: { x: 0.5, y: 0.5 },
          ease: "punch",
        },
      },
    ]).doc;
    const um = new Set(
      spokenWords(doc)
        .filter((w) => w.text === "um")
        .map((w) => w.ref),
    );
    const next = applyOps(doc, cutWordsOps(doc, um)).doc;
    const zoom = next.zooms[0]!;
    const scene = next.scenes.find((s) => s.id === zoom.anchor.scene)!;
    expect(scene.id).not.toBe("sc1");
    expect(scene.in + zoom.anchor.at).toBeCloseTo(wild.start, 3);
    expect(zoom.anchor.at).toBeLessThan(scene.out - scene.in);
  });

  it("pages captions at sentence ends and pauses", () => {
    const pages = captionPages(spokenWords(talkingHead()), 4);
    expect(pages.every((p) => p.words.length <= 4)).toBe(true);
    expect(pages.some((p) => p.words.at(-1)!.text === ".")).toBe(true);
    for (let i = 1; i < pages.length; i++)
      expect(pages[i]!.start).toBeGreaterThanOrEqual(pages[i - 1]!.start);
  });

  it("pages slow, pausing speech by its settings instead of in scraps", () => {
    // An event speaker: a pause after every two words.
    const said = "we are going to carry your excitement your aspirations your dreams with us.".split(" ");
    let t = 0;
    const words = said.map((text, i) => {
      if (i > 0 && i % 2 === 0) t += 0.6;
      const w = { text, start: t, end: t + 0.3 };
      t += 0.35;
      return w;
    });
    const doc: ProjectDoc = {
      ...talkingHead(),
      transcripts: [{ id: "cam", language: "en", words }],
    };
    const spoken = spokenWords(doc);
    const lengths = (o: Parameters<typeof captionPages>[1]) =>
      captionPages(spoken, o).map((p) => p.words.length);
    // The old rule: every pause breaks the line.
    expect(lengths({ maxWords: 5 })).toEqual([2, 2, 2, 2, 2, 2, 1]);
    // Ignore pauses, allow longer pages: whole phrases.
    expect(lengths({ maxWords: 5, pauseBreak: 0, maxPageSeconds: 4 })).toEqual([5, 5, 3]);
    // Keep pause breaks but no scraps: short pages join their sentence.
    expect(lengths({ maxWords: 5, minWords: 3 }).every((n) => n >= 3)).toBe(true);
  });

  it("splits a shot and moves later items to the second half", () => {
    let doc = talkingHead();
    doc = applyOps(doc, [
      {
        op: "insert",
        coll: "zooms",
        item: {
          id: "z1",
          anchor: { scene: "sc1", at: 8 },
          duration: 1,
          scale: 1.3,
          focus: { x: 0.5, y: 0.5 },
          ease: "punch",
        },
      },
    ]).doc;
    const next = applyOps(doc, splitSceneOps(doc, "sc1", 5)).doc;
    expect(next.scenes.map((s) => [s.in, s.out])).toEqual([
      [0, 5],
      [5, 12],
    ]);
    expect(next.zooms[0]!.anchor).toEqual({ scene: next.scenes[1]!.id, at: 3 });
  });

  it("keeps anchored items on the same footage when trimming the start", () => {
    let doc = talkingHead();
    doc = applyOps(doc, [
      {
        op: "insert",
        coll: "zooms",
        item: {
          id: "z1",
          anchor: { scene: "sc1", at: 4 },
          duration: 1,
          scale: 1.3,
          focus: { x: 0.5, y: 0.5 },
          ease: "punch",
        },
      },
    ]).doc;
    const next = applyOps(doc, trimSceneOps(doc, "sc1", 1.5, 12)).doc;
    expect(next.zooms[0]!.anchor.at).toBeCloseTo(2.5, 5);
  });
});

describe("alignToOnsets", () => {
  /** A voice envelope (100 a second): silent (30 dB) except where `talk` says, at 65 dB. */
  const envelope = (seconds: number, talk: [number, number][]) =>
    Array.from({ length: seconds * 100 }, (_, k) =>
      talk.some(([a, b]) => k / 100 >= a && k / 100 < b) ? 65 : 30,
    );
  const w = (text: string, start: number, end: number) => ({ text, start, end });

  it("moves a phrase stamped early in a pause to where the voice comes back", () => {
    const env = envelope(6, [
      [0, 1],
      [2.5, 4],
    ]);
    const out = alignToOnsets(
      [w("hello", 0.1, 0.9), w("think", 1.9, 2.2), w("of", 2.2, 2.4), w("this", 2.8, 3.2)],
      env,
    );
    expect(out[1]!.start).toBeGreaterThanOrEqual(2.45);
    expect(out[2]!.start).toBeGreaterThan(out[1]!.start);
    expect(out[2]!.end).toBeLessThanOrEqual(2.8);
    expect(out[3]).toEqual(w("this", 2.8, 3.2));
  });

  it("leaves words that start with the voice alone", () => {
    const env = envelope(4, [
      [0, 1],
      [2, 3],
    ]);
    const words = [w("a", 0, 0.9), w("b", 2, 2.9)];
    expect(alignToOnsets(words, env)).toEqual(words);
  });

  it("finishes when the voice comes back right at the stamp", () => {
    const env = envelope(4, [
      [0, 1],
      [2.01, 3],
    ]);
    expect(alignToOnsets([w("a", 0, 0.9), w("b", 2, 2.9)], env)).toHaveLength(2);
  });
});

describe("cutting on the breath", () => {
  it("moves a cut off the transcript's early word edge to the quiet between the words", async () => {
    const { rangesFromKeeps, breathBetween } = await import("./speech.ts");
    // 50 peaks a second: "hello" sounds 0.0-0.62, quiet 0.62-0.80, "world" sounds 0.80-1.40.
    const peaks = new Uint8Array(100);
    for (let k = 0; k < 100; k++) peaks[k] = k < 31 ? 180 : k < 40 ? 10 : k < 70 ? 170 : 8;
    // Transcribed back to back, the second word stamped early (0.55) while the first still sounds.
    const words = [
      { text: "hello", start: 0.05, end: 0.55 },
      { text: "world", start: 0.55, end: 1.4 },
    ];
    const doc = {
      transcripts: [{ id: "c", language: "en", words }],
      sources: [{ id: "c", duration: 2 }],
    } as never;
    // Without the waveform the cut ends at the early stamp, inside "hello".
    const plain = rangesFromKeeps(doc, [{ source: "c", from: 0, to: 0 }]);
    expect(plain[0]!.out).toBeLessThan(0.62);
    // With it, the cut lands in the quiet after "hello", before "world" starts.
    const heard = rangesFromKeeps(doc, [{ source: "c", from: 0, to: 0 }], { levels: () => peaks });
    expect(heard[0]!.out).toBeGreaterThanOrEqual(0.62);
    expect(heard[0]!.out).toBeLessThanOrEqual(0.82);
    expect(breathBetween(peaks, 0.5, 0.9)).toBeGreaterThanOrEqual(0.62);
  });
});

describe("cleaning existing cuts", () => {
  it("moves a clipped out point onto the breath, keeps anchored items on their words, and changes nothing the second time", async () => {
    const { cleanCutOps } = await import("./speech.ts");
    const { applyOps } = await import("./ops.ts");
    const { emptyProject } = await import("./templates.ts");
    const peaks = new Uint8Array(150);
    for (let k = 0; k < 150; k++) peaks[k] = k < 31 ? 180 : k < 40 ? 10 : k < 70 ? 170 : k < 80 ? 9 : 175;
    const words = [
      { text: "hello", start: 0.05, end: 0.55 },
      { text: "world", start: 0.55, end: 1.4 },
      { text: "again", start: 1.6, end: 2.6 },
    ];
    const base = emptyProject("t");
    let doc = {
      ...base,
      sources: [{ id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 3 }],
      transcripts: [{ id: "c", language: "en", words }],
      // Cut at the early stamp: clips the end of "hello".
      scenes: [{ id: "a", source: "c", in: 0.05, out: 0.55, note: "", volume: 1 }],
      zooms: [
        {
          id: "z",
          anchor: { scene: "a", at: 0.2 },
          duration: 0.2,
          scale: 1.1,
          focus: { x: 0.5, y: 0.5 },
          ease: "punch",
        },
      ],
    } as never as Parameters<typeof cleanCutOps>[0];
    const first = cleanCutOps(doc, () => peaks);
    doc = applyOps(doc, first.ops).doc;
    const shot = doc.scenes[0]!;
    expect(shot.out).toBeGreaterThanOrEqual(0.62);
    expect(shot.out).toBeLessThanOrEqual(0.82);
    // The zoom moves by however much the in point moved, so it stays on the same word.
    expect(doc.zooms[0]!.anchor.at - 0.2).toBeCloseTo(0.05 - shot.in, 5);
    expect(cleanCutOps(doc, () => peaks).moved).toBe(0);
  });
});

describe("cleaning cuts inside one take", () => {
  it("makes two shots that run on from each other meet at one point, never replaying a stretch", async () => {
    const { cleanCutOps } = await import("./speech.ts");
    const { applyOps } = await import("./ops.ts");
    const { emptyProject } = await import("./templates.ts");
    // A sentence, a breath, the next line: cut in the breath, as a jump cut inside one take.
    const peaks = new Uint8Array(200);
    for (let k = 0; k < 200; k++) peaks[k] = k < 70 ? 175 : k < 100 ? 8 : k < 150 ? 170 : 9;
    const words = [
      { text: "the", start: 0.05, end: 0.6 },
      { text: "Instagram.", start: 0.6, end: 1.4 },
      { text: "So", start: 2.0, end: 3.0 },
    ];
    let doc = {
      ...emptyProject("t"),
      sources: [{ id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 4 }],
      transcripts: [{ id: "c", language: "en", words }],
      scenes: [
        { id: "a", source: "c", in: 0.05, out: 1.7, note: "", volume: 1 },
        { id: "b", source: "c", in: 1.7, out: 3.2, note: "", volume: 1 },
      ],
    } as never as Parameters<typeof cleanCutOps>[0];
    doc = applyOps(doc, cleanCutOps(doc, () => peaks).ops).doc;
    const [a, b] = [doc.scenes[0]!, doc.scenes[1]!];
    // Each edge alone would have overlapped (the first shot on into its pause, the next back for a breath).
    expect(b.in).toBe(a.out);
    expect(cleanCutOps(doc, () => peaks).moved).toBe(0);
  });
});

describe("re-timing transcribed words", () => {
  it("takes the aligned pass's times by matching words, and moves a cut with its words", async () => {
    const { retimeWords, moveEdgesWithWords } = await import("./speech.ts");
    const { applyOps } = await import("./ops.ts");
    const { emptyProject } = await import("./templates.ts");
    // The old pass is half a second early from "agency" on; the fresh pass hears "an" as "and".
    const old = [
      { text: "building", start: 47.34, end: 47.95 },
      { text: "an", start: 47.95, end: 48.01 },
      { text: "AI", start: 48.01, end: 48.08 },
      { text: "agency.", start: 48.08, end: 48.63, stress: 0.9 },
      { text: "And", start: 48.63, end: 48.81 },
      { text: "no,", start: 48.81, end: 49.05 },
    ];
    const fresh = [
      { text: "building", start: 47.62, end: 48.2 },
      { text: "and", start: 48.2, end: 48.4 },
      { text: "AI", start: 48.4, end: 48.68 },
      { text: "agency.", start: 48.68, end: 49.14 },
      { text: "And", start: 49.3, end: 49.38 },
      { text: "no,", start: 49.38, end: 49.6 },
    ];
    const words = retimeWords(old, fresh);
    expect(words.map((w) => w.text)).toEqual(old.map((w) => w.text));
    expect(words[3]).toMatchObject({ text: "agency.", start: 48.68, end: 49.14, stress: 0.9 });
    // "an", unmatched, sits between its matched neighbours.
    expect(words[1]!.start).toBeGreaterThanOrEqual(48.2);
    expect(words[1]!.end).toBeLessThanOrEqual(48.4 + 1e-9);
    // A shot cut after "And" on the old times still ends after "And" on the new ones.
    const base = emptyProject("t");
    const doc = {
      ...base,
      sources: [{ id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 60 }],
      transcripts: [{ id: "c", language: "en", words: old }],
      scenes: [{ id: "s", source: "c", in: 47.3, out: 48.83, note: "", volume: 1 }],
    } as never as Parameters<typeof moveEdgesWithWords>[0];
    const moved = applyOps(doc, moveEdgesWithWords(doc, "c", old, words)).doc.scenes[0]!;
    expect(moved.out).toBeGreaterThanOrEqual(49.38);
    expect(moved.out).toBeLessThan(49.6);
  });
});

describe("clean cuts: pauses and crossfades", () => {
  it("lets a sentence's pause breathe, blends a cut with no breath to land on, and is stable", async () => {
    const { cleanCutOps } = await import("./speech.ts");
    const { applyOps } = await import("./ops.ts");
    const { emptyProject } = await import("./templates.ts");
    // Clip c: "one." then a second of quiet room, then "two". Clip d: talking straight through.
    const c = new Uint8Array(150);
    for (let k = 0; k < 150; k++) c[k] = k < 30 ? 180 : k < 75 ? 10 : 175;
    const d = new Uint8Array(150).fill(170);
    const base = emptyProject("t");
    let doc = {
      ...base,
      sources: [
        { id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 3 },
        { id: "d", kind: "video", label: "d", path: "/d.mp4", duration: 3 },
      ],
      transcripts: [
        {
          id: "c",
          language: "en",
          words: [
            { text: "one.", start: 0.05, end: 0.6 },
            { text: "two", start: 1.5, end: 2.5 },
          ],
        },
        {
          id: "d",
          language: "en",
          words: [
            { text: "talking", start: 0, end: 1 },
            { text: "on", start: 1, end: 2 },
          ],
        },
      ],
      // A tight cut right after the sentence, into a shot that starts mid-sound.
      scenes: [
        { id: "a", source: "c", in: 0, out: 0.62, note: "", volume: 1 },
        { id: "b", source: "d", in: 0.4, out: 1.9, note: "", volume: 1 },
      ],
    } as never as Parameters<typeof cleanCutOps>[0];
    const first = cleanCutOps(doc, (id) => (id === "c" ? c : d));
    doc = applyOps(doc, first.ops).doc;
    const [a, b] = doc.scenes;
    // About 60% of mix.pauses.sentence (0.42) after "one." while the room stays quiet.
    expect(a!.out).toBeGreaterThanOrEqual(0.8);
    expect(a!.out).toBeLessThanOrEqual(0.9);
    expect(first.blended).toBe(1);
    expect(b!.crossfade).toBe(doc.mix.speechFade);
    expect(a!.crossfade).toBeUndefined();
    // Running it again changes nothing; an editor's own crossfade is never overwritten.
    expect(cleanCutOps(doc, (id) => (id === "c" ? c : d)).ops).toEqual([]);
  });
});

describe("replaceWordsOps", () => {
  it("swaps in a stretch's new words and keeps fixes on the words around it", () => {
    const doc: ProjectDoc = {
      ...talkingHead(),
      wordEdits: [
        { id: "cam:1", emphasis: true }, // "today", before the stretch
        { id: "cam:3", text: "WANT" }, // inside: replaced, so it goes
        { id: "cam:20", emphasis: true }, // "week", after: moves with its word
      ],
    };
    const old = doc.transcripts[0]!.words;
    // Words 2-5 ("I want to um") heard again as two words.
    const from = old[2]!.start;
    const to = old[5]!.end;
    const { ops, first, replaced } = replaceWordsOps(doc, "cam", from, to, [
      { text: "I'm", start: from, end: from + 0.4 },
      { text: "wanting", start: from + 0.5, end: to },
    ]);
    expect([first, replaced]).toEqual([2, 4]);
    const next = applyOps(doc, ops).doc;
    const words = next.transcripts[0]!.words.map((w) => w.text);
    expect(words.slice(0, 5)).toEqual(["so", "today", "I'm", "wanting", "so"]);
    expect(words).toHaveLength(old.length - 2);
    expect(next.wordEdits.map((e) => e.id).sort()).toEqual(["cam:1", "cam:18"]);
    expect(words[18]).toBe("week");
  });
});
