import { describe, expect, it } from "vitest";
import { memeCandidate } from "./klipy.ts";

// The shape of a KLIPY result item, from their API docs (URLs shortened).
const tier = (w: number) =>
  Object.fromEntries(
    ["gif", "webp", "jpg", "mp4", "webm"].map((f) => [
      f,
      { url: `https://static.klipy.com/ii/x/${w}.${f}`, width: w, height: w, size: 1000 },
    ]),
  );
const item = {
  id: 8041071659142944,
  slug: "hello-hi-662",
  title: "Hello",
  file: { hd: tier(498), md: tier(400), sm: tier(220), xs: tier(90) },
  tags: [],
  type: "gif",
};

describe("KLIPY results", () => {
  it("picks the best file for each kind, a small still for the sheet, and a credit link", () => {
    const gif = memeCandidate("gif", item)!;
    expect(gif).toMatchObject({
      id: "klipy-gif-hello-hi-662",
      provider: "klipy",
      title: "Hello",
      format: "mp4",
      width: 498,
      download: "https://static.klipy.com/ii/x/498.mp4",
      thumb: "https://static.klipy.com/ii/x/90.jpg",
      page: "https://klipy.com/gifs/hello-hi-662",
    });
    // Stickers keep their transparency: WebM first.
    expect(memeCandidate("sticker", item)!.format).toBe("webm");
    expect(memeCandidate("meme", item)!.format).toBe("jpg");
  });
  it("skips ads and items without files", () => {
    expect(memeCandidate("gif", { ...item, type: "ad" })).toBeNull();
    expect(memeCandidate("gif", { slug: "x", file: {} })).toBeNull();
    expect(memeCandidate("gif", null)).toBeNull();
  });
});
