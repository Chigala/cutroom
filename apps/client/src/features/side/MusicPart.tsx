/**
 * Which part of the music plays: the whole track with the chosen part highlighted. Drag its edges (they
 * snap to beats) or the part itself, loop it to fill the video, or let the editor pick the best part
 * for the video's length: a stretch with no flat spots, or a seamless loop on downbeats.
 */
import { bestStretch, timelineOf } from "@vedit/project";
import { useEffect, useRef, useState } from "react";
import { peaksOf } from "../../state/jobs.ts";
import { edit, useDoc } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { Waveform } from "../timeline/Timeline.tsx";

type Drag = { kind: "start" | "end" | "move"; x: number; start: number; end: number };

export function MusicPart() {
  const music = useDoc((d) => d.music);
  const source = useDoc((d) => (d.music.source ? d.sources.find((s) => s.id === d.music.source) : undefined));
  const analysis = useDoc((d) =>
    d.music.source ? d.analyses.find((a) => a.id === d.music.source) : undefined,
  );
  const length = useDoc((d) => timelineOf(d).duration);
  const bar = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [peaks, setPeaks] = useState<Uint8Array | null>(null);

  useEffect(() => {
    let alive = true;
    if (source) void peaksOf(source.id).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [source]);

  if (!source?.duration) return null;
  const total = source.duration;
  const part = draft ?? music.section ?? { start: music.offset, end: total };
  const grid = analysis?.beats ?? [];
  const snap = (t: number) => {
    let best = t;
    let d = 0.15;
    for (const g of grid)
      if (Math.abs(g - t) < d) {
        d = Math.abs(g - t);
        best = g;
      }
    return Math.round(Math.min(total, Math.max(0, best)) * 100) / 100;
  };
  const commit = (patch: Record<string, unknown>, message: string) =>
    edit([{ op: "merge", key: "music", patch }], { message });

  const onDown = (kind: Drag["kind"]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, start: part.start, end: part.end };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const w = bar.current?.clientWidth ?? 1;
    if (!d) return;
    const dt = ((e.clientX - d.x) / w) * total;
    if (d.kind === "start") setDraft({ start: Math.min(snap(d.start + dt), d.end - 1), end: d.end });
    else if (d.kind === "end") setDraft({ start: d.start, end: Math.max(snap(d.end + dt), d.start + 1) });
    else {
      const len = d.end - d.start;
      const s = snap(Math.min(total - len, Math.max(0, d.start + dt)));
      setDraft({ start: s, end: Math.round((s + len) * 100) / 100 });
    }
  };
  const onUp = () => {
    if (drag.current && draft)
      commit({ section: draft }, `Music: ${draft.start.toFixed(1)}-${draft.end.toFixed(1)}s`);
    drag.current = null;
    setDraft(null);
  };
  const pick = (mode: "auto" | "loop") => {
    if (!peaks?.length) return toast("The track is still being measured.", "warn");
    const s = bestStretch(peaks, length, {
      duration: total,
      ...(analysis?.downbeats && { downbeats: analysis.downbeats }),
      ...(analysis?.beats && { beats: analysis.beats }),
      mode,
    });
    if (!s) return toast("Couldn't find a good part of this track.", "warn");
    commit(
      { section: { start: s.start, end: s.end }, loop: s.loop || music.loop },
      s.loop
        ? `Music: loop ${s.start.toFixed(1)}-${s.end.toFixed(1)}s`
        : `Music: best ${length.toFixed(0)}s, ${s.start.toFixed(1)}-${s.end.toFixed(1)}s`,
    );
  };
  const pct = (t: number) => `${(t / total) * 100}%`;
  const len = part.end - part.start;
  const repeats = music.loop && len < length ? Math.ceil(length / len) : 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-fg-2">Part of the track</span>
        <span className="font-mono text-muted tabular">
          {part.start.toFixed(1)}-{part.end.toFixed(1)}s · {len.toFixed(1)}s
          {repeats > 1 ? ` · plays ×${repeats}` : len < length && !music.loop ? " · stops early" : ""}
        </span>
      </div>
      <div
        ref={bar}
        className="relative h-12 select-none overflow-hidden rounded-md bg-[#1f2c28]"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Waveform source={source.id} from={0} to={total} />
        <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: pct(part.start) }} />
        <div className="absolute inset-y-0 right-0 bg-black/55" style={{ left: pct(part.end) }} />
        <div
          className="absolute inset-y-0 cursor-grab border-y-2 border-accent/70 active:cursor-grabbing"
          style={{ left: pct(part.start), width: pct(len) }}
          onPointerDown={onDown("move")}
          title="Drag to move the part"
        >
          {(["start", "end"] as const).map((edge) => (
            <div
              key={edge}
              onPointerDown={onDown(edge)}
              className="absolute inset-y-0 w-2 cursor-ew-resize bg-accent"
              style={edge === "start" ? { left: -4 } : { right: -4 }}
              title={edge === "start" ? "Drag to change where it starts" : "Drag to change where it ends"}
            />
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-fg-2">
        <input
          type="checkbox"
          checked={music.loop}
          onChange={(e) =>
            commit({ loop: e.target.checked }, e.target.checked ? "Music: loop the part" : "Music: play once")
          }
        />
        Loop this part to fill the video
      </label>
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: `Best part for ${length.toFixed(0)}s`, run: () => pick("auto") },
          { label: "Best loop", run: () => pick("loop") },
          {
            label: "Whole track",
            run: () => commit({ section: null, offset: analysis?.start ?? 0 }, "Music: whole track"),
          },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.run}
            className="rounded-full border border-line-strong bg-button px-2.5 py-1 text-xs text-fg-2 hover:bg-chip"
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
