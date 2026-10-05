import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "warn";
  /** A button on it: "Keep in your library". The toast goes once it's pressed. */
  action?: { label: string; run: () => void };
}

export const useToasts = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));

export const dismissToast = (id: number) =>
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

let next = 1;
export function toast(text: string, tone: Toast["tone"] = "info", action?: Toast["action"]): void {
  const id = next++;
  useToasts.setState((s) => ({
    toasts: [...s.toasts.slice(-2), { id, text, tone, ...(action && { action }) }],
  }));
  // One with a button stays long enough to decide.
  setTimeout(() => dismissToast(id), action ? 9000 : tone === "warn" ? 6000 : 3500);
}
