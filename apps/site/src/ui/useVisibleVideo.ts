import { type RefObject, useEffect } from "react";

/**
 * A video that plays only while it's on screen (a little before, so it's already moving when it arrives).
 * Left to autoplay, every video on the page loads and decodes from the first second, scrolled to or not.
 */
export function usePlayWhenVisible(ref: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const watch = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { rootMargin: "200px" },
    );
    watch.observe(v);
    return () => watch.disconnect();
  }, [ref]);
}
