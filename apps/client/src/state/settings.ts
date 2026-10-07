/**
 * The app's settings as the composer shows them (the model and how hard it thinks), kept in step with
 * the Settings dialog: both save through saveSettings.
 */
import type { Settings } from "@vedit/bridge";
import { create } from "zustand";
import { host } from "../lib/host.ts";

export const useSettings = create<{ settings: Settings | null }>()(() => ({ settings: null }));

export async function loadSettings(): Promise<Settings> {
  const settings = await host.settings.get();
  useSettings.setState({ settings });
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = await host.settings.set(patch);
  useSettings.setState({ settings });
  return settings;
}

/** The agent that edits, by name ("Claude", "Codex"), for what the app says while it works. */
export function agentName(): string {
  return useSettings.getState().settings?.harness === "codex" ? "Codex" : "Claude";
}
