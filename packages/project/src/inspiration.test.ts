import { describe, expect, it } from "vitest";
import {
  applyOps,
  emptyProject,
  type INSPIRATION_FILES,
  inspirationBrief,
  inspirationInfo,
  inspirationMeta,
  inspirationOps,
  measureReference,
  type ProjectDoc,
  packFromProject,
  referenceText,
  STARTER_INSPIRATIONS,
  stopInspirationOps,
  validateCaptionLook,
  validateGraphic,
  validateInspiration,
} from "./index.ts";

const SECTIONS = [
  "## The idea",
  "## Structure",
  "## Pacing",
  "## Captions",
  "## Motion",
  "## Avoid",
  "## How to tell it's working",
];

describe("built-in inspirations", () => {
  it("are valid, complete briefs with unique ids", () => {
    const ids = STARTER_INSPIRATIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of STARTER_INSPIRATIONS) {
      expect(validateInspiration(p.md, p.files), p.id).toBeNull();
      const brief = inspirationBrief(p.md);
      for (const section of SECTIONS) expect(brief, `${p.id} ${section}`).toContain(section);
      const meta = inspirationMeta(p.md)!;
      expect(meta.description.length, p.id).toBeGreaterThan(20);
      expect(meta.bestFor.length, p.id).toBeGreaterThan(0);
      expect(inspirationInfo(p.id, p.md, "builtin")!.traits.length, p.id).toBeGreaterThan(1);
    }
  });

  it("only name looks, grades, graphics, effects and transitions that exist", () => {
    const doc = emptyProject("A");
    const known = (
      coll: (typeof INSPIRATION_FILES)[number],
      id: string,
      p: (typeof STARTER_INSPIRATIONS)[number],
    ) =>
      (doc[coll] as readonly { id: string }[]).some((x) => x.id === id) ||
      (p.files[coll] ?? []).some((x) => x.id === id);
    for (const p of STARTER_INSPIRATIONS) {
      const meta = inspirationMeta(p.md)!;
      const lookId = meta.settings.captionStyle?.look;
      if (typeof lookId === "string")
        expect(known("captionLooks", lookId, p), `${p.id} look ${lookId}`).toBe(true);
      const grade = meta.settings.look?.grade;
      if (typeof grade === "string") expect(known("grades", grade, p), `${p.id} grade ${grade}`).toBe(true);
      // Every graphic, effect and transition the brief names in code style is a built-in.
      const brief = inspirationBrief(p.md);
      const named = [
        ...brief.matchAll(
          /\b(number|list|steps|callout|kinetic|burst|quote|compare|bars|lower-third|name-tag|stamp|trend|celebrate|point-marker|topic-banner|chapter-card|step-badge|headline-card|end-card|beat-title|place-stamp)\b/g,
        ),
      ];
      for (const [, id] of named) expect(known("graphics", id!, p), `${p.id} graphic ${id}`).toBe(true);
      for (const [, id] of brief.matchAll(
        /\b(whip-pan|zoom-through|crossfade|slide|bounce-out|flash-cut)\b/g,
      ))
        expect(known("transitionKinds", id!, p), `${p.id} transition ${id}`).toBe(true);
      for (const [, id] of brief.matchAll(
        /\b(rgb-split|glitch|zoom-blur|film-burn|light-leak|color-pop|spotlight)\b/g,
      ))
        expect(known("effectKinds", id!, p), `${p.id} effect ${id}`).toBe(true);
    }
  });

  it("each bring a signature graphic, and their files pass the same checks as any project file", () => {
    for (const p of STARTER_INSPIRATIONS) {
      expect(p.files.graphics?.length ?? 0, `${p.id} signature graphic`).toBeGreaterThan(0);
      for (const g of p.files.graphics ?? []) {
        expect(validateGraphic(g.html), `${p.id} ${g.id}`).toBeNull();
        expect(inspirationBrief(p.md), `${p.id} names ${g.id}`).toContain(g.id);
      }
      for (const l of p.files.captionLooks ?? [])
        expect(validateCaptionLook(l.css), `${p.id} ${l.id}`).toBeNull();
      expect(inspirationBrief(p.md), `${p.id} footage`).toContain("## Make the footage better");
    }
  });

  it("apply cleanly to a new project, as one set of undoable ops", () => {
    for (const p of STARTER_INSPIRATIONS) {
      const doc = emptyProject("A");
      const { doc: next } = applyOps(doc, inspirationOps(doc, p));
      expect(next.meta.inspiration, p.id).toBe(p.id);
      expect(next.inspirations.find((i) => i.id === p.id)?.md).toBe(p.md);
      const meta = inspirationMeta(p.md)!;
      for (const [key, patch] of Object.entries(meta.settings))
        for (const [field, value] of Object.entries(patch ?? {}))
          if (typeof value !== "object")
            expect(
              (next[key as keyof ProjectDoc] as Record<string, unknown>)[field],
              `${p.id} ${key}.${field}`,
            ).toEqual(value);
      // STYLE.md is the user's: an inspiration never touches it.
      expect(next.style).toBe(doc.style);
    }
  });
});

