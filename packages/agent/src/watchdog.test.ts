import { afterEach, describe, expect, it, vi } from "vitest";
import { Watchdog } from "./types.ts";

describe("stall watchdog", () => {
  afterEach(() => vi.useRealTimers());

  it("calls a silent request stalled, but not while a tool runs or Claude streams", () => {
    vi.useFakeTimers();
    const stall = vi.fn();
    const w = new Watchdog(60_000, stall);
    // Claude streaming keeps it alive.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(30_000);
      w.beat();
    }
    // A long tool (a render) is not silence.
    w.tool(true);
    vi.advanceTimersByTime(5 * 60_000);
    expect(stall).not.toHaveBeenCalled();
    w.tool(false);
    vi.advanceTimersByTime(50_000);
    expect(stall).not.toHaveBeenCalled();
    // Then nothing at all: stalled, once.
    vi.advanceTimersByTime(20_000);
    expect(stall).toHaveBeenCalledTimes(1);
    expect(w.stalled).toBe(true);
    vi.advanceTimersByTime(5 * 60_000);
    expect(stall).toHaveBeenCalledTimes(1);
  });
});
