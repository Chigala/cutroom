#!/usr/bin/env node
// Gathers every request from your projects' chats into bench/jev-prompts.json (gitignored: it holds
// your own words): what you asked, what the agent did about it, and how long it took. The Jev
// evaluation reads it to see which requests could skip the agent.
//
//   node apps/desktop/scripts/jev-prompts.mjs [folder…]
//
// Looks in the recent projects and, recursively, in the folders given (default ~/Movies).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.join(root, "bench/jev-prompts.json");
const CHAT = path.join(".history", "chat.json");

const userData =
  process.platform === "darwin"
    ? path.join(homedir(), "Library/Application Support/Cutroom")
    : process.platform === "win32"
      ? path.join(process.env.APPDATA ?? path.join(homedir(), "AppData/Roaming"), "Cutroom")
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "Cutroom");

const dirs = new Set();
try {
  for (const r of JSON.parse(readFileSync(path.join(userData, "recent.json"), "utf8"))) dirs.add(r.dir);
} catch {}

function walk(dir, depth) {
  if (depth < 0) return;
  if (existsSync(path.join(dir, CHAT))) dirs.add(dir);
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries)
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "media")
      walk(path.join(dir, e.name), depth - 1);
}
const roots = process.argv.slice(2);
for (const r of roots.length ? roots : [path.join(homedir(), "Movies")]) walk(path.resolve(r), 5);

const cases = [];
for (const dir of dirs) {
  const file = path.join(dir, CHAT);
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  let records;
  try {
    records = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const history = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.kind !== "user" || !r.text?.trim()) continue;
    const reply = records.slice(i + 1).find((x) => x.kind === "agent" || x.kind === "user");
    const agent = reply?.kind === "agent" ? reply : null;
    const tools = (agent?.work ?? [])
      .filter((w) => w.kind === "tool")
      .map((w) => ({ name: w.name, input: w.input, status: w.status }));
    cases.push({
      id: `${path.basename(dir)}#${cases.filter((c) => c.dir === dir).length + 1}`,
      dir,
      at: r.at,
      prompt: r.text,
      attachments: r.attachments?.length ?? 0,
      earlier: history.slice(-3),
      agent: agent && {
        status: agent.status,
        elapsedMs: agent.elapsedMs,
        changes: agent.steps.map((s) => s.text),
        tools,
        reply: agent.text.slice(0, 600),
      },
      // Fill in by hand (or with the labelling helper): what an instant path should have done.
      expect: null,
    });
    history.push(r.text);
  }
}
cases.sort((a, b) => a.at - b.at);
writeFileSync(out, `${JSON.stringify(cases, null, 2)}\n`);
console.log(`${cases.length} requests from ${dirs.size} projects → ${path.relative(root, out)}`);
