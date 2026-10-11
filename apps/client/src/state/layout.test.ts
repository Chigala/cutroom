import { describe, expect, it } from "vitest";
import { fit } from "./layout.ts";

const usual = {
  railOpen: false,
  railWidth: 248,
  sideOpen: true,
  sideWidth: 320,
  chatWidth: 380,
  commentsOpen: true,
  timelineHeight: 264,
};

describe("fitting the editor to the window", () => {
  it("leaves a wide window as the panels were", () => {
    const l = fit(1280, 800, usual);
    expect([l.rail.width, l.chat, l.side.width, l.preview, l.timeline]).toEqual([60, 380, 320, 520, 264]);
    expect(l.comments).toBe(true);
  });

  it("narrows the side panel and the chat before hiding anything", () => {
    const l = fit(1200, 800, usual);
    expect(l.side.hidden).toBe(false);
    expect(l.side.width).toBeGreaterThanOrEqual(280);
    expect(l.chat).toBeGreaterThanOrEqual(320);
    expect(l.preview).toBe(480);
  });

  it("folds the sidebar first, then hides the side panel, keeping the video's room", () => {
    const open = { ...usual, railOpen: true };
    expect(fit(1440, 900, open).rail.open).toBe(true);
    const narrower = fit(1280, 800, open);
    expect([narrower.rail.folded, narrower.side.hidden]).toEqual([true, false]);
    const narrowest = fit(900, 600, open);
    expect([narrowest.rail.folded, narrowest.side.hidden]).toEqual([true, true]);
    expect(narrowest.preview).toBeGreaterThanOrEqual(480);
    expect(narrowest.chat).toBeGreaterThanOrEqual(320);
  });

  it("gives back a width dragged past the usual before anything else", () => {
    const l = fit(1280, 800, { ...usual, chatWidth: 520 });
    expect([l.chat, l.side.width, l.side.hidden, l.preview]).toEqual([420, 320, false, 480]);
  });

  it("hides the comments in a narrow preview, and shortens the timeline in a short window", () => {
    const l = fit(900, 600, usual);
    expect(l.comments).toBe(false);
    expect(l.timeline).toBeLessThan(264);
    expect(600 - 52 - l.timeline).toBeGreaterThanOrEqual(340);
  });
});
