/**
 * The editor window's place and size, kept across launches (<app data>/window.json), and the app menu.
 * A saved place that's no longer on any screen (an unplugged display) falls back to the default.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MenuAction } from "@vedit/bridge";
import { app, type BrowserWindow, Menu, type MenuItemConstructorOptions, screen, shell } from "electron";
import { logsDir } from "./log.ts";

export interface WindowPlace {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
  readonly maximized?: boolean;
  readonly fullScreen?: boolean;
}

const file = () => path.join(app.getPath("userData"), "window.json");
const DEFAULT: WindowPlace = { width: 1440, height: 900 };

/** Where the window was, if that's still on a screen; else the default size, centred. */
export function savedPlace(min: { width: number; height: number }): WindowPlace {
  try {
    const p = JSON.parse(readFileSync(file(), "utf8")) as WindowPlace;
    if (!(p.width >= min.width && p.height >= min.height)) return DEFAULT;
    if (p.x === undefined || p.y === undefined) return { width: p.width, height: p.height };
    // At least a good handful of it on some display, or it would open out of reach.
    const visible = screen.getAllDisplays().some(({ workArea: a }) => {
      const w = Math.min(p.x! + p.width, a.x + a.width) - Math.max(p.x!, a.x);
      const h = Math.min(p.y! + p.height, a.y + a.height) - Math.max(p.y!, a.y);
      return w >= 200 && h >= 120;
    });
    return visible ? p : { width: p.width, height: p.height };
  } catch {
    return DEFAULT;
  }
}

/** Keeps the window's place up to date: a moment after it moves or resizes, and when it closes. */
export function rememberPlace(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    // The size it returns to, not the maximised or full-screen one.
    const b = win.getNormalBounds();
    const place: WindowPlace = {
      ...b,
      ...(win.isMaximized() && { maximized: true }),
      ...(win.isFullScreen() && { fullScreen: true }),
    };
    try {
      const tmp = `${file()}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(place));
      renameSync(tmp, file());
    } catch {}
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  for (const e of [
    "resize",
    "move",
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
  ] as const)
    win.on(e as "resize", later);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

/**
 * The app menu: the standard ones (Edit's copy and paste, View's zoom, Window), plus the editor's own
 * Settings…, Open Project… and, under Help, the logs. `send` asks the editor's window to act.
 */
export function setAppMenu(send: (action: MenuAction) => void, dev: boolean): void {
  const mac = process.platform === "darwin";
  const settings: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => send("settings"),
  };
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              settings,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => send("openProject") },
        { label: "All Projects…", accelerator: "CmdOrCtrl+Shift+O", click: () => send("projects") },
        ...(mac
          ? []
          : [
              { type: "separator" } as const,
              settings,
              { type: "separator" } as const,
              { role: "quit" } as const,
            ]),
        ...(mac ? [{ type: "separator" } as const, { role: "close" } as const] : []),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(dev
          ? [{ role: "reload" } as const, { role: "toggleDevTools" } as const, { type: "separator" } as const]
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Diagnostics…", click: () => send("diagnostics") },
        { label: "Open Logs Folder", click: () => void shell.openPath(logsDir()) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
