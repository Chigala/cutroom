/**
 * Story view: one card per shot with what happens in it. Drag to reorder, click to jump, double-click
 * the sentence to rewrite it. For most people this replaces the timeline.
 */
import { type PlacedScene, type Source, sceneAt, spokenWords, timelineOf } from "@vedit/project";
import { clsx } from "clsx";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MEDIA_BASE } from "../../lib/host.ts";
import { thumbnail } from "../../lib/thumbs.ts";
import { useJobs } from "../../state/jobs.ts";
import { seekTime, useFrameEffect } from "../../state/playback.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { setUi, useUi } from "../../state/ui.ts";

export function Story() {
  const tl = useDoc(timelineOf);
  const sources = useDoc((d) => d.sources);
  const spoken = useDoc(spokenWords);
  const said = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of spoken) m.set(w.scene, m.has(w.scene) ? `${m.get(w.scene)} ${w.text}` : w.text);
    return m;
  }, [spoken]);
  const touched = useProject((s) => s.agentTouched);
  const selected = useUi((s) => s.selectedScene);
  const [current, setCurrent] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragId = useRef<string | null>(null);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  useFrameEffect((frame, s) => {
    const id = sceneAt(tl, frame / s.fps)?.scene.id ?? null;
    setCurrent((prev) => (prev === id ? prev : id));
  });

  /** Drop position comes from the drop event itself, not from the last dragover's state. */
  const drop = (target: number) => {
    const id = dragId.current;
    if (id !== null) {
      const dropAt = target;
      const from = tl.scenes.findIndex((p) => p.scene.id === id);
      const to = dropAt > from ? dropAt - 1 : dropAt;
      if (from !== to) edit([{ op: "move", coll: "scenes", id, index: to }]);
    }
    dragId.current = null;
    setDropAt(null);
  };

  return (
    <div className="flex min-h-[120px] flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[13px] font-semibold">{tl.scenes.length} scenes</span>
        <span className="font-mono text-[11px] text-muted">drag to reorder</span>
      </div>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1" onDragLeave={() => setDropAt(null)}>
        {tl.scenes.map((p) => (
          <div
            key={p.scene.id}
            draggable
            onDragStart={(e) => {
              dragId.current = p.scene.id;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-scene", p.scene.id);
            }}
            onDragOver={(e) => {
              if (!dragId.current) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientY < r.top + r.height / 2 ? p.index : p.index + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              drop(e.clientY < r.top + r.height / 2 ? p.index : p.index + 1);
            }}
            onDragEnd={() => {
              dragId.current = null;
              setDropAt(null);
            }}
            className="relative"
          >
            {dropAt === p.index && <DropLine top />}
            <SceneCard
              placed={p}
              source={sourceById.get(p.scene.source)}
              changed={touched.has(p.scene.id)}
              playing={current === p.scene.id}
              selected={selected === p.scene.id}
              said={said.get(p.scene.id) ?? ""}
            />
            {dropAt === p.index + 1 && p.index === tl.scenes.length - 1 && <DropLine />}
          </div>
        ))}
      </div>
    </div>
  );
}

const DropLine = ({ top }: { top?: boolean }) => (
  <div className={clsx("absolute inset-x-1 z-10 h-0.5 rounded bg-accent", top ? "-top-1" : "-bottom-1")} />
);

const SceneCard = memo(function SceneCard({
  placed,
  source,
  changed,
  playing,
  selected,
  said,
}: {
  said: string;
  placed: PlacedScene;
  source: Source | undefined;
  changed: boolean;
  playing: boolean;
  selected: boolean;
}) {
  const { scene, start, duration } = placed;
  const [editing, setEditing] = useState(false);
  return (
    <div
      onClick={() => {
        seekTime(start);
        setUi({ selectedScene: scene.id });
      }}
      onDoubleClick={() => setEditing(true)}
      className={clsx(
        "flex items-center gap-2.5 rounded-lg border bg-raised p-1.5 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_64px]",
        changed ? "border-accent" : selected ? "border-edge" : "border-line",
        playing && "bg-[#22222a]",
      )}
    >
      <div className="relative shrink-0">
        <Thumb source={source} time={scene.in + Math.min(0.5, duration / 2)} />
        {source && <IndexBadge source={source} />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="font-mono text-[11px] text-muted tabular">
          {scene.id} · {duration.toFixed(1)}s
        </span>
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: entered edit mode on purpose
            autoFocus
            defaultValue={scene.note}
            aria-label="What happens in this shot"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setEditing(false);
              const note = e.currentTarget.value.trim();
              if (note !== scene.note)
                edit([{ op: "update", coll: "scenes", id: scene.id, patch: { note } }]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="rounded bg-bg px-1 text-[13px] text-fg outline-none ring-1 ring-edge"
          />
        ) : (
          <span className={clsx("truncate text-[13px]", !scene.note && !said && "text-faint italic")}>
            {scene.note || (said && `“${said}”`) || source?.label || "Untitled shot"}
          </span>
        )}
      </div>
    </div>
  );
});

/** A thin progress ring over the thumbnail while the clip is being indexed. */
function IndexBadge({ source }: { source: Source }) {
  const job = useJobs((s) => s.indexing[source.id]);
  if (source.status === "failed")
    return (
      <span
        title={source.error}
        className="absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/60 text-[10px] text-bad"
      >
        !
      </span>
    );
  if (!job && source.status !== "pending" && source.status !== "indexing") return null;
  const pct = Math.round((job?.fraction ?? 0) * 100);
  return (
    <span
      title={job?.label ?? "Waiting to index"}
      className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-[5px] bg-black/50"
    >
      <span
        className="block h-full bg-accent transition-[width] duration-300"
        style={{ width: `${Math.max(6, pct)}%` }}
      />
    </span>
  );
}

function Thumb({ source, time }: { source: Source | undefined; time: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const isVideo = source?.kind === "video";

  useEffect(() => {
    if (!isVideo || !source) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      void thumbnail(
        `${MEDIA_BASE}${encodeURIComponent(source.id)}${source.proxy ? "?proxy" : ""}`,
        time,
      ).then((u) => {
        if (!cancelled) setUrl(u);
      });
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [isVideo, source, time]);

  const style =
    source?.kind === "image"
      ? { backgroundImage: `url("${MEDIA_BASE}${encodeURIComponent(source.id)}")` }
      : url
        ? { backgroundImage: `url("${url}")` }
        : { backgroundColor: source?.color ?? "#3a1f1f" };
  return <div ref={ref} className="h-[50px] w-10 rounded-[5px] bg-cover bg-center" style={style} />;
}
