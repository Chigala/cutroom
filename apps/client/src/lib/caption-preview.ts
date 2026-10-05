/**
 * Previews of a caption look over your own footage: a moment where you're speaking, with only captions
 * on top (no titles, graphics or effects), so what you judge is the look itself. Used by the look picker
 * in the Style panel and by the look editor, and close to what the agent sees when it checks a look.
 */
import {
  type CaptionLook,
  type CaptionStyle,
  captionLookMeta,
  captionPages,
  type ProjectDoc,
  spokenWords,
  timelineOf,
} from "@vedit/project";

export interface CaptionWindow {
  readonly start: number;
  readonly end: number;
  /** When the page in view starts, for the strip's first frames. */
  readonly page: number;
  /** When its last word has been said: every word is on screen, whatever the look's reveal. */
  readonly said: number;
}

const WINDOW = 3.2;

/**
 * A few seconds of speech worth showing: the first caption page with several words, a little way in so
 * it isn't the cold open. Without speech, a stand-in caption plays at the start.
 */
export function captionWindow(doc: ProjectDoc): CaptionWindow {
  const duration = timelineOf(doc).duration;
  const pages = captionPages(spokenWords(doc), doc.captionStyle);
  const page = pages.find((p) => p.start > 1 && p.words.length >= 3) ?? pages[0];
  // The stand-in caption reveals its six words over about 2.2s.
  if (!page) return { start: 0, end: Math.min(duration, WINDOW), page: 0.2, said: 2.6 };
  const start = Math.max(0, page.start - 0.15);
  const last = page.words.at(-1)!;
  return { start, end: Math.min(duration, start + WINDOW), page: page.start, said: last.start + 0.3 };
}

export const lookName = (look: CaptionLook) => captionLookMeta(look.css)?.name ?? look.id;

/** The project with `look` (a draft, or one of the saved ones) on its captions and nothing else on top. */
export function lookPreviewDoc(
  doc: ProjectDoc,
  look: CaptionLook,
  style: Partial<CaptionStyle> = {},
): ProjectDoc {
  const spoken = doc.transcripts.length > 0 && spokenWords(doc).length > 0;
  const first = doc.scenes[0];
  return {
    ...doc,
    captionLooks: [...doc.captionLooks.filter((l) => l.id !== look.id), look],
    captionStyle: { ...doc.captionStyle, ...style, look: look.id, speech: spoken },
    // Without speech, one stand-in caption shows the look.
    captions:
      spoken || !first
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
    music: { ...doc.music, source: null },
  };
}
