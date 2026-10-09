import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The public landing page: a static build, nothing server-side. */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: { port: 5278, strictPort: false },
  build: { target: "es2022", chunkSizeWarningLimit: 600 },
});
