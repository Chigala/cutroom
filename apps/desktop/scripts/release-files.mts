/**
 * Gathers what each build runner made (one folder per runner, as actions/download-artifact leaves them)
 * into the one folder a release is made from. The Macs' update manifests (latest-mac.yml…), one per
 * architecture, become one naming both (src/main/update-manifests.ts); any other name made twice is an error.
 *
 *   jiti apps/desktop/scripts/release-files.mts <artifacts folder> <release folder>
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mergeMacManifests } from "../src/main/update-manifests.ts";

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error("usage: release-files.mts <artifacts folder> <release folder>");
  process.exit(1);
}

const files = readdirSync(from, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => path.join(e.parentPath, e.name));
mkdirSync(to, { recursive: true });

const manifests = new Map<string, string[]>();
const copied = new Map<string, string>();
for (const file of files) {
  const name = path.basename(file);
  if (/-mac\.yml$/.test(name)) {
    manifests.set(name, [...(manifests.get(name) ?? []), readFileSync(file, "utf8")]);
    continue;
  }
  const other = copied.get(name);
  if (other) throw new Error(`two builds made ${name}: ${other} and ${file}`);
  copied.set(name, file);
  copyFileSync(file, path.join(to, name));
}
for (const [name, texts] of manifests) writeFileSync(path.join(to, name), mergeMacManifests(texts));

console.log(`${copied.size + manifests.size} files in ${to}:`);
for (const name of [...copied.keys(), ...manifests.keys()].sort()) console.log(`  ${name}`);
