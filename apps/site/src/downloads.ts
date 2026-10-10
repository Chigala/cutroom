/**
 * Where the Download buttons point: the newest release's installers, in the public releases-only
 * repository the "Build installers" workflow fills. The names carry no version (electron-builder.yml),
 * so these links stay right release after release; the version shown is asked of GitHub (useLatest).
 * Windows and Linux show as coming soon until their installers ship.
 */
import { useEffect, useState } from "react";

const base = "https://github.com/Chigala/cutroom-releases/releases/latest/download";

export type Os = "mac" | "windows" | "linux";

export const downloads: Record<
  Os,
  { name: string; soon?: boolean; files: { label: string; href: string }[] }
> = {
  mac: {
    name: "macOS",
    files: [
      { label: "Apple silicon", href: `${base}/Cutroom-arm64.dmg` },
      { label: "Intel", href: `${base}/Cutroom-x64.dmg` },
    ],
  },
  windows: { name: "Windows", soon: true, files: [] },
  linux: { name: "Linux", soon: true, files: [] },
};

export const MAC_DOWNLOAD = downloads.mac.files[0]!.href;

/** The newest release's version ("0.1.1"), once GitHub says; null until then, or if it can't be asked. */
export function useLatest(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const ask = new AbortController();
    fetch("https://api.github.com/repos/Chigala/cutroom-releases/releases/latest", { signal: ask.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { tag_name?: string } | null) => setVersion(r?.tag_name?.replace(/^v/, "") ?? null))
      .catch(() => {});
    return () => ask.abort();
  }, []);
  return version;
}

export function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return "mac";
}
