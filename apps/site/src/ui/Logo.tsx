import { motion } from "motion/react";

const ease = [0.22, 1, 0.36, 1] as const;

/** The app icon's mark: two clips on a timeline, the playhead on the cut. `animate` draws it in. */
export function Mark({ size = 28, animate = false }: { size?: number; animate?: boolean }) {
  const t = (delay: number) => (animate ? { duration: 0.7, ease, delay } : { duration: 0 });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="22.5" fill="#1d1d1b" />
      <motion.rect
        x="13"
        y="41"
        width="31"
        height="20"
        rx="4.5"
        fill="#fff"
        initial={animate && { opacity: 0, x: -14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={t(0.1)}
      />
      <motion.rect
        x="56"
        y="41"
        width="31"
        height="20"
        rx="4.5"
        fill="#55555E"
        initial={animate && { opacity: 0, x: 14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={t(0.2)}
      />
      <motion.g
        initial={animate && { opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.5)}
      >
        <rect x="48.25" y="29" width="3.5" height="46" rx="1.75" fill="#F5A524" />
        <path
          d="M44 22.5 H56 V28 L50 33.5 L44 28 Z"
          fill="#F5A524"
          stroke="#F5A524"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </motion.g>
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <Mark size={28} />
      <span className="text-[17px] font-semibold tracking-tight">Cutroom</span>
    </span>
  );
}
