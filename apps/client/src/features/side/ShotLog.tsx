/**
 * The visual transcript: what every shot in the cut shows, segment by segment, from indexing's shot log
 * (sources/shots.json), in the order and at the times the video plays them. Click a line to go there.
 * Standout shots that aren't in the cut are listed after, one click from asking Claude to use them.
 */

import { ArrowCounterClockwiseIcon, FilmSlateIcon, StarIcon } from "@phosphor-icons/react";
import { formatTime, outputOffset, type ShotSegment, timelineOf } from "@vedit/project";
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { host } from "../../lib/host.ts";
import { send, useChat } from "../../state/chat.ts";
import { useJobs } from "../../state/jobs.ts";
import { seekTime } from "../../state/playback.ts";
import { useDoc, useProject } from "../../state/project.ts";

/** Standout shots not in the cut listed before "Show all". */
const UNUSED_SHOWN = 12;

interface Line {
  readonly key: string;
  readonly at: number;
  readonly seg: ShotSegment;
}

interface Group {
  readonly scene: string;
  readonly label: string;
  readonly lines: readonly Line[];
}

export function ShotLog() {
  const doc = useProject((s) => s.doc!);
  const describing = useJobs((s) => Object.values(s.indexing).some((e) => e.stage === "describe"));
  const busy = useChat((s) => s.activeRun !== null);
  const logs = useDoc((d) => d.shotLogs);
  const sources = useDoc((d) => d.sources);
  const [allUnused, setAllUnused] = useState(false);
  // Indexed clips with no description: Claude was unreachable when they indexed.
  const missing = useDoc(
    (d) =>
      d.sources.filter(
        (s) =>
          s.kind === "video" &&
          s.status === "ready" &&
          !d.shotLogs.some((l) => l.id === s.id && l.segments.length),
      ).length,
  );
  const [asked, setAsked] = useState(false);
  const describeNow = () => {
    setAsked(true);
    void host.index.describe().finally(() => setAsked(false));
  };
  const retryRow =
    missing > 0 && !describing ? (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/60 px-3 py-2 text-xs text-muted">
        <span className="min-w-0 flex-1">
          {missing === 1 ? "A clip hasn't" : `${missing} clips haven't`} been described yet: Claude wasn't
          reachable when {missing === 1 ? "it" : "they"} indexed.
        </span>
        <button
          type="button"
          disabled={asked}
          onClick={describeNow}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-button px-2 py-1 text-xs text-fg-2 hover:bg-chip disabled:opacity-40"
        >
          <ArrowCounterClockwiseIcon size={12} /> {asked ? "Describing…" : "Describe now"}
        </button>
      </div>
    ) : null;

  const { groups, unused } = useMemo(() => {
    const tl = timelineOf(doc);
    const byId = new Map(logs.map((l) => [l.id, l]));
    const used = new Map<string, [number, number][]>();
    const groups: Group[] = tl.scenes.flatMap((p) => {
      const { scene, start } = p;
      used.set(scene.source, [...(used.get(scene.source) ?? []), [scene.in, scene.out]]);
      const segs = byId.get(scene.source)?.segments.filter((s) => s.end > scene.in && s.start < scene.out);
      if (!segs?.length) return [];
      const label = sources.find((s) => s.id === scene.source)?.label ?? scene.source;
      return [
        {
          scene: scene.id,
          label,
          lines: segs.map((seg, i) => ({
            key: `${scene.id}:${i}`,
            at: start + outputOffset(scene, Math.max(0, seg.start - scene.in)),
            seg,
          })),
        },
      ];
    });
    // Highlights from footage the cut doesn't use.
    const unused = logs.flatMap((log) =>
      log.segments
        .filter((s) => s.highlight && !(used.get(log.id) ?? []).some(([a, b]) => s.end > a && s.start < b))
        .map((seg) => ({
          key: `${log.id}:${seg.start}`,
          source: log.id,
          label: sources.find((s) => s.id === log.id)?.label ?? log.id,
          seg,
        })),
    );
    // Strongest first: a long event can hold dozens of standout moments.
    unused.sort((a, b) => b.seg.energy - a.seg.energy);
    return { groups, unused };
  }, [doc, logs, sources]);

  if (!groups.length && !unused.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <FilmSlateIcon size={22} className="text-faint" weight="light" />
        <span className="text-[13px] text-muted">
          {describing
            ? "Watching your footage. What each shot shows appears here as it's ready."
            : "Indexing writes down what each shot shows: framing, motion, energy, standout moments. (It can be turned off in Settings.)"}
        </span>
        {retryRow}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {retryRow}
      {groups.map((g) => (
        <section key={g.scene} className="flex flex-col gap-1">
          <span className="px-1 font-mono text-[10.5px] text-faint">
            {g.scene} · {g.label}
          </span>
          {g.lines.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => seekTime(l.at)}
              className="flex flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-raised"
            >
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
                {formatTime(l.at, true)}
                {l.seg.highlight && (
                  <StarIcon size={11} className="fill-accent text-accent" aria-label="Highlight" />
                )}
                <span className="text-faint">
                  {l.seg.shot} · {l.seg.camera}
                </span>
                <Energy n={l.seg.energy} />
              </span>
              <span className="text-[12.5px] leading-snug text-fg-2">{l.seg.what}</span>
              {l.seg.quality.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {l.seg.quality.map((q) => (
                    <span key={q} className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">
                      {q}
                    </span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
      {unused.length > 0 && (
        <section className="flex flex-col gap-1 border-t border-line pt-3">
          <span className="px-1 text-[11px] font-medium text-muted">Standout shots not in the cut</span>
          {(allUnused ? unused : unused.slice(0, UNUSED_SHOWN)).map((u) => (
            <div key={u.key} className="flex items-start gap-2 rounded-md px-2 py-1.5">
              <StarIcon size={11} className="mt-1 shrink-0 fill-accent text-accent" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[12.5px] leading-snug text-fg-2">{u.seg.what}</span>
                <span className="font-mono text-[10px] text-faint">
                  {u.label} · {formatTime(u.seg.start, true)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void send(
                    `Use the standout shot from ${u.source} at ${u.seg.start.toFixed(1)}s to ${u.seg.end.toFixed(1)}s ("${u.seg.what}") where it fits best.`,
                  )
                }
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                Use it
              </button>
            </div>
          ))}
          {!allUnused && unused.length > UNUSED_SHOWN && (
            <button
              type="button"
              onClick={() => setAllUnused(true)}
              className="self-start rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-raised hover:text-fg"
            >
              Show all {unused.length}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Energy, 1 calm to 5 explosive, as five pips. */
function Energy({ n }: { n: number }) {
  return (
    <span className="flex gap-px" title={`Energy ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={clsx("h-1.5 w-1 rounded-[1px]", i <= n ? "bg-fg-3" : "bg-line-strong")} />
      ))}
    </span>
  );
}
