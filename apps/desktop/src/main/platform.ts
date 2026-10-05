/** Facts about the machine the app runs on that change how it behaves. */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Linux inside Windows (WSL): its own file system is fast, the Windows drives under /mnt are not. */
export const isWsl =
  process.platform === "linux" &&
  (!!process.env.WSL_DISTRO_NAME ||
    (existsSync("/proc/version") && /microsoft/i.test(readFileSync("/proc/version", "utf8"))));

/** A folder on a Windows drive, seen from WSL (/mnt/c/...): slow, and it never reports changes. */
export const onWindowsDrive = (dir: string) => isWsl && /^\/mnt\/[a-z]\//i.test(dir);

/** Ubuntu 24.04+ (AppArmor) refuses unprivileged user namespaces, which Chromium's sandbox falls back on. */
export function userNamespacesBlocked(): boolean {
  try {
    return readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1";
  } catch {
    return false;
  }
}

/** One command line, quoted for a POSIX shell. */
const posix = (argv: readonly string[]) => argv.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");

/** Terminal apps on Linux, and how each is told to run a command. */
const LINUX_TERMINALS: readonly (readonly string[])[] = [
  ["x-terminal-emulator", "-e"],
  ["gnome-terminal", "--"],
  ["konsole", "-e"],
  ["xfce4-terminal", "-x"],
  ["kitty"],
  ["alacritty", "-e"],
  ["wezterm", "start", "--"],
  ["xterm", "-e"],
];

const onPath = (name: string) =>
  (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, name))
    .find((file) => existsSync(file)) ?? null;

/**
 * Opens a terminal window running `file` with `args`, for things the user should do themselves (signing
 * in to Claude Code: its sign-in stays entirely its own). Terminal on macOS, a console on Windows, the
 * desktop's terminal on Linux. False when there's no terminal to open (a bare WSL, say): the caller shows
 * the command instead.
 */
export async function openTerminal(file: string, args: readonly string[]): Promise<boolean> {
  const exit = (cmd: string, argv: string[]) =>
    new Promise<boolean>((resolve) => {
      const child = spawn(cmd, argv, { stdio: "ignore", windowsHide: true });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  if (process.platform === "darwin") {
    const line = posix([file, ...args])
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    return exit("/usr/bin/osascript", [
      "-e",
      `tell application "Terminal"\nactivate\ndo script "${line}"\nend tell`,
    ]);
  }
  if (process.platform === "win32") {
    // cmd /k keeps the window open afterwards, so a message at the end can still be read.
    const inner = `/k ""${file}" ${args.join(" ")}"`.replace(/'/g, "''");
    return exit("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath 'cmd.exe' -ArgumentList '${inner}'`,
    ]);
  }
  for (const [name, ...flags] of LINUX_TERMINALS) {
    const bin = onPath(name!);
    if (!bin) continue;
    const opened = await new Promise<boolean>((resolve) => {
      const child = spawn(bin, [...flags, file, ...args], { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
    if (opened) return true;
  }
  return false;
}

/** The command line to show when a terminal couldn't be opened. */
export const commandLine = (file: string, args: readonly string[]) =>
  process.platform === "win32" ? `"${file}" ${args.join(" ")}` : posix([file, ...args]);
