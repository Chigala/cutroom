/**
 * Voice clean-up with DeepFilterNet (open source, MIT/Apache): a small neural network that takes room
 * noise and echo out of speech, which EQ and a spectral denoiser can't. The binary installs once into
 * the app's tools folder on first use, checked against a pinned hash, and runs locally.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundledTool, run } from "./exec.ts";

export const DEEP_FILTER_VERSION = "0.5.6";

/** Release binaries we've checked, by platform: download name and SHA-256. */
export const DEEP_FILTER_BINARIES: Partial<
  Record<string, { readonly name: string; readonly sha256: string }>
> = {
  "darwin-arm64": {
    name: `deep-filter-${DEEP_FILTER_VERSION}-aarch64-apple-darwin`,
    sha256: "4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081",
  },
};

/** How hard to clean: the most it may take out of the sound, dB. Off leaves the voice as recorded. */
export const VOICE_CLEAN_DB = { off: 0, light: 12, medium: 24, strong: 100 } as const;
export type VoiceClean = keyof typeof VOICE_CLEAN_DB;

const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

const installing = new Map<string, Promise<string>>();

/** The binary, downloaded and verified on first use. Null on a platform without a checked build. */
export function ensureDeepFilter(
  dir: string,
  platform = `${process.platform}-${process.arch}`,
): Promise<string | null> {
  // Shipped with the app: nothing to download.
  const shipped = platform === `${process.platform}-${process.arch}` ? bundledTool("deep-filter") : null;
  if (shipped) return Promise.resolve(shipped);
  const bin = DEEP_FILTER_BINARIES[platform];
  if (!bin) return Promise.resolve(null);
  const file = path.join(dir, bin.name);
  let hit = installing.get(file);
  if (!hit) {
    hit = (async () => {
      if ((await sha256(file).catch(() => "")) === bin.sha256) return file;
      await mkdir(dir, { recursive: true });
      const url = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${DEEP_FILTER_VERSION}/${bin.name}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't download the voice cleaner (${res.status})`);
      const partial = `${file}.part`;
      await writeFile(partial, Buffer.from(await res.arrayBuffer()));
      if ((await sha256(partial)) !== bin.sha256) {
        await rm(partial, { force: true });
        throw new Error("The voice cleaner download didn't match its checksum; not using it");
      }
      await chmod(partial, 0o755);
      await rename(partial, file);
      return file;
    })().catch((err: unknown) => {
      installing.delete(file);
      throw err;
    });
    installing.set(file, hit);
  }
  return hit;
}

/**
 * Takes noise and echo out of a 48 kHz voice track. Returns false (and leaves `output` unwritten) when
 * the cleaner isn't available here, so the export carries on with the voice as it was.
 */
export async function cleanVoice(
  input: string,
  output: string,
  { toolsDir, strength, signal }: { toolsDir: string; strength: VoiceClean; signal?: AbortSignal },
): Promise<boolean> {
  if (strength === "off") return false;
  const bin = await ensureDeepFilter(toolsDir);
  if (!bin) return false;
  // Next to the output, so the result moves into place without crossing disks.
  const out = await mkdtemp(path.join(path.dirname(output), ".clean-"));
  try {
    await run(
      bin,
      ["-D", "-a", String(VOICE_CLEAN_DB[strength]), "-o", out, input],
      signal ? { signal } : {},
    );
    const [made] = (await readdir(out)).filter((f) => f.endsWith(".wav"));
    if (!made) return false;
    await rename(path.join(out, made), output);
    return true;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
