// Builds the main process (ESM) and the preload (CommonJS: sandboxed preloads cannot be ESM) with Vite.
// Everything, workspace packages included, is bundled in, so the app ships without node_modules.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

export const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const clientDir = path.resolve(desktopDir, "../client");
export const renderEntry = path.resolve(desktopDir, "../../packages/render/src/entry.tsx");

/**
 * Left out of the main bundle and shipped as node_modules (runtime-deps.mjs): they carry native binaries
 * (the Agent SDK's Claude Code, Remotion's compositor) or resolve files relative to themselves. zod too,
 * so the Agent SDK and the app share one copy (tool schemas pass between them).
 */
export const RUNTIME = [
  "@anthropic-ai/claude-agent-sdk",
  "@remotion/renderer",
  "@remotion/install-whisper-cpp",
  "zod",
];

/** Also left out, and not shipped: Remotion's webpack bundler runs only in development. */
export const NATIVE = [...RUNTIME, "@remotion/bundler"];

const shared = (mode, watch) => ({
  configFile: false,
  root: desktopDir,
  mode,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify(mode) },
  build: {
    target: "node22",
    sourcemap: true,
    minify: false,
    reportCompressedSize: false,
    watch: watch ? {} : null,
  },
});

export function buildMain({ mode = "production", watch = false } = {}) {
  const base = shared(mode, watch);
  return build({
    ...base,
    define: { ...base.define, __RENDER_ENTRY__: JSON.stringify(renderEntry) },
    ssr: { noExternal: true, external: NATIVE, target: "node" },
    build: {
      ...base.build,
      ssr: "src/main/index.ts",
      outDir: "dist/main",
      emptyOutDir: true,
      rolldownOptions: {
        external: ["electron", ...NATIVE, /^@remotion\/(compositor|bundler|renderer)/, /^zod\//],
        output: { format: "es", entryFileNames: "index.js" },
      },
    },
  });
}

export function buildPreload({ mode = "production", watch = false } = {}) {
  const base = shared(mode, watch);
  return build({
    ...base,
    build: {
      ...base.build,
      outDir: "dist/preload",
      emptyOutDir: true,
      lib: { entry: "src/preload/index.ts", formats: ["cjs"], fileName: () => "index.cjs" },
      rolldownOptions: { external: ["electron"] },
    },
  });
}
