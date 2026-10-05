/**
 * Poster frames for story cards, grabbed from the real footage. Decoding is the expensive part, so:
 * at most two at a time, each (clip, time) only once, small JPEGs, and only for cards on screen.
 */
const cache = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let running = 0;
const LIMIT = 2;

function pump(): void {
  while (running < LIMIT && queue.length) {
    running++;
    queue.shift()!();
  }
}

function grab(src: string, time: number): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push(() => {
      const video = document.createElement("video");
      video.muted = true;
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      const done = (url: string | null) => {
        video.removeAttribute("src");
        video.load();
        running--;
        pump();
        resolve(url);
      };
      const timeout = setTimeout(() => done(null), 8000);
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05));
      });
      video.addEventListener("seeked", () => {
        clearTimeout(timeout);
        const canvas = document.createElement("canvas");
        const w = 96;
        const h = Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth));
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
        done(canvas.toDataURL("image/jpeg", 0.72));
      });
      video.addEventListener("error", () => {
        clearTimeout(timeout);
        done(null);
      });
      video.src = src;
    });
    pump();
  });
}

export function thumbnail(src: string, time: number): Promise<string | null> {
  const key = `${src}@${time.toFixed(2)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = grab(src, time);
    cache.set(key, hit);
  }
  return hit;
}
