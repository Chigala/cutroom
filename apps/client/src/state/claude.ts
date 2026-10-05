/**
 * Claude Code as the editor runs it: where it is, who it's signed in as, and the install, sign-in or
 * update in progress (kept here, not in the dialog, so closing Settings mid-sign-in loses nothing).
 */
import type { ClaudeStatus, ClaudeTask } from "@vedit/bridge";
import { create } from "zustand";
import { host } from "../lib/host.ts";

export const useClaude = create<{
  status: ClaudeStatus | null;
  task: ClaudeTask | null;
  checking: boolean;
}>()(() => ({ status: null, task: null, checking: false }));

export async function checkClaude(refresh = false): Promise<void> {
  useClaude.setState({ checking: true });
  try {
    useClaude.setState({ status: await host.claude.status(refresh) });
  } finally {
    useClaude.setState({ checking: false });
  }
}

let listening = false;
/** Follows install, sign-in and update tasks; when one ends, Claude Code is looked at again. */
export function followClaude(): void {
  if (listening) return;
  listening = true;
  host.on("claude", (task) => {
    useClaude.setState({ task });
    if (task.state !== "running") void checkClaude();
  });
}
