import path from "node:path";
import { bundle } from "@remotion/bundler";
import { build } from "vite";
import { buildMain, buildPreload, clientDir, desktopDir, renderEntry } from "./bundle.mjs";

const started = performance.now();
const skipRemotion = process.argv.includes("--no-remotion");
await Promise.all([
  build({ configFile: path.join(clientDir, "vite.config.ts"), mode: "production", logLevel: "warn" }),
  buildMain(),
  buildPreload(),
  // The export renderer's web bundle, prebuilt so the packaged app never runs webpack.
  skipRemotion
    ? null
    : bundle({
        entryPoint: renderEntry,
        outDir: path.join(desktopDir, "dist/remotion"),
        enableCaching: true,
      }),
]);
console.log(`built in ${Math.round(performance.now() - started)}ms`);
