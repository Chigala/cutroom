/**
 * The update manifests a release carries (latest-mac.yml, beta-mac.yml…): what an installed copy reads to
 * find its next version. The Intel and Apple silicon Macs are built on separate runners, so each writes a
 * latest-mac.yml naming only its own files; a release needs one naming both (electron-updater picks the
 * file for its architecture by the "arm64" in its name). This merges them.
 *
 * electron-builder writes these in a fixed shape: top-level `key: value` lines, and `files:` followed by
 * `  - url: …` entries indented under it. That's all this reads.
 */

interface Manifest {
  /** Top-level lines other than `files:`, in order: "version: 0.2.0", "path: …", "releaseDate: '…'". */
  readonly top: string[];
  /** Each file entry's lines, as written ("  - url: …", "    sha512: …"). */
  readonly files: string[][];
}

function parse(text: string): Manifest {
  const top: string[] = [];
  const files: string[][] = [];
  let inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line === "files:") {
      inFiles = true;
      continue;
    }
    if (inFiles && line.startsWith(" ")) {
      if (line.trimStart().startsWith("- ")) files.push([line]);
      else files.at(-1)?.push(line);
      continue;
    }
    inFiles = false;
    top.push(line);
  }
  return { top, files };
}

const field = (m: Manifest, key: string) =>
  m.top
    .find((l) => l.startsWith(`${key}:`))
    ?.slice(key.length + 1)
    .trim();
const url = (entry: string[]) => entry[0]!.replace(/^\s*- url:\s*/, "").trim();

/** One manifest naming every architecture's files. All must be for the same version. */
export function mergeMacManifests(texts: readonly string[]): string {
  if (!texts.length) throw new Error("no manifests to merge");
  const all = texts.map(parse);
  const versions = new Set(all.map((m) => field(m, "version")));
  if (versions.size !== 1)
    throw new Error(`the manifests are for different versions: ${[...versions].join(", ")}`);
  const seen = new Set<string>();
  const files = all
    .flatMap((m) => m.files)
    .filter((entry) => {
      const u = url(entry);
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  // The rest (path, sha512 for older updaters) from the first; the newest release date of them all.
  const dates = all.map((m) => field(m, "releaseDate")).filter((d): d is string => !!d);
  const newest = dates.sort().at(-1);
  const [first] = all;
  const top = first!.top.map((l) => (l.startsWith("releaseDate:") && newest ? `releaseDate: ${newest}` : l));
  const version = top.filter((l) => l.startsWith("version:"));
  const rest = top.filter((l) => !l.startsWith("version:"));
  return `${[...version, "files:", ...files.flat(), ...rest].join("\n")}\n`;
}
