/**
 * Copies the graphics runtime's libraries (gsap, lottie, three) and the built-in fonts into
 * dist/runtime-assets: the packaged app ships no node_modules, and serves them from there
 * (VEDIT_RUNTIME_ASSETS, set in src/main/index.ts).
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { runtimeAssets } from "@vedit/render";

const out = path.resolve(import.meta.dirname, "../dist/runtime-assets");
rmSync(out, { recursive: true, force: true });
const assets = runtimeAssets();
for (const [rel, file] of assets) {
  mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  copyFileSync(file, path.join(out, rel));
}
console.log(`copied ${assets.length} runtime assets to dist/runtime-assets`);
