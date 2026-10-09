import { type MotionValue, motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

const text =
  "Video editors were built for hands: timelines, keyframes, a thousand menus. Cutroom was built from the ground up for an *agent.* It *sees* every frame, *hears* every word, and edits a project made of plain files. You just *say* what you want.";

/** The case for Cutroom, lit word by word as you scroll through it. */
export function Manifesto() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.6"] });
  const words = text.split(" ");
  return (
    <section ref={ref} className="relative mx-auto max-w-5xl px-5 py-32 sm:px-8 md:py-48">
      <motion.span
        style={{ opacity: useTransform(scrollYProgress, [0, 0.1], [0, 1]) }}
        className="mb-8 block font-mono text-[12px] tracking-[0.2em] text-accent uppercase"
      >
        Built for AI, from the ground up
      </motion.span>
      <p className="text-[30px] leading-[1.18] font-semibold tracking-[-0.03em] sm:text-[44px] md:text-[56px]">
        {words.map((w, i) => (
          <Word
            key={i}
            progress={scrollYProgress}
            range={[i / words.length, (i + 1.5) / words.length]}
            word={w}
          />
        ))}
      </p>
    </section>
  );
}

function Word({
  word,
  range,
  progress,
}: {
  word: string;
  range: [number, number];
  progress: MotionValue<number>;
}) {
  const lit = word.startsWith("*");
  const clean = word.replaceAll("*", "");
  const opacity = useTransform(progress, range, [0.14, 1]);
  const y = useTransform(progress, range, [8, 0]);
  const blur = useTransform(progress, range, ["blur(4px)", "blur(0px)"]);
  return (
    <motion.span style={{ opacity, y, filter: blur }} className={`inline-block ${lit ? "text-accent" : ""}`}>
      {clean}&nbsp;
    </motion.span>
  );
}
