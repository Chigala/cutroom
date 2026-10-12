import { useSyncExternalStore } from "react";

/** The window's size: a new value only when it really changed, so a resize re-renders only then. */
let size = { width: 0, height: 0 };

export function windowSize(): { width: number; height: number } {
  if (size.width !== window.innerWidth || size.height !== window.innerHeight)
    size = { width: window.innerWidth, height: window.innerHeight };
  return size;
}

function subscribe(changed: () => void): () => void {
  window.addEventListener("resize", changed);
  return () => window.removeEventListener("resize", changed);
}

/** The window's inner size, following it as it's resized. */
export function useWindowSize(): { width: number; height: number } {
  return useSyncExternalStore(subscribe, windowSize);
}
