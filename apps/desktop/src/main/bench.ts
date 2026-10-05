/**
 * The benchmark: the same footage and the same brief, edited from scratch by the agent, scored, every
 * time the editor changes. Run the app with VEDIT_BENCH=<cases.json> and it works headless (its own
 * settings and data, so it never touches yours), writes each case's project into the output folder, and
 * a results.json and report.md comparing with the run before:
 *
 *   { "out": "~/Movies/vedit-bench",
 *     "cases": [{ "name": "watch-talk", "clips": ["/path/a.mp4"], "brief": "A 40 second TikTok..." }] }
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "@vedit/bridge";
import { z } from "zod";
import { type EditScore, scoreEdit } from "./bench-score.ts";
import type { ProjectService } from "./project-service.ts";

const BenchSpec = z.object({
  out: z.string().default("~/Movies/vedit-bench"),
  cases: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9-]{1,40}$/, "lower-case letters, digits and dashes"),
        clips: z.array(z.string()).min(1),
        brief: z.string().min(1).max(8000),
        /** Follow-up requests after the first cut, in order (a revision round). */
        followUps: z.array(z.string().max(8000)).default([]),
      }),
    )
    .min(1),
});

interface CaseResult {
  readonly name: string;
  readonly dir: string;
  readonly indexMs: number;
  readonly agentMs: number;
  readonly steps: number;
  readonly error: string | null;
  readonly score: EditScore | null;
}

const home = (p: string) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

export async function runBench(service: ProjectService, file: string): Promise<string> {
  const spec = BenchSpec.parse(JSON.parse(await readFile(file, "utf8")));
  const out = home(spec.out);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const root = path.join(out, stamp);
  await mkdir(root, { recursive: true });
  const results: CaseResult[] = [];
  for (const c of spec.cases) {
    const dir = path.join(root, c.name);
    console.log(`[bench] ${c.name}: importing ${c.clips.length} clips`);
    const t0 = Date.now();
    let indexMs = 0;
    let agentMs = 0;
    let steps = 0;
    let error: string | null = null;
    try {
      const imported = service.waitFor("importDone", () => true, 3_600_000);
      await service.benchProject(dir, c.clips.map(home));
      await imported;
      indexMs = Date.now() - t0;
      for (const [i, prompt] of [c.brief, ...c.followUps].entries()) {
        console.log(`[bench] ${c.name}: request ${i + 1}`);
        const t1 = Date.now();
        const { runId } = await service.runAgent({ prompt, depth: i === 0 ? "thorough" : "quick" });
        const counted = service.on("agent", (e: AgentEvent) => {
          if (e.runId === runId && e.type === "step") steps++;
        });
        const end = await service.waitFor(
          "agent",
          (e: AgentEvent) => e.runId === runId && (e.type === "done" || e.type === "error"),
          3_600_000,
        );
        counted();
        agentMs += Date.now() - t1;
        if (end.type === "error") throw new Error(end.message);
      }
    } catch (err) {
      error = (err as Error).message.slice(0, 400);
      console.error(`[bench] ${c.name} failed:`, error);
    }
    let score: EditScore | null = null;
    const doc = service.currentDoc();
    if (doc?.scenes.length) {
      console.log(`[bench] ${c.name}: scoring`);
      const motion = await service.senseMotion(doc).catch((err: unknown) => {
        console.error("[bench] motion measuring failed:", err);
        return null;
      });
      score = scoreEdit(doc, motion);
    }
    results.push({ name: c.name, dir, indexMs, agentMs, steps, error, score });
    await writeFile(path.join(root, "results.json"), `${JSON.stringify({ stamp, results }, null, 2)}\n`);
  }
  const previous = await previousRun(out, stamp);
  await writeFile(path.join(root, "report.md"), report(stamp, results, previous));
  console.log(`[bench] done: ${path.join(root, "report.md")}`);
  return root;
}

/** The most recent earlier run's results. */
async function previousRun(
  out: string,
  stamp: string,
): Promise<{ stamp: string; results: CaseResult[] } | null> {
  const runs = (await readdir(out).catch(() => [] as string[])).filter((d) => d < stamp).sort();
  for (const d of runs.reverse()) {
    const f = path.join(out, d, "results.json");
    if (existsSync(f)) return JSON.parse(await readFile(f, "utf8"));
  }
  return null;
}

function report(
  stamp: string,
  results: CaseResult[],
  previous: { stamp: string; results: CaseResult[] } | null,
) {
  const delta = (now: number | undefined, before: number | undefined, better: "up" | "down" = "up") => {
    if (now === undefined || before === undefined || now === before) return "";
    const d = now - before;
    const good = better === "up" ? d > 0 : d < 0;
    return ` (${d > 0 ? "+" : ""}${Math.round(d * 10) / 10}${good ? " ✓" : " ✗"})`;
  };
  const rows = results.map((r) => {
    const p = previous?.results.find((x) => x.name === r.name);
    const s = r.score;
    const ps = p?.score;
    if (!s) return `| ${r.name} | failed: ${r.error ?? "no edit"} | | | | | |`;
    const failed = r.error ? ` ⚠ ${r.error}` : "";
    return [
      "",
      r.name,
      `**${s.score}**${delta(s.score, ps?.score)}${failed}`,
      `${s.checks.passed}/${s.checks.total}${delta(s.checks.passed, ps?.checks.passed)}`,
      `${s.motion?.issues ?? "?"}${delta(s.motion?.issues, ps?.motion?.issues ?? undefined, "down")}`,
      `${s.edit.duration}s · ${s.edit.shots} shots · ${s.edit.visuals} visuals (${s.edit.graphicKinds} kinds)`,
      `${Math.round(r.agentMs / 1000)}s${delta(r.agentMs / 1000, p ? p.agentMs / 1000 : undefined, "down")}`,
      `${r.steps}`,
      "",
    ]
      .join(" | ")
      .trim();
  });
  const details = results
    .filter((r) => r.score)
    .map((r) => {
      const s = r.score!;
      return [
        `### ${r.name}`,
        s.checks.failing.length ? `Failing checks: ${s.checks.failing.join(", ")}` : "All checks pass.",
        s.motion
          ? `Motion: ${
              Object.entries(s.motion.byKind)
                .map(([k, n]) => `${n} ${k}`)
                .join(", ") || "clean"
            }; ${s.motion.entries} entries${s.motion.onBeat !== null ? `, ${s.motion.onBeat} on the beat` : ""}; face covered ${s.motion.faceCovered}s.`
          : "Motion: not measured.",
        `Project: ${r.dir}`,
      ].join("\n");
    });
  return [
    `# Benchmark ${stamp}`,
    previous ? `Compared with ${previous.stamp}.` : "First run.",
    "",
    "| case | score | checks | motion issues | edit | agent time | steps |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...details,
    "",
  ].join("\n");
}
