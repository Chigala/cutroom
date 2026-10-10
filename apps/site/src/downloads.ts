/**
 * Where the Download buttons point. The installers come from the "Build installers" workflow
 * (.github/workflows/build.yml), which puts them in the public releases-only repository; the names
 * follow electron-builder's defaults for 0.1.0. Change them here with each version. Windows and Linux
 * show as coming soon until their installers ship.
 */
export const VERSION = "0.1.0";
const base = "https://github.com/Chigala/cutroom-releases/releases/latest/download";

export type Os = "mac" | "windows" | "linux";

export const downloads: Record<
  Os,
  { name: string; soon?: boolean; files: { label: string; href: string }[] }
> = {
  mac: {
    name: "macOS",
    files: [
      { label: "Apple silicon", href: `${base}/Cutroom-${VERSION}-arm64.dmg` },
      { label: "Intel", href: `${base}/Cutroom-${VERSION}-x64.dmg` },
    ],
  },
  windows: { name: "Windows", soon: true, files: [] },
  linux: { name: "Linux", soon: true, files: [] },
};

export const MAC_DOWNLOAD = downloads.mac.files[0]!.href;

export function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return "mac";
}
