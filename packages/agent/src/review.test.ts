import type { MotionReport } from "@vedit/bridge";
import { emptyProject, type Op, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { finishReview } from "./review.ts";
import type { Scratch, ToolContext } from "./tools.ts";

function talking(): ProjectDoc {
  return {
    ...emptyProject("Talk"),
    sources: [
      {
        id: "cam",
        kind: "video",
        label: "cam",
        path: "/cam.mov",
        duration: 8,
        hdr: false,
        hasAudio: true,
        status: "ready",
        proxy: false,
        speech: true,
        summary: "",
        tags: [],
      },
    ],
    scenes: [{ id: "sc1", source: "cam", in: 0, out: 8, note: "", volume: 1 }],
  };
}

const graphic = (motion: string) =>
  `<!-- graphic {"name": "Hit", "params": {"word": {"type": "text", "default": "Hit"}}} --><style>.w { animation: in .4s ${motion} both } @keyframes in { from { opacity: 0 } } .out { animation: out .3s var(--ease) var(--exit) both }</style><div class="out"><div class="w">{{word}}</div></div>`;

function setup(before: ProjectDoc, after: ProjectDoc, report?: MotionReport) {
  const steps: string[] = [];
  const scratch: Scratch = {
    doc: after,
    ops: [{ op: "update", coll: "meta", patch: {} } as unknown as Op],
    groups: [],
  };
  let measured = 0;
  const ctx: ToolContext = {
    scratch,
    host: {
      frame: async () => Buffer.from([]),
      ...(report && {
        senseMotion: async () => {
          measured++;
          return report;
        },
      }),
    },
    step: (t) => steps.push(t),
  };
  return { review: finishReview(before, ctx), steps, measured: () => measured, scratch };
}

const placed = (doc: ProjectDoc, html: string): ProjectDoc => ({
  ...doc,
  graphics: [{ id: "hit", html }],
  visuals: [
    {
      id: "v1",
      anchor: { scene: "sc1", at: 1 },
      duration: 2,
      layout: "overlay",
      content: { kind: "graphic", graphic: "hit", params: {} },
    } as ProjectDoc["visuals"][number],
  ],
});

const clean: MotionReport = {
  issues: [],
  metrics: { entries: 1, onBeat: null, graphicSeconds: 2, faceCovered: 0, faces: 0 },
  elapsedMs: 1,
};

describe("finishReview", () => {
  it("lets an edit that changed nothing finish", async () => {
    const doc = talking();
    const { review, scratch } = setup(doc, doc);
    scratch.ops.length = 0;
    expect(await review()).toBeNull();
  });

  it("sends back a placed graphic with linear motion, and measures the motion", async () => {
    const before = talking();
    const { review, measured } = setup(before, placed(before, graphic("linear")), clean);
    const fix = await review();
    expect(fix).toContain("Graphic hit: linear timing");
    expect(measured()).toBe(1);
  });

  it("passes the motion issues it measured back to the agent", async () => {
    const before = talking();
    const report: MotionReport = {
      ...clean,
      issues: [{ kind: "face", start: 1, end: 2, items: ["v1"], detail: "covers the face" }],
    };
    const { review } = setup(before, placed(before, graphic("var(--ease)")), report);
    expect(await review()).toContain("motion face (v1): covers the face");
  });

  it("lets a clean edit finish, and gives up after two rounds", async () => {
    const before = talking();
    const good = setup(before, placed(before, graphic("var(--ease)")), clean);
    expect(await good.review()).toBeNull();
    expect(good.steps).toContain("Checked the edit: clean");

    const bad = setup(before, placed(before, graphic("linear")), clean);
    expect(await bad.review()).not.toBeNull();
    expect(await bad.review()).not.toBeNull();
    expect(await bad.review()).toBeNull();
  });

  it("doesn't ask the agent to fix what already fell short before the request", async () => {
    const before = placed(talking(), graphic("var(--ease)"));
    const after: ProjectDoc = { ...before, meta: { ...before.meta } };
    const { review } = setup(before, after, clean);
    expect(await review()).toBeNull();
  });
});
