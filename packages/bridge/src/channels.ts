/** Dependency-free so the sandboxed preload bundle stays tiny. */
export type EditorEventName =
  | "commit"
  | "agent"
  | "index"
  | "importDone"
  | "export"
  | "versions"
  | "claude"
  | "menu"
  | "library"
  | "downloads"
  | "reload"
  | "error";

/** IPC channel names. One place, so main and preload can never disagree. */
export const Channel = {
  restore: "project:restore",
  open: "project:open",
  create: "project:create",
  openDemo: "project:open-demo",
  recent: "project:recent",
  commit: "project:commit",
  importFiles: "project:import",
  pickAndImport: "project:pick-import",
  newFromVideos: "project:new-from-videos",
  attach: "project:attach",
  attachData: "project:attach-data",
  reveal: "project:reveal",
  showFile: "project:show-file",
  loadChat: "project:load-chat",
  saveChat: "project:save-chat",
  peaks: "index:peaks",
  retryIndex: "index:retry",
  describeShots: "index:describe",
  agentRun: "agent:run",
  agentCancel: "agent:cancel",
  agentStatus: "agent:status",
  checkKey: "settings:check-key",
  downloadsState: "downloads:state",
  downloadsPrepare: "downloads:prepare",
  libraryState: "library:state",
  libraryAdd: "library:add",
  libraryPickAndAdd: "library:pick-add",
  libraryReveal: "library:reveal",
  libraryUpdate: "library:update",
  librarySetRole: "library:set-role",
  libraryPlace: "library:place",
  libraryPickDir: "library:pick-dir",
  libraryKeep: "library:keep",
  diagnostics: "app:diagnostics",
  openLogs: "app:open-logs",
  claudeStatus: "claude:status",
  claudeInstall: "claude:install",
  claudeLogin: "claude:login",
  claudeUpdate: "claude:update",
  claudeCancel: "claude:cancel",
  exportStart: "export:start",
  exportCancel: "export:cancel",
  versionsList: "versions:list",
  versionsSave: "versions:save",
  versionsGenerate: "versions:generate",
  versionsDoc: "versions:doc",
  versionsUse: "versions:use",
  versionsRemove: "versions:remove",
  historyList: "history:list",
  historyRestore: "history:restore",
  kitsList: "kits:list",
  kitsSave: "kits:save",
  kitsApply: "kits:apply",
  kitsRemove: "kits:remove",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  event: (name: EditorEventName) => `event:${name}` as const,
} as const;
