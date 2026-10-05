/** Facts about the machine the app runs on that change how it behaves. */
import { existsSync, readFileSync } from "node:fs";

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