describe("applying an inspiration", () => {
  const punchy = STARTER_INSPIRATIONS.find((p) => p.id === "punchy-explainer")!;

  it("keeps the project's look when asked: only the pattern applies", () => {
    const a = emptyProject("A");
    const branded = {
      ...a,
      captionStyle: { ...a.captionStyle, look: "silver", accent: "#FF3D7F", size: 80 },
      look: { ...a.look, grade: "film" },
    };
    const { doc } = applyOps(branded, inspirationOps(branded, punchy, { keepLook: true }));
    expect(doc.captionStyle.look).toBe("silver");
    expect(doc.captionStyle.accent).toBe("#FF3D7F");
    expect(doc.look.grade).toBe("film");
    // The pattern still applies.
    expect(doc.captionStyle.maxWords).toBe(3);
    expect(doc.checkRules.maxShot).toBe(2.5);
    expect(doc.look.jumpZoom).toBe(1.12);
  });

  it("merges nested settings without resetting the rest", () => {
    const a = emptyProject("A");
    const custom = {
      ...a,
      checkRules: { ...a.checkRules, motion: { ...a.checkRules.motion, flicker: 0.05 } },
    };
    const { doc } = applyOps(custom, inspirationOps(custom, punchy));
    expect(doc.checkRules.motion.flicker).toBe(0.05);
    expect(doc.mix.pauses.sentence).toBe(0.28);
  });

  it("is undone in one step, and stopping keeps what it set", () => {
    const a = emptyProject("A");
    const applied = applyOps(a, inspirationOps(a, punchy));
    let back = applied.doc;
    for (const inverse of [...applied.perOp].reverse()) back = applyOps(back, inverse).doc;
    expect(back.captionStyle).toEqual(a.captionStyle);
    expect(back.meta.inspiration).toBeUndefined();
    const { doc: stopped } = applyOps(applied.doc, stopInspirationOps(applied.doc));
    expect(stopped.meta.inspiration).toBeUndefined();
    expect(stopped.captionStyle.maxWords).toBe(3);
  });

  it("packs a project's copy with the files it names, to save as the user's", () => {
    const a = emptyProject("A");
    const { doc } = applyOps(a, inspirationOps(a, punchy));
    const pack = packFromProject(doc, "punchy-explainer")!;
    expect(pack.files.captionLooks?.map((l) => l.id)).toEqual(["punch"]);
    expect(validateInspiration(pack.md, pack.files)).toBeNull();
  });
});

describe("validation", () => {
  const brief = `\n\n# Mine\n\n${["The idea", "Structure", "Pacing", "Captions"]
    .map((h) => `## ${h}\n${"Specific, concrete direction an editor could follow. ".repeat(3)}`)
    .join("\n\n")}`;
  it("names what's wrong", () => {
    expect(validateInspiration("# no header")).toMatch(/header/);
    expect(validateInspiration(`<!-- inspiration {"name": "x"} -->\n\nshort`)).toMatch(/thin/);
    expect(
      validateInspiration(
        `<!-- inspiration {"name": "x", "settings": {"music": {"source": "a1"}}} -->${brief}`,
      ),
    ).toMatch(/belongs to the video/);
    expect(
      validateInspiration(
        `<!-- inspiration {"name": "x", "settings": {"checkRules": {"maxShot": -2}}} -->${brief}`,
      ),
    ).toMatch(/checkRules/);
    expect(
      validateInspiration(`<!-- inspiration {"name": "x", "settings": {"look": {"sparkle": 1}}} -->${brief}`),
    ).toMatch(/isn't a field/);
    expect(
      validateInspiration(`<!-- inspiration {"name": "x", "files": ["captionLooks/nope"]} -->${brief}`),
    ).toMatch(/isn't included/);
    expect(validateInspiration(`<!-- inspiration {"name": "x"} -->${brief}`)).toBeNull();
  });
});

describe("measuring a reference video", () => {
  it("reads its cutting, speech, picture and sound like an editor", () => {
    const a = emptyProject("A");
    const words = Array.from({ length: 60 }, (_, i) => ({
      text: i < 4 ? ["Nobody", "tells", "you", "this"][i]! : "word",
      start: 0.2 + i * 0.32,
      end: 0.2 + i * 0.32 + 0.26,
      stress: i % 10 === 0 ? 0.9 : 0.3,
    }));
    const doc: ProjectDoc = {
      ...a,
      sources: [
        {
          id: "ref",
          kind: "video",
          label: "Reference",
          duration: 20,
          hdr: false,
          hasAudio: true,
          status: "ready",
          proxy: false,
          speech: true,
          summary: "",
          tags: [],
        },
      ],
      transcripts: [{ id: "ref", language: "en", words }],
      analyses: [
        {
          id: "ref",
          silences: [],
          shots: [1.1, 2.0, 3.2, 4.0, 5.1, 6.0, 7.3, 8.0, 9.1, 10.2, 12.0, 14.5, 17.0],
          sounds: [{ start: 0, end: 20, label: "music", confidence: 0.9 }],
        },
      ],
      shotLogs: [
        {
          id: "ref",
          segments: [
            {
              start: 0,
              end: 10,
              what: "Talking",
              shot: "close",
              camera: "static",
              energy: 4,
              quality: [],
              highlight: true,
              tags: ["desk"],
            },
            {
              start: 10,
              end: 20,
              what: "Screen",
              shot: "screen",
              camera: "static",
              energy: 2,
              quality: [],
              highlight: false,
              tags: ["laptop"],
            },
          ],
          loud: [],
        },
      ],
    } as unknown as ProjectDoc;
    const r = measureReference(doc, "ref")!;
    expect(r.shots.count).toBe(14);
    expect(r.shots.per10sByThird[0]).toBeGreaterThan(r.shots.per10sByThird[2]);
    expect(r.speech!.hook.startsWith("Nobody tells you this")).toBe(true);
    expect(r.speech!.wordsPerMinute).toBeGreaterThan(150);
    expect(r.picture!.screens).toBe(0.5);
    expect(r.sound.music).toBe(1);
    expect(r.lookAt.length).toBeGreaterThan(3);
    const text = referenceText(r);
    expect(text).toContain("It opens fastest");
    expect(text).toContain("look with source ref");
  });
});
