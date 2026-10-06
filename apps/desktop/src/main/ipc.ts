import type { Diagnostics, KeyProvider } from "@vedit/bridge";
import { Channel } from "@vedit/bridge/channels";
import { app, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import { z } from "zod";
import { claudeStatus } from "./claude.ts";
import { checkKey } from "./keys.ts";
import { logsDir, recentProblems } from "./log.ts";
import type { ProjectService } from "./project-service.ts";
import { assertTrustedSender } from "./security.ts";
import { getSettings, publicSettings, setSettings } from "./settings.ts";

type Handler = (...args: unknown[]) => unknown;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const PROVIDERS: readonly KeyProvider[] = ["pixabay", "pexels", "klipy", "groq"];

function diagnostics(): Diagnostics {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    os: `${process.platform === "darwin" ? "macOS" : process.platform} ${process.getSystemVersion()} (${process.arch})`,
    logsDir: logsDir(),
    problems: recentProblems().slice(0, 50),
  };
}

/** Every handler checks its sender first; payloads are validated inside the services with zod. */
export function registerIpc(service: ProjectService): void {
  const handlers: Record<string, Handler> = {
    [Channel.restore]: () => service.restore(),
    [Channel.open]: (dir) => service.open(typeof dir === "string" ? dir : undefined),
    [Channel.create]: (name) => service.create(str(name).trim() || "Untitled"),
    [Channel.openDemo]: () => service.openDemo(),
    [Channel.recent]: () => service.recent(),
    [Channel.commit]: (req) => service.commit(req),
    [Channel.importFiles]: (paths) => service.importFiles(paths),
    [Channel.pickAndImport]: () => service.pickAndImport(),
    [Channel.newFromVideos]: () => service.newFromVideos(),
    [Channel.attach]: (paths) => service.attach(paths),
    [Channel.attachData]: (name, bytes) => service.attachData(name, bytes),
    [Channel.reveal]: (rel) => service.reveal(rel),
    [Channel.showFile]: (file) => service.showFile(file),
    [Channel.loadChat]: () => service.loadChat(),
    [Channel.saveChat]: (records) => service.saveChat(records),
    [Channel.peaks]: (id) => service.indexer.peaks(str(id)),
    [Channel.retryIndex]: (id) => service.retryIndex(id),
    [Channel.describeShots]: () => service.describeMissing(),
    [Channel.agentRun]: (req) => service.runAgent(req),
    [Channel.agentCancel]: (runId) => service.cancel(runId),
    [Channel.agentStatus]: () => service.agentStatus(),
    [Channel.agentKeep]: (runId) => service.keepPartial(runId),
    [Channel.agentDiscard]: (runId) => service.discardPartial(runId),
    [Channel.agentActive]: () => service.activeRuns(),
    [Channel.checkKey]: (provider, key) =>
      PROVIDERS.includes(provider as KeyProvider)
        ? checkKey(provider as KeyProvider, str(key).slice(0, 500))
        : Promise.resolve("invalid"),
    [Channel.downloadsState]: () => service.downloads.state(),
    [Channel.downloadsPrepare]: (what) =>
      service.downloads.prepare(what === "models" ? "models" : "transcription"),
    [Channel.libraryState]: () => service.library.state(),
    [Channel.libraryAdd]: async (paths, scope) => {
      const files = z.array(z.string().max(2000)).max(500).parse(paths);
      await service.library.add(files, scope === "project" ? "project" : "library");
    },
    [Channel.libraryPickAndAdd]: (scope) =>
      service.pickLibraryFiles(scope === "project" ? "project" : "library"),
    [Channel.libraryReveal]: async (scope) => {
      await shell.openPath(await service.library.folder(scope === "project" ? "project" : "library"));
    },
    [Channel.libraryUpdate]: (id, patch) =>
      service.library.update(
        str(id),
        z
          .object({
            name: z.string().max(120).optional(),
            description: z.string().max(400).optional(),
            tags: z.array(z.string().max(40)).max(24).optional(),
          })
          .parse(patch),
      ),
    [Channel.librarySetRole]: (role, id) =>
      service.library.setRole(str(role), typeof id === "string" ? id : null),
    [Channel.libraryPlace]: (id, at) => service.placeAsset(str(id), typeof at === "number" ? at : 0),
    [Channel.libraryPickDir]: () => service.pickLibraryDir(),
    [Channel.libraryKeep]: (ids) => service.keepInLibrary(z.array(z.string().max(64)).max(200).parse(ids)),
    [Channel.diagnostics]: () => diagnostics(),
    [Channel.openLogs]: async () => {
      await shell.openPath(logsDir());
    },
    [Channel.claudeStatus]: (refresh) => claudeStatus(refresh === true),
    [Channel.claudeInstall]: () => service.claude.install(),
    [Channel.claudeLogin]: () => service.claude.login(),
    [Channel.claudeUpdate]: () => service.claude.update(),
    [Channel.claudeCancel]: () => service.claude.cancel(),
    [Channel.exportStart]: () => service.exporter.start(),
    [Channel.exportCancel]: (jobId) => service.exporter.cancel(jobId),
    [Channel.versionsList]: () => service.versions.list(),
    [Channel.versionsSave]: (name) => service.versions.save(name),
    [Channel.versionsGenerate]: (prompt, count) => {
      // Long-running: answer now, report through events.
      void service.versions.generate(prompt, count);
    },
    [Channel.versionsDoc]: (id) => service.versions.doc(id),
    [Channel.versionsUse]: (id) => service.versions.use(id),
    [Channel.versionsRemove]: (id) => service.versions.remove(id),
    [Channel.historyList]: () => service.versions.history(),
    [Channel.historyRestore]: (id) => service.versions.restore(id),
    [Channel.kitsList]: () => service.listKits(),
    [Channel.kitsSave]: (name, id) => service.saveKit(str(name), typeof id === "string" ? id : undefined),
    [Channel.kitsApply]: (id) => service.applyKit(str(id)),
    [Channel.kitsRemove]: (id) => service.removeKit(str(id)),
    [Channel.inspirationsList]: () => service.listInspirations(),
    [Channel.inspirationsRead]: (id) => service.readInspiration(str(id)),
    [Channel.inspirationsApply]: (id, keepLook) => service.applyInspiration(str(id), keepLook === true),
    [Channel.inspirationsStop]: () => service.stopInspiration(),
    [Channel.inspirationsSave]: (id) => service.saveInspiration(str(id)),
    [Channel.inspirationsRemove]: (id) => service.removeInspiration(str(id)),
    [Channel.inspirationsReveal]: () => service.revealInspirations(),
    // The window never gets the API keys back (see publicSettings).
    [Channel.settingsGet]: async () => publicSettings(await getSettings()),
    // A new backend or key may make Claude reachable: describe what it couldn't before.
    [Channel.settingsSet]: async (patch) => {
      const fields = patch && typeof patch === "object" ? Object.keys(patch).join(", ") : typeof patch;
      try {
        const saved = publicSettings(await setSettings(patch));
        console.log(`[settings] saved ${fields}`);
        if (patch && typeof patch === "object" && "claudePath" in patch) await claudeStatus(true);
        void service.describeMissing();
        return saved;
      } catch (err) {
        console.error(`[settings] couldn't save ${fields}:`, (err as Error).message.slice(0, 300));
        throw err;
      }
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedSender(event);
      return handler(...args);
    });
  }
}
