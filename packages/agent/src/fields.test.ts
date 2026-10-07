import { CollectionSchemas, SINGLETONS, SingletonSchemas } from "@vedit/project";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { compactFields, EDITABLE, fieldsOf, unknownFields } from "./fields.ts";

describe("the fields the model is shown", () => {
  const compact = compactFields();
  const line = (name: string) => compact.split("\n").find((l) => l.startsWith(`${name}: `))!;

  it("list every collection and setting the agent edits, with every top-level field", () => {
    for (const name of [...EDITABLE, ...SINGLETONS]) {
      expect(line(name), name).toBeDefined();
      const schema = ((CollectionSchemas as Record<string, z.ZodType>)[name] ??
        (SingletonSchemas as Record<string, z.ZodType>)[name]) as z.ZodType & { shape?: object };
      for (const field of Object.keys(schema.shape ?? {}))
        expect(line(name), `${name}.${field}`).toMatch(new RegExp(`[{ ]${field}[?:,}]`));
    }
    // Not what indexing writes, nor inspirations (their own tool).
    expect(line("transcripts")).toBeUndefined();
    expect(line("inspirations")).toBeUndefined();
  });

  it("say what's required, the types, the ranges and the choices", () => {
    expect(line("voiceovers")).toContain("anchor: {scene, at: number ≥0}");
    expect(line("voiceovers")).toContain("duck?: number 0..1");
    expect(line("visuals")).toContain('layout?: "overlay"|"full"|"split"');
    expect(line("visuals")).toContain('until?: {scene, at: number ≥0} | "end"');
    // Every kind of content, by its kind.
    expect(line("visuals")).toMatch(
      /content: \{kind: "graphic".*\} \| \{kind: "cutaway".*\} \| \{kind: "media"/,
    );
    // A colour, a channel each: a tuple, not just "an array".
    expect(line("scenes")).toContain("lift?: number -0.5..0.5 | [number");
    // No meaningless integer limits.
    expect(compact).not.toMatch(/9007199254740991/);
  });

  it("in full: what each field does and its default, a union by its kinds", () => {
    const visuals = fieldsOf("visuals")!;
    expect(visuals).toMatch(/whole\?: bool {2}\/\/ On for the whole video.*default false/);
    expect(visuals).toContain("content: one of:");
    expect(visuals).toMatch(/- kind: "media"\n\s+source: string {2}\/\/ A reaction GIF/);
    expect(visuals).toMatch(/ {4}box\?: \{…\} {2}\/\/ Where it sits.*\n {6}x: number 0\.\.1/);
    expect(fieldsOf("mix")).toMatch(/cutFade\?: number 0\.\.0\.5 {2}\/\/ .*default 0\.05/);
    expect(fieldsOf("style")).toBe("style: string");
    expect(fieldsOf("nothing")).toBeNull();
  });
});

describe("fields an edit names that don't exist", () => {
  it("are found wherever they are, with the fields that level takes", () => {
    expect(unknownFields("titles", { id: "t1", text: "Hi", fontSize: 80 })).toEqual([
      { path: "fontSize", known: expect.arrayContaining(["size", "font", "text"]) },
    ]);
    const media = { kind: "media", source: "gif", boxx: { x: 0.5 }, box: { x: 0.5, y: 0.4, w: 0.3 } };
    expect(unknownFields("visuals", { id: "v1", content: media }).map((u) => u.path)).toEqual([
      "content.boxx",
      "content.box.w",
    ]);
    expect(unknownFields("scenes", { camera: [{ at: 0, zoom: 2 }] })).toEqual([
      { path: "camera[0].zoom", known: expect.arrayContaining(["scale"]) },
    ]);
    expect(unknownFields("mix", { pauses: { comma: 0.2 } })[0]?.path).toBe("pauses.comma");
  });

  it("leave alone what's free-form, what's removed, and what's merely the wrong type", () => {
    // A graphic's params are its own.
    expect(
      unknownFields("visuals", { content: { kind: "graphic", graphic: "kinetic", params: { anything: 1 } } }),
    ).toEqual([]);
    // null removes an optional field; a wrong type is the schema's to report.
    expect(unknownFields("titles", { box: null, size: "big", position: 3 })).toEqual([]);
    expect(unknownFields("style", "body {}")).toEqual([]);
    expect(unknownFields("nothing", { a: 1 })).toEqual([]);
  });
});
