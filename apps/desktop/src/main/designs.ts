/**
 * The designs of the user's recent videos (designs.json in the app's data folder), so a new video's design
 * can be held apart from them: the agent's design tool compares against these. One entry per project, the
 * newest of each, the last dozen projects.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Design, type PastDesign } from "@vedit/project";
import { z } from "zod";
import { samePath } from "./folders.ts";

const KEEP = 12;

const Entry = z.object({ dir: z.string(), name: z.string(), design: Design, at: z.string() });
type Entry = z.infer<typeof Entry>;

async function load(file: string): Promise<Entry[]> {
  try {
    return z.array(Entry).parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return [];
  }
}

/** The recent designs of every project but `dir`, newest first. */
export async function recentDesigns(file: string, dir: string): Promise<PastDesign[]> {
  return (await load(file))
    .filter((e) => !samePath(e.dir, dir))
    .map(({ name, design }) => ({ name, design }));
}

/** Writes one at a time: two projects finishing together (one in the background) both land. */
let writing: Promise<void> = Promise.resolve();

/** Notes a project's design (an unset one is nothing to remember). */
export function recordDesign(file: string, dir: string, name: string, design: Design): Promise<void> {
  if (!design.idea && !design.display && !design.palette.length) return Promise.resolve();
  const write = async () => {
    const kept = (await load(file)).filter((e) => !samePath(e.dir, dir));
    const next = [{ dir, name, design, at: new Date().toISOString() }, ...kept].slice(0, KEEP);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, file);
  };
  writing = writing.then(write, write);
  return writing;
}
