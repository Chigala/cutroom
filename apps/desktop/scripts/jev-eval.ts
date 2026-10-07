// Replays your past requests (bench/jev-prompts.json, from jev-prompts.mjs) through instant edits: each
// against its project as it was when you asked, rebuilt from the project's history. Writes what Jev
// would have done next to what the agent did to bench/jev-results.json (gitignored), and a summary.
//
//   node --experimental-transform-types apps/desktop/scripts/jev-eval.ts [--dry] [--limit N]
//
// Asks Jev through VEDIT_JEV_URL (the proxy) or TYPESAFE_API_KEY. --dry builds every request and checks
// its size without calling anyone. Projects are read from copies (no media): yours aren't touched.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ask,
  decode,
  evaluate,
  type Instant,
  type JevEndpoint,
  type JevReply,
  precheck,
  TYPESAFE_URL,
} from "../../../packages/instant/src/index.ts";
import { type Commit, type ProjectDoc, rewind } from "../../../packages/project/src/index.ts";
import { ProjectStore, readLog } from "../../../packages/project/src/node/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;

interface Case {
  id: string;
  dir: string;
  at: number;
  prompt: string;
  attachments: number;
  earlier: string[];
  agent: { status: string; elapsedMs: number | null; changes: string[]; tools: { name: string }[] } | null;
}

const cases = (JSON.parse(readFileSync(path.join(root, "bench/jev-prompts.json"), "utf8")) as Case[]).slice(
  0,
  limit,
);

function endpoint(): JevEndpoint | null {
  const proxy = process.env.VEDIT_JEV_URL?.trim();
  if (proxy)
    return {
      url: `${proxy.replace(/\/+$/, "")}/v1/instant`,
      headers: { "x-cutroom-install": `eval-${randomUUID()}` },
    };
  const key = process.env.TYPESAFE_API_KEY?.trim();
  return key ? { url: TYPESAFE_URL, headers: { authorization: `Bearer ${key}` } } : null;
}
const jev = dry ? null : endpoint();
if (!dry && !jev) {
  console.error("Set VEDIT_JEV_URL or TYPESAFE_API_KEY, or pass --dry.");
  process.exit(1);
}

// Each project once: a copy without media, opened, with its log.
const work = path.join(tmpdir(), `cutroom-jev-eval-${process.pid}`);
const projects = new Map<string, { doc: ProjectDoc; log: Commit[] } | null>();
async function project(dir: string) {
  if (projects.has(dir)) return projects.get(dir)!;
  let loaded: { doc: ProjectDoc; log: Commit[] } | null = null;
  try {
    const copy = path.join(work, String(projects.size));
    mkdirSync(copy, { recursive: true });
    execFileSync("rsync", ["-a", "--exclude=media", "--exclude=.cache", `${dir}/`, `${copy}/`]);
    const store = await ProjectStore.open(copy);
    loaded = { doc: store.doc, log: await readLog(copy) };
  } catch (err) {
    console.error(`  can't open ${dir}: ${(err as Error).message.slice(0, 120)}`);
  }
  projects.set(dir, loaded);
  return loaded;
}

/** The project as it was when the request was sent: the log rewound past everything after it. */
function docAt(p: { doc: ProjectDoc; log: Commit[] }, at: number): ProjectDoc | null {
  const later = p.log.filter((c) => c.at > at);
  try {
    return rewind(p.doc, later);
  } catch {
    return null;
  }
}

interface Row {
  id: string;
  prompt: string;
  route: Instant | { kind: "skipped"; why: string };
  jevMs?: number;
  tokens?: number;
  /** Jev's answers, kept so decoding can be tuned again without asking again (--redecode). */
  answers?: JevReply["answers"];
  agent: { ms: number | null; changes: string[]; tools: string[] } | null;
}

