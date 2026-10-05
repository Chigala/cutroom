import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Content Security Policy, injected per mode. Production is strict: no inline scripts, no eval, network
 * limited to our own origin and the media protocol. Dev relaxes script-src for React Fast Refresh.
 */
function csp(mode: string): Plugin {
  const dev = mode === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: media:",
    // Remotion primes its shared audio tags with a silent data: mp3.
    "media-src 'self' blob: data: media:",
    "font-src 'self' data: media:",
    "worker-src 'self' blob:",
    // Scripted graphics run in a sandboxed frame served by the media protocol (or /__media/ in a browser).
    "frame-src 'self' media:",
    `connect-src 'self' media:${dev ? " ws://localhost:* http://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "csp",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: policy },
        injectTo: "head-prepend",
      },
    ],
  };
}

/**
 * In a plain browser there is no media:// protocol, so the dev server stands in for the part graphics
 * need: /__media/runtime/* is the sandboxed graphic runtime and its libraries, with the runtime's own
 * CSP. The helpers are loaded through Vite so their TypeScript runs as is.
 */
function graphicRuntime(): Plugin {
  const helpers = path.resolve(import.meta.dirname, "../../packages/render/src/runtime.ts");
  return {
    name: "graphic-runtime",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__media/runtime/", async (req, res, next) => {
        try {
          const { runtimeFile, runtimeHeaders } = (await server.ssrLoadModule(helpers)) as {
            runtimeFile: (path: string) => string | null;
            runtimeHeaders: (origin: string, rel: string) => Record<string, string>;
          };
          const rel = decodeURIComponent((req.url ?? "").split("?")[0]!.replace(/^\//, ""));
          // Resolves only the runtime's own whitelist of files; anything else is a 404.
          const file = runtimeFile(rel);
          if (!file) {
            res.statusCode = 404;
            return res.end();
          }
          for (const [k, v] of Object.entries(runtimeHeaders(`http://${req.headers.host}`, rel)))
            res.setHeader(k, v);
          (await import("node:fs")).createReadStream(file).pipe(res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), tailwindcss(), csp(mode), graphicRuntime()],
  server: { port: 5273, strictPort: false },
  build: {
    outDir: path.resolve(import.meta.dirname, "../desktop/dist/renderer"),
    emptyOutDir: true,
    target: "chrome140",
    sourcemap: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
  },
}));
