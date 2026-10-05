/**
 * The app was called "Video Editor" before it became Cutroom, and kept its data (settings, recent
 * projects, window place, logs, the demo project) in a folder of that name. On the first launch as
 * Cutroom, whatever is there moves into the new folder, entry by entry, so nothing already in the new
 * one is overwritten. Imported first by index.ts: it must run before anything reads the data folder.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

const FORMER_NAME = "Video Editor";

const from = path.join(app.getPath("appData"), FORMER_NAME);
const to = app.getPath("userData");
if (from !== to && existsSync(from)) {
  try {
    mkdirSync(to, { recursive: true });
    let moved = 0;
    for (const entry of readdirSync(from)) {
      const target = path.join(to, entry);
      if (existsSync(target)) continue;
      renameSync(path.join(from, entry), target);
      moved++;
    }
    // Gone once everything moved; anything left (a name both had) stays where it was.
    if (!readdirSync(from).length) rmdirSync(from);
    if (moved) console.log(`[rename] moved ${moved} items from ${from} to ${to}`);
  } catch (err) {
    console.warn(`[rename] couldn't move ${from} to ${to}: ${(err as Error).message}`);
  }
}
