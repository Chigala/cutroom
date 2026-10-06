/**
 * "Your video in this style": the project with an inspiration applied and only the captions on top, at
 * a moment someone is speaking, so a card shows what the style does to your own footage (caption look,
 * size and paging, colour grade) rather than a stock example.
 */
import {
  applyOps,
  type InspirationPack,
  inspirationOps,
  type ProjectDoc,
  STARTER_INSPIRATIONS,
  spokenWords,
} from "@vedit/project";

/** A pack to preview or apply: built in, or the project's copy (the user's own are read from the host). */
export function localPack(doc: ProjectDoc, id: string, md?: string): InspirationPack | null {
  const builtin = STARTER_INSPIRATIONS.find((p) => p.id === id);
  if (builtin && (!md || md === builtin.md)) return builtin;
  const copy = doc.inspirations.find((i) => i.id === id);
  const text = md ?? copy?.md;
  return text ? { id, md: text, files: builtin?.files ?? {} } : null;
}

export function stylePreviewDoc(doc: ProjectDoc, pack: InspirationPack): ProjectDoc | null {
  if (!doc.scenes.length) return null;
  let styled: ProjectDoc;
  try {
    styled = applyOps(doc, inspirationOps(doc, pack)).doc;
  } catch {
    return null;
  }
  const spoken = doc.transcripts.length > 0 && spokenWords(doc).length > 0;
  const first = doc.scenes[0]!;
  return {
    ...styled,
    captionStyle: { ...styled.captionStyle, speech: spoken && styled.captionStyle.speech },
    // Without speech, one stand-in line shows the captions.
    captions:
      spoken || !styled.captionStyle.speech
        ? []
        : [
            {
              id: "preview",
              anchor: { scene: first.id, at: 0.2 },
              duration: 2.8,
              text: "This is how your captions look",
              emphasis: ["captions"],
            },
          ],
    titles: [],
    visuals: [],
    effects: [],
    sfx: [],
    comments: [],
    zooms: [],
    music: { ...styled.music, source: null },
  };
}
