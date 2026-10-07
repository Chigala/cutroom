/**
 * Codex as the editor runs it: where it is, who it's signed in as (in Cutroom's own Codex folder), its
 * models, and a sign-in in progress (kept here, so closing Settings mid-sign-in loses nothing).
 */
import type { CodexStatus } from "@vedit/bridge";
import { create } from "zustand";
import { host } from "../lib/host.ts";
import { notePlanLimits } from "./chat.ts";
import { toast } from "./toast.ts";

export const useCodex = create<{ status: CodexStatus | null; checking: boolean; signingIn: boolean }>()(
  () => ({
    status: null,
    checking: false,
    signingIn: false,
  }),
);

export async function checkCodex(refresh = false): Promise<void> {
  if (refresh && useCodex.getState().checking) return;
  useCodex.setState({ checking: true });
  try {
    const status = await host.codex.status(refresh);
    useCodex.setState({ status });
    if (status.limits) notePlanLimits("codex", status.limits);
  } catch (err) {
    toast((err as Error).message, "warn");
  } finally {
    useCodex.setState({ checking: false });
  }
}

/** Sign in with ChatGPT: the browser opens; this resolves when it's done, failed or given up. */
export async function signInCodex(): Promise<void> {
  if (useCodex.getState().signingIn) return;
  useCodex.setState({ signingIn: true });
  try {
    const status = await host.codex.login();
    useCodex.setState({ status });
    if (status.signedIn) toast(`Codex is signed in${status.email ? ` as ${status.email}` : ""}.`);
  } catch (err) {
    toast((err as Error).message, "warn");
  } finally {
    useCodex.setState({ signingIn: false });
  }
}

export async function signOutCodex(): Promise<void> {
  useCodex.setState({ status: await host.codex.logout() });
}