const rows: Row[] = [];
let sizes = 0;
for (const c of cases) {
  const agent = c.agent && {
    ms: c.agent.elapsedMs,
    changes: c.agent.changes,
    tools: [...new Set(c.agent.tools.map((t) => t.name))],
  };
  const early = precheck(c.prompt, c.attachments);
  if (early) {
    rows.push({ id: c.id, prompt: c.prompt, route: early, agent });
    continue;
  }
  const p = await project(c.dir);
  const doc = p && docAt(p, c.at);
  if (!p || !doc) {
    rows.push({ id: c.id, prompt: c.prompt, route: { kind: "skipped", why: "project unavailable" }, agent });
    continue;
  }
  const undoable = p.log.filter(
    (x) => x.at < c.at && (x.author === "user" || x.author === "agent") && !x.reverts,
  );
  const recent = undoable
    .toReversed()
    .slice(0, 12)
    .map((x) => ({ id: x.id, label: x.message.slice(0, 120) }));
  const { body, asked } = ask(doc, c.prompt, { earlier: c.earlier, recent });
  const size = JSON.stringify(body).length;
  sizes += size;
  if (dry) {
    rows.push({
      id: c.id,
      prompt: c.prompt,
      route: { kind: "skipped", why: `dry run, ${size} chars` },
      agent,
    });
    continue;
  }
  let reply: JevReply | undefined;
  let failed = "";
  // The proxy allows each install 30 requests a minute: wait out a 429 rather than skip the request.
  for (let attempt = 0; attempt < 8 && !reply; attempt++) {
    try {
      // A fresh install id each time: one run is many installs' worth of requests, to the proxy.
      reply = await evaluate(endpoint()!, body, { timeoutMs: 15_000 });
    } catch (err) {
      failed = (err as Error).message;
      if (!/\b429\b/.test(failed)) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  if (!reply) {
    rows.push({ id: c.id, prompt: c.prompt, route: { kind: "skipped", why: failed }, agent });
    continue;
  }
  const route = decode(doc, c.prompt, reply.answers, asked);
  rows.push({
    id: c.id,
    prompt: c.prompt,
    route,
    jevMs: reply.ms,
    answers: reply.answers,
    ...(reply.inputTokens !== undefined && { tokens: reply.inputTokens }),
    agent,
  });
  process.stdout.write(route.kind === "agent" ? "." : "!");
}
console.log();

const out = path.join(root, dry ? "bench/jev-results.dry.json" : "bench/jev-results.json");
if (!existsSync(path.dirname(out))) mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);

const count = (k: string) => rows.filter((r) => r.route.kind === k).length;
const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const instant = rows.filter((r) => ["edit", "undo", "same"].includes(r.route.kind));
const tokens = rows.reduce((n, r) => n + (r.tokens ?? 0), 0);
console.log(`${rows.length} requests → ${path.relative(root, out)}`);
console.log(
  `  instant: ${instant.length} (edit ${count("edit")}, undo ${count("undo")}, already ${count("same")}) · agent: ${count("agent")} · skipped: ${count("skipped")}`,
);
if (dry) console.log(`  average request ${Math.round(sizes / Math.max(1, rows.length))} chars`);
else {
  console.log(
    `  Jev median ${median(rows.flatMap((r) => (r.jevMs ? [r.jevMs] : [])))} ms, ${tokens} tokens ($${((tokens / 1e6) * 0.042).toFixed(4)})`,
  );
  console.log(
    `  the agent took a median ${Math.round(median(instant.flatMap((r) => (r.agent?.ms ? [r.agent.ms] : []))) / 1000)}s on the requests Jev would do instantly`,
  );
  for (const r of instant) {
    const what =
      r.route.kind === "edit" || r.route.kind === "same"
        ? r.route.label
        : `undo ${r.route.kind === "undo" ? r.route.commit : ""}`;
    console.log(
      `  ⚡ ${r.prompt.slice(0, 70).padEnd(70)} → ${what}   (agent: ${r.agent?.changes.join("; ").slice(0, 60) ?? "-"})`,
    );
  }
}
