/**
 * How the app moves, in one place: so a tab, a selection, a dialog and a toast all feel like the same
 * app. Quick and settled, never bouncy; only transforms and opacity (the cheap ones); and nothing at all
 * when the system asks for reduced motion (motion's MotionConfig, in App, follows it).
 */

/** Ease for things arriving: fast out, soft landing. */
export const ease = [0.22, 1, 0.36, 1] as const;

/** A selection or highlight moving to where you clicked. */
export const glide = { type: "spring", stiffness: 520, damping: 40, mass: 0.7 } as const;

/** Something new appearing with a little life (a message, a toast, a button). */
export const pop = { type: "spring", stiffness: 420, damping: 32 } as const;

/** A view changing in place (a tab's content, a settings page). */
export const swap = { duration: 0.18, ease } as const;
