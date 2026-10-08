/**
 * The only bridge between the page and the system. It exposes EditorApi and nothing else: no ipcRenderer,
 * no Node. Kept dependency-free (just channel names) so it stays small and loads instantly.
 */
import type { EditorApi, EditorEvents } from "@vedit/bridge";
import { Channel } from "@vedit/bridge/channels";
import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * A call to the main process. Its errors arrive as "Error invoking remote method 'x': Error: …": the
 * window gets just the message, as written for people.
 */
const invoke = <T>(channel: string, ...args: unknown[]) =>
  (ipcRenderer.invoke(channel, ...args) as Promise<T>).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, ""));
  });

const api: EditorApi = {
  kind: "desktop",
  project: {
    restore: () => invoke(Channel.restore),
    open: (dir) => invoke(Channel.open, dir),
    create: (name, folder) => invoke(Channel.create, name, folder),
    openDemo: () => invoke(Channel.openDemo),
    recent: () => invoke(Channel.recent),
    folders: () => invoke(Channel.folders),
    newFolder: (name) => invoke(Channel.newFolder, name),
    pin: (dir, pinned) => invoke(Channel.pin, dir, pinned),
    rename: (dir, name) => invoke(Channel.rename, dir, name),
    move: (dir, folder) => invoke(Channel.move, dir, folder),
    thumbnail: (dir) => invoke(Channel.thumbnail, dir),
    duplicate: (dir, from) => invoke(Channel.duplicate, dir, from),
    trash: (dir) => invoke(Channel.trash, dir),
    showProject: (dir) => invoke(Channel.showProject, dir),
    commit: (req) => invoke(Channel.commit, req),
    importFiles: (paths) => invoke(Channel.importFiles, paths),
    pickAndImport: () => invoke(Channel.pickAndImport),
    newFromVideos: (folder) => invoke(Channel.newFromVideos, folder),
    attach: (paths) => invoke(Channel.attach, paths),
    attachData: (name, bytes) => invoke(Channel.attachData, name, bytes),
    reveal: (rel) => invoke(Channel.reveal, rel),
    showFile: (file) => invoke(Channel.showFile, file),
    loadChat: () => invoke(Channel.loadChat),
    saveChat: (records, dir) => invoke(Channel.saveChat, records, dir),
  },
  index: {
    peaks: (id) => invoke(Channel.peaks, id),
    retry: (id) => invoke(Channel.retryIndex, id),
    describe: () => invoke(Channel.describeShots),
  },
  codex: {
    status: (refresh) => invoke(Channel.codexStatus, refresh),
    login: () => invoke(Channel.codexLogin),
    cancelLogin: () => invoke(Channel.codexCancelLogin),
    logout: () => invoke(Channel.codexLogout),
  },
  agent: {
    run: (req) => invoke(Channel.agentRun, req),
    cancel: (runId) => invoke(Channel.agentCancel, runId),
    status: () => invoke(Channel.agentStatus),
    keep: (runId) => invoke(Channel.agentKeep, runId),
    discard: (runId) => invoke(Channel.agentDiscard, runId),
    active: () => invoke(Channel.agentActive),
  },
  downloads: {
    state: () => invoke(Channel.downloadsState),
    prepare: (what) => invoke(Channel.downloadsPrepare, what),
  },
  library: {
    state: () => invoke(Channel.libraryState),
    add: (paths, scope) => invoke(Channel.libraryAdd, paths, scope),
    pickAndAdd: (scope) => invoke(Channel.libraryPickAndAdd, scope),
    reveal: (scope) => invoke(Channel.libraryReveal, scope),
    update: (id, patch) => invoke(Channel.libraryUpdate, id, patch),
    setRole: (role, id) => invoke(Channel.librarySetRole, role, id),
    place: (id, at) => invoke(Channel.libraryPlace, id, at),
    pickDir: () => invoke(Channel.libraryPickDir),
    keep: (ids) => invoke(Channel.libraryKeep, ids),
  },
  app: {
    diagnostics: () => invoke(Channel.diagnostics),
    openLogs: () => invoke(Channel.openLogs),
  },
  updates: {
    state: () => invoke(Channel.updateState),
    check: () => invoke(Channel.updateCheck),
    download: () => invoke(Channel.updateDownload),
    install: () => invoke(Channel.updateInstall),
  },
  claude: {
    status: (refresh) => invoke(Channel.claudeStatus, refresh),
    install: () => invoke(Channel.claudeInstall),
    login: () => invoke(Channel.claudeLogin),
    update: () => invoke(Channel.claudeUpdate),
    cancel: () => invoke(Channel.claudeCancel),
  },
  exporter: {
    start: () => invoke(Channel.exportStart),
    cancel: (jobId) => invoke(Channel.exportCancel, jobId),
  },
  history: {
    list: () => invoke(Channel.historyList),
    restore: (id) => invoke(Channel.historyRestore, id),
  },
  kits: {
    list: () => invoke(Channel.kitsList),
    save: (name, id) => invoke(Channel.kitsSave, name, id),
    apply: (id) => invoke(Channel.kitsApply, id),
    remove: (id) => invoke(Channel.kitsRemove, id),
  },
  inspirations: {
    list: () => invoke(Channel.inspirationsList),
    read: (id) => invoke(Channel.inspirationsRead, id),
    apply: (id, keepLook) => invoke(Channel.inspirationsApply, id, keepLook),
    stop: () => invoke(Channel.inspirationsStop),
    save: (id) => invoke(Channel.inspirationsSave, id),
    remove: (id) => invoke(Channel.inspirationsRemove, id),
    reveal: () => invoke(Channel.inspirationsReveal),
  },
  settings: {
    get: () => invoke(Channel.settingsGet),
    set: (patch) => invoke(Channel.settingsSet, patch),
    checkKey: (provider, key) => invoke(Channel.checkKey, provider, key),
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  on(event, listener) {
    const channel = Channel.event(event);
    const wrapped = (_e: Electron.IpcRendererEvent, payload: EditorEvents[typeof event]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("editor", api);
