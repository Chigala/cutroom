import { emptyProject, type InspirationPack, inspirationInfo, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { buildPrompt } from "./context.ts";
import { GUIDE_TOPICS } from "./guides.ts";
import { type AgentHost, runTool, type Scratch, type ToolContext } from "./tools.ts";

function ctx(doc: ProjectDoc, inspirations?: AgentHost["inspirations"]) {
  const steps: string[] = [];
  // The craft guides read, as a request does before these jobs.
  const scratch: Scratch = { doc, ops: [], groups: [], guides: new Set(GUIDE_TOPICS) };
  const c: ToolContext = {
    scratch,
    host: { frame: async () => Buffer.from([0xff, 0xd8, 0xff]), ...(inspirations && { inspirations }) },
    step: (t) => steps.push(t),
  };
  return { c, scratch, steps };
}

const MINE = `<!-- inspiration {"name": "Comment reply", "description": "Answer a comment, one word at a time", "bestFor": ["Replies"], "energy": 3, "length": "20-45s", "settings": {"captionStyle": {"maxWords": 1}}} -->

# Comment reply

${["The idea", "Structure", "Pacing", "Captions", "Avoid"]
  .map(
    (h) =>
      `## ${h}\n${"A viewer's comment is pinned at the top while the reply is said to camera. ".repeat(2)}`,
  )
  .join("\n\n")}
`;

describe("the inspiration tool", () => {
  it("lists built-in and the user's own, and follows one: its brief is read with every request", async () => {
    const saved = new Map<string, InspirationPack>();
    const host: AgentHost["inspirations"] = {
      list: async () => [...saved.values()].map((p) => inspirationInfo(p.id, p.md, "mine")!),
      get: async (id) => saved.get(id) ?? null,
      save: async (pack) => {
        saved.set(pack.id, pack);
        return inspirationInfo(pack.id, pack.md, "mine")!;
      },
    };
    const { c, scratch } = ctx(emptyProject("A"), host);
    const listed = await runTool("inspiration", { action: "list" }, c);
    expect(listed.text).toContain("punchy-explainer");
    const used = await runTool("inspiration", { action: "use", id: "podcast-clip" }, c);
    expect(used.isError).toBeFalsy();
    expect(scratch.doc.meta.inspiration).toBe("podcast-clip");
    expect(scratch.doc.captionStyle.look).toBe("studio");
    expect(scratch.groups.at(-1)?.label).toBe("Inspiration: Podcast clip");
    const prompt = buildPrompt(scratch.doc, "Edit this", undefined, []);
    expect(prompt).toContain('<inspiration id="podcast-clip" name="Podcast clip">');
    expect(prompt).toContain("Usual length: 30-75s.");
    // The user's own: saved, then followed.
    const written = await runTool(
      "inspiration",
      { action: "write", id: "comment-reply", md: MINE, use: true },
      c,
    );
    expect(written.text).toContain("Saved to the user's inspirations");
    expect(saved.has("comment-reply")).toBe(true);
    expect(scratch.doc.meta.inspiration).toBe("comment-reply");
    expect(scratch.doc.captionStyle.maxWords).toBe(1);
    expect((await runTool("inspiration", { action: "list" }, c)).text).toContain("comment-reply");
  });

  it("keeps a written one in the project when the library can't take it", async () => {
    const host: AgentHost["inspirations"] = {
      list: async () => [],
      get: async () => null,
      save: async () => {
        throw new Error("The library isn't ready.");
      },
    };
    const { c, scratch } = ctx(emptyProject("A"), host);
    const out = await runTool("inspiration", { action: "write", id: "comment-reply", md: MINE }, c);
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain("Couldn't save it to the user's inspirations");
    expect(scratch.doc.meta.inspiration).toBe("comment-reply");
    expect(scratch.doc.inspirations.map((i) => i.id)).toEqual(["comment-reply"]);
  });

  it("refuses a thin or invalid brief, and says why", async () => {
    const { c } = ctx(emptyProject("A"));
    const out = await runTool(
      "inspiration",
      { action: "write", id: "x", md: `<!-- inspiration {"name": "X"} -->\n\n${"short ".repeat(40)}` },
      c,
    );
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/thin/);
  });

  it("measures a reference only once it's indexed", async () => {
    const doc = emptyProject("A");
    const pending: ProjectDoc = {
      ...doc,
      sources: [
        {
          id: "ref",
          kind: "video",
          label: "ref",
          duration: 10,
          hdr: false,
          hasAudio: true,
          status: "indexing",
          proxy: false,
          speech: false,
          summary: "",
          tags: [],
        },
      ],
    };
    const { c } = ctx(pending);
    const out = await runTool("inspiration", { action: "measure", source: "ref" }, c);
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/still being indexed/);
  });
});
