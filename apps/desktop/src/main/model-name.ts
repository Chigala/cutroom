/** A model id as people say it: "claude-opus-5-5" is "Opus 5.5"; Codex's plan default is "Codex". */
export function modelName(harness: "claude" | "codex", id: string): string {
  if (!id) return harness === "codex" ? "Codex" : "Claude";
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ""}`;
}
