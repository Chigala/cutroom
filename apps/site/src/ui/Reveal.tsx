import { motion } from "motion/react";
import type { ReactNode } from "react";

/** Rises into place the first time it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 28,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ type: "spring", stiffness: 90, damping: 20, delay }}
    >
      {children}
    </motion.div>
  );
}

/** A heading whose words rise one after another. */
export function Words({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: "105%" }}
            whileInView={{ y: 0 }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 120, damping: 20, delay: delay + i * 0.05 }}
          >
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </span>
  );
}
