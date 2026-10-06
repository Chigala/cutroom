import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Boundary } from "./components/Boundary.tsx";
import { useProject } from "./state/project.ts";

if (import.meta.env.DEV) Object.assign(window, { __project: useProject });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The last net: anything outside the panels' own fails here, never to a blank window. */}
    <Boundary
      name="window"
      className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-8 text-center"
    >
      <App />
    </Boundary>
  </StrictMode>,
);
