import { afterEach, describe, expect, it } from "vitest";
import { MODELS, useOpenModels } from "./models.ts";
import { decodeYolox, decodeYunet, suppress } from "./vision.ts";

describe("open models", () => {
  afterEach(() => {
    delete process.env.VEDIT_VISION;
  });

  it("are pinned: an https source, a size and a SHA-256 each", () => {
    for (const [name, m] of Object.entries(MODELS)) {
      expect(m.url, name).toMatch(/^https:\/\//);
      expect(m.sha256, name).toMatch(/^[0-9a-f]{64}$/);
      expect(m.size, name).toBeGreaterThan(0);
    }
  });

  it("stand in for Apple's frameworks off macOS, and on a Mac when asked to", () => {
    if (process.platform !== "darwin") expect(useOpenModels()).toBe(true);
    else {
      expect(useOpenModels()).toBe(false);
      process.env.VEDIT_VISION = "onnx";
      expect(useOpenModels()).toBe(true);
    }
  });
});

describe("decoding detections", () => {
  it("keeps the best of overlapping boxes", () => {
    const kept = suppress(
      [
        { box: [0, 0, 10, 10], score: 0.6 },
        { box: [1, 1, 11, 11], score: 0.9 },
        { box: [50, 50, 60, 60], score: 0.5 },
      ],
      0.3,
    );
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.5]);
  });

  it("reads YuNet's grid: a face in one cell of the finest stride", () => {
    const zeros = (n: number) => ({ data: new Float32Array(n) });
    const out: Record<string, { data: Float32Array }> = {};
    for (const s of [8, 16, 32]) {
      const cells = (640 / s) ** 2;
      out[`cls_${s}`] = zeros(cells);
      out[`obj_${s}`] = zeros(cells);
      out[`bbox_${s}`] = zeros(cells * 4);
      out[`kps_${s}`] = zeros(cells * 10);
    }
    // Row 10, column 20 of the 80x80 grid; centred in the cell, 4 cells wide and tall.
    const i = 10 * 80 + 20;
    out.cls_8!.data[i] = 0.9;
    out.obj_8!.data[i] = 0.9;
    out.bbox_8!.data.set([0.5, 0.5, Math.log(4), Math.log(4)], i * 4);
    const [face, ...rest] = decodeYunet(out);
    expect(rest).toEqual([]);
    expect(face!.score).toBeCloseTo(0.9);
    expect(face!.box.map((v) => Math.round(v))).toEqual([148, 68, 180, 100]);
  });

  it("reads YOLOX's grid: a person in the coarsest stride, and nothing that isn't one", () => {
    const data = new Float32Array(3549 * 85);
    // The first cell of the 32-stride grid (after 52x52 and 26x26): a person, sure of it.
    const person = 52 * 52 + 26 * 26;
    data.set([0.5, 0.5, Math.log(2), Math.log(3), 0.9, 0.95], person * 85);
    // Another cell: a confident object that's a dog (class 16), not a person.
    const dog = 10;
    data.set([0, 0, 0, 0, 0.9, 0.01], dog * 85);
    data[dog * 85 + 5 + 16] = 0.95;
    const found = decodeYolox(data, 416);
    expect(found).toHaveLength(1);
    expect(found[0]!.score).toBeCloseTo(0.855);
    expect(found[0]!.box.map((v) => Math.round(v))).toEqual([-16, -32, 48, 64]);
  });
});
