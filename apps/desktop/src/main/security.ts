/**
 * Hardening that applies to every window. The renderer is treated as untrusted: it gets no Node, runs
 * sandboxed, can't open windows or navigate away, and gets no device permissions.
 */
import { app, type IpcMainInvokeEvent, session, shell } from "electron";

export const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
export const APP_ORIGIN = "app://bundle";

/** Origins allowed to load in our windows and to call IPC. */
export function isTrustedUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    // Node's URL gives custom schemes an opaque "null" origin, so compare scheme and host instead.
    if (url.protocol === "app:" && url.host === "bundle") return true;
    return Boolean(DEV_SERVER_URL && url.origin === new URL(DEV_SERVER_URL).origin);
  } catch {
    return false;
  }
}

/** Rejects IPC from anything but our own top-level page. */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null || !isTrustedUrl(frame.url)) {
    throw new Error(`blocked IPC from ${frame?.url ?? "unknown frame"}`);
  }
}

export function harden(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}
