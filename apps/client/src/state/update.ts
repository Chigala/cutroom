/** Cutroom's own update, kept up to date by the host: what the header's pill and Settings show. */
import type { UpdateState } from "@vedit/bridge";
import { create } from "zustand";
import { host } from "../lib/host.ts";
import { toast } from "./toast.ts";

export const useUpdate = create<{ state: UpdateState }>()(() => ({ state: { status: "off" } }));

/**
 * Follows the host's update state. A failed download says so, and a check the user asked for gets its
 * answer as a toast.
 */
export function connectUpdates(): () => void {
  const off = host.on("update", (state) => {
    useUpdate.setState({ state });
    if (state.status === "error" && state.version)
      toast(`The update couldn't download. Click Update ${state.version} to get it from its page.`, "warn");
    if (!state.asked) return;
    if (state.status === "current") toast("Cutroom is up to date.");
    else if (state.status === "error" && !state.version) toast("Couldn't check for updates.", "warn");
  });
  void host.updates.state().then((state) => useUpdate.setState({ state }));
  return off;
}

/** Looks now (from Settings); the answer arrives through the host's event. */
export function checkNow(): void {
  void host.updates.check();
}
