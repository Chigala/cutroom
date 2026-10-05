/**
 * Claude Code as the editor runs it: where it is, who it's signed in as, and the install, sign-in or
 * update in progress (kept here, not in the dialog, so closing Settings mid-sign-in loses nothing).
 */
import type { ClaudeStatus, ClaudeTask } from "@vedit/bridge";
import { useEffect } from "react";
import { create } from "zustand";
import { host } from "../lib/host.ts";

export const useClaude = create<{
  status: ClaudeStatus | null;
  task: ClaudeTask | null;
  checking: boolean;
}>()(() => ({ status: null, task: null, checking: false }));

export async function checkClaude(refresh = false): Promise<void> {
  // One look at a time: a refresh runs Claude Code, which takes a moment.
  if (refresh && useClaude.getState().checking) return;
  useClaude.setState({ checking: true });
  try {
    useClaude.setState({ status: await host.claude.status(refresh) });
  } finally {
    useClaude.setState({ checking: false });
  }
}

let listening = false;
/**
 * Follows install, sign-in and update tasks; when one ends, Claude Code is looked at again. So is coming
 * back to the app while it isn't signed in: people sign in in their own terminal too.
 */
export function followClaude(): void {
  if (listening) return;
  listening = true;
  host.on("claude", (task) => {
    useClaude.setState({ task });
    if (task.state !== "running") void checkClaude();
  });
  window.addEventListener("focus", () => {
    if (useClaude.getState().status?.signedIn !== true) void checkClaude(true);
  });
}

/**
 * While a screen about Claude (Settings → Claude, onboarding's Claude step) is open: looks fresh when it
 * opens, then every few seconds until Claude Code is signed in, so signing in anywhere shows up here.
 */
export function useClaudeWatch(): void {
  const signedIn = useClaude((s) => s.status?.signedIn === true);
  const busy = useClaude((s) => s.task?.state === "running");
  useEffect(() => {
    followClaude();
    void checkClaude(true);
  }, []);
  useEffect(() => {
    if (signedIn || busy) return;
    const t = setInterval(() => void checkClaude(true), 4000);
    return () => clearInterval(t);
  }, [signedIn, busy]);
}
