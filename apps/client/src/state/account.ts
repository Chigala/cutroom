/**
 * The Cutroom account: who's signed in, and a sign-in in progress (kept here, so leaving the screen
 * mid-sign-in loses nothing).
 */
import type { AccountProvider, AccountStatus } from "@vedit/bridge";
import { create } from "zustand";
import { host } from "../lib/host.ts";
import { toast } from "./toast.ts";

export const useAccount = create<{ status: AccountStatus | null; signingIn: AccountProvider | null }>()(
  () => ({
    status: null,
    signingIn: null,
  }),
);

export async function checkAccount(): Promise<void> {
  try {
    useAccount.setState({ status: await host.account.status() });
  } catch (err) {
    toast((err as Error).message, "warn");
  }
}

/** Sign in in the browser: resolves when it's done, failed or given up. */
export async function signInAccount(provider: AccountProvider): Promise<void> {
  if (useAccount.getState().signingIn) return;
  useAccount.setState({ signingIn: provider });
  try {
    const status = await host.account.signIn(provider);
    useAccount.setState({ status });
    if (status.error) toast(status.error, "warn");
    else if (status.user) toast(`Signed in as ${status.user.email}.`);
  } catch (err) {
    toast((err as Error).message, "warn");
  } finally {
    useAccount.setState({ signingIn: null });
  }
}

export const cancelSignIn = () => void host.account.cancelSignIn();

export async function signOutAccount(): Promise<void> {
  useAccount.setState({ status: await host.account.signOut() });
}
