/**
 * Scores a project the way the benchmark does (checks plus measured motion), without the app or the
 * agent: `pnpm --filter @vedit/desktop score <project folder>`. Reads the project and writes nothing to
 * it (render scratch goes in the system's temporary folder).
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearArea } from "@vedit/checks";
import { resolveDerived } from "@vedit/media";
import { CACHE_DIR, FONTS_DIR } from "@vedit/project";
import { ProjectStore } from "@vedit/project/node";
import { senseMotion } from "@vedit/render";
import { scoreEdit } from "../src/main/bench-score.ts";

const dir = path.resolve(process.argv[2] ?? ".");
const doc = (await ProjectStore.open(dir)).doc;
const motion = await senseMotion({
  doc,
  entry: {
    kind: "source",
    path: path.resolve(import.meta.dirname, "../../../packages/render/src/entry.tsx"),
    outDir: path.join(os.tmpdir(), "vedit-score-bundle"),
  },
  workDir: path.join(os.tmpdir(), `vedit-sense-${process.pid}`),
  safeZone: clearArea(doc.checkRules),
  resolve: async (key) => {
    if (key.includes("~")) return resolveDerived(dir, doc, key, doc.meta.format.fps);
    if (key.startsWith(`${FONTS_DIR}/`)) return path.join(dir, key);
    const s = doc.sources.find((x) => x.id === key.replace(/\?.*$/, ""));
    if (!s?.path) return null;
    const proxy = path.join(dir, CACHE_DIR, "proxy", `${s.id}.mp4`);
    return s.kind === "video" && existsSync(proxy) ? proxy : s.path;
  },
  onProgress: (f, label) => process.stderr.write(`\r${label} ${Math.round(f * 100)}%   `),
});
process.stderr.write("\n");
const score = scoreEdit(doc, motion);
console.log(JSON.stringify(score, null, 2));
for (const i of motion.issues)
  console.log(`${i.start.toFixed(2)}s ${i.kind} (${i.items.join(", ")}): ${i.detail}`);
process.exit(0);
