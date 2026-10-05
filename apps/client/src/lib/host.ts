import type { EditorApi } from "@vedit/bridge";
import { createWebHost } from "./web-host.ts";

declare global {
  interface Window {
    /** Injected by the Electron preload. Absent in a plain browser. */
    readonly editor?: EditorApi;
  }
}

/** The project host: the desktop app's main process, or an in-memory stand-in in a browser. */
export const host: EditorApi = window.editor ?? createWebHost();

/** URL prefix the composition uses to load footage and the graphic runtime. In a browser, the dev
 * server's /__media/ stands in for the desktop app's media:// protocol. */
const BASE = window.editor ? "media://project/" : "/__media/";
/**
 * The open project's media address. Each project gets its own host (from its folder), so a clip id
 * that two projects share ("clip_1") is never served from the last project's footage: the preview's
 * video elements and frame caches see a new address the moment a project opens. A live binding:
 * readers always get the current project's.
 */
export let MEDIA_BASE = BASE;
export function setMediaProject(dir: string | null): void {
  if (!window.editor || !dir) {
    MEDIA_BASE = BASE;
    return;
  }
  let h = 2166136261;
  for (let i = 0; i < dir.length; i++) h = Math.imul(h ^ dir.charCodeAt(i), 16777619);
  MEDIA_BASE = `media://p${(h >>> 0).toString(36)}/`;
}
