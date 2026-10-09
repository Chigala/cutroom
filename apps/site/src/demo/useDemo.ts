import { useCallback, useEffect, useState } from "react";
import { type Phase, scenarios, timing } from "./scenarios.ts";

export interface DemoState {
  index: number;
  phase: Phase;
  /** Characters of the prompt typed so far. */
  typed: number;
  /** Tool lines shown so far. */
  tools: number;
  /** 0..1 through the current phase's "done" hold, for the progress bars. */
  startedAt: number;
}

/**
 * Plays the scripted runs one after another, forever, while `running`. `pick(i)` jumps to a run (the hero's
 * clickable words). Every step is a timeout, so pausing just clears the pending one.
 */
export function useDemo(running: boolean) {
  const [s, setS] = useState<DemoState>({ index: 0, phase: "typing", typed: 0, tools: 0, startedAt: 0 });

  useEffect(() => {
    if (!running) return;
    const sc = scenarios[s.index]!;
    let wait: number;
    let next: () => DemoState;
    switch (s.phase) {
      case "typing":
        if (s.typed < sc.prompt.length) {
          wait = s.typed === 0 ? 700 : timing.perChar * (Math.random() * 0.9 + 0.55);
          next = () => ({ ...s, typed: s.typed + 1 });
        } else {
          wait = 380;
          next = () => ({ ...s, phase: "sent" });
        }
        break;
      case "sent":
        wait = timing.sent;
        next = () => ({ ...s, phase: "thinking" });
        break;
      case "thinking":
        wait = timing.thinking;
        next = () => ({ ...s, phase: "tools", tools: 1 });
        break;
      case "tools":
        wait = timing.perTool;
        next = () => (s.tools < sc.tools.length ? { ...s, tools: s.tools + 1 } : { ...s, phase: "applying" });
        break;
      case "applying":
        wait = timing.applying;
        next = () => ({ ...s, phase: "done", startedAt: performance.now() });
        break;
      default:
        wait = timing.done;
        next = () => ({
          index: (s.index + 1) % scenarios.length,
          phase: "typing",
          typed: 0,
          tools: 0,
          startedAt: 0,
        });
    }
    const t = window.setTimeout(() => setS(next()), wait);
    return () => window.clearTimeout(t);
  }, [s, running]);

  const pick = useCallback(
    (index: number) => setS({ index, phase: "typing", typed: 0, tools: 0, startedAt: 0 }),
    [],
  );
  return { ...s, scenario: scenarios[s.index]!, pick };
}
