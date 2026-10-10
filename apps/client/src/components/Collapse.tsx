import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { ease } from "../lib/motion.ts";

/** Opens and closes by easing its height, instead of snapping: for disclosures (details, steps, thinking). */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="open"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
