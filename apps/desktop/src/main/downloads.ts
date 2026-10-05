/**
 * What the app is downloading for itself (speech recognition, the open models), as the window shows it:
 * what, for what, how far. Fed by the media package's reporter. Onboarding starts the big ones early, so
 * they're ready by the first import instead of holding it up.
 */
import type { DownloadState, DownloadTarget } from "@vedit/bridge";
import { ensureModel, ensureWhisper, type ModelName, onDownload, useOpenModels } from "@vedit/media";
import { getSettings, whisperSetup } from "./settings.ts";

/** The open models a Windows or Linux machine needs (sounds' weights and labels come with it). */
const OPEN_MODELS: readonly ModelName[] = [
  "faces",
  "people",
  "sounds",
  "soundsData",
  "soundLabels",
  "cutouts",
];

export class Downloads {
  private readonly list = new Map<string, DownloadState>();

  constructor(private readonly emit: (list: DownloadState[]) => void) {
    onDownload((d) => {
      this.list.set(d.id, d);
      this.emit(this.state());
    });
  }

  state(): DownloadState[] {
    return [...this.list.values()];
  }

  /** Starts a download in the background; its progress (or failure) arrives as `downloads` events. */
  async prepare(what: DownloadTarget): Promise<void> {
    if (what === "transcription") {
      const s = await getSettings();
      // Groq transcribes in the cloud: nothing to download.
      if (s.transcriber === "groq") return;
      const setup = whisperSetup(s);
      void ensureWhisper(setup).catch((err: Error) =>
        console.warn("[downloads] speech recognition:", err.message),
      );
      return;
    }
    if (!useOpenModels()) return;
    void (async () => {
      for (const name of OPEN_MODELS)
        await ensureModel(name).catch((err: Error) => console.warn(`[downloads] ${name}:`, err.message));
    })();
  }
}
