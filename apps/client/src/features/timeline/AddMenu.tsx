/**
 * "+ Add": put a graphic, cutaway, effect, transition, sound, zoom or title at the playhead. Effects and
 * transitions are listed from the project's own files (effects/, transitions/), so a new one, written by
 * you or by Claude, shows up here. Whatever is added is selected straight away, so the next request
 * ("make it say...", "move it to the punchline") is about it.
 */

import {
  FilmStripIcon,
  IntersectIcon,
  MagicWandIcon,
  MagnifyingGlassPlusIcon,
  MusicNotesIcon,
  PlusIcon,
  SparkleIcon,
  TextTIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import {
  anchorAt,
  nextId,
  type Op,
  parseGraphic,
  SFX_NAMES,
  type StyleFile,
  sceneAt,
  styleMeta,
  timelineOf,
} from "@vedit/project";
import { clsx } from "clsx";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { importClips } from "../../lib/import.ts";
import { currentTime } from "../../state/playback.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { type InspectableColl, select } from "../../state/ui.ts";

type Section = "graphic" | "cutaway" | "effect" | "transition" | "sound" | null;

/** A style file as a menu entry: its header's name, description and suggested length. */
const entry = (f: StyleFile, fallback: number) => {
  const meta = styleMeta(f.css);
  return {
    id: f.id,
    name: meta?.name ?? f.id,
    description: meta?.description ?? "",
    duration: meta?.duration ?? fallback,
  };
};

export function AddMenu() {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ left: 0, bottom: 0, room: 400 });
  const [section, setSection] = useState<Section>(null);
  const ref = useRef<HTMLDivElement>(null);
  const graphics = useDoc((d) => d.graphics);
  const sources = useDoc((d) => d.sources);
  const effectKinds = useDoc((d) => d.effectKinds);
  const transitionKinds = useDoc((d) => d.transitionKinds);
  const effects = useMemo(() => effectKinds.map((f) => entry(f, 0.5)), [effectKinds]);
  const transitions = useMemo(() => transitionKinds.map((f) => entry(f, 0.4)), [transitionKinds]);
  const menuGraphics = useMemo(
    () =>
      graphics.map((g) => {
        try {
          const { meta } = parseGraphic(g.html);
          return { id: g.id, name: meta.name, duration: meta.duration, description: meta.description };
        } catch {
          return { id: g.id, name: g.id, duration: 3, description: "This graphic's header has a problem" };
        }
      }),
    [graphics],
  );

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  /** Inserts one item at the playhead and opens it. */
  const add = (
    coll: InspectableColl,
    make: (id: string, anchor: { scene: string; at: number }, room: number) => object,
    label: string,
  ) => {
    const doc = useProject.getState().doc!;
    const tl = timelineOf(doc);
    if (!tl.scenes.length) return toast("Add some footage first.", "warn");
    const t = Math.min(currentTime(), Math.max(0, tl.duration - 0.3));
    const anchor = anchorAt(tl, t)!;
    const prefix = {
      zooms: "z",
      titles: "t",
      visuals: "v",
      effects: "fx",
      sfx: "sfx",
      captions: "cap",
      scenes: "sc",
      musicClips: "mc",
      musicCues: "cue",
    }[coll];
    const id = nextId(prefix, doc[coll] as readonly { id: string }[]);
    const op = { op: "insert", coll, item: make(id, anchor, tl.duration - t) } as Op;
    if (edit([op], { message: label })) {
      select({ coll, id });
    }
    setOpen(false);
    setSection(null);
  };

  /** Sets how the shot under the playhead comes in from the one before it. */
  const transitionInto = (t: { id: string; name: string; duration: number }) => {
    const doc = useProject.getState().doc!;
    const tl = timelineOf(doc);
    const placed = sceneAt(tl, currentTime());
    const index = placed ? tl.scenes.indexOf(placed) : -1;
    if (!placed || index < 1)
      return toast("Put the playhead on a shot after the first: a transition leads into it.", "warn");
    const duration = Math.min(2, Math.max(0.1, t.duration));
    if (
      edit(
        [
          {
            op: "update",
            coll: "scenes",
            id: placed.scene.id,
            patch: { transition: { kind: t.id, duration } },
          },
        ],
        {
          message: `${t.name} into ${placed.scene.id}`,
        },
      )
    ) {
      select({ coll: "scenes", id: placed.scene.id });
    }
    setOpen(false);
    setSection(null);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          // Above the button, against the window: the timeline clips anything that leaves its box.
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ left: r.left, bottom: window.innerHeight - r.top + 6, room: r.top - 12 });
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md bg-control px-1.5 py-0.5 font-sans text-[11px] text-fg-2 hover:bg-selected hover:text-fg"
      >
        <PlusIcon size={12} /> Add
      </button>
      {open && (
        <div
          className="fixed z-50 flex w-64 flex-col overflow-y-auto rounded-xl border border-line-strong bg-panel p-1.5 font-sans shadow-2xl animate-rise"
          style={{ left: at.left, bottom: at.bottom, maxHeight: at.room }}
        >
          {section === null ? (
            <>
              <Item
                icon={<UploadSimpleIcon size={14} />}
                onClick={() => {
                  setOpen(false);
                  void importClips();
                }}
              >
                Clips from your computer…
              </Item>
              <Item icon={<SparkleIcon size={14} />} onClick={() => setSection("graphic")} more>
                Graphic
              </Item>
              <Item icon={<FilmStripIcon size={14} />} onClick={() => setSection("cutaway")} more>
                Cutaway to a clip
              </Item>
              <Item icon={<MagicWandIcon size={14} />} onClick={() => setSection("effect")} more>
                Effect
              </Item>
              <Item icon={<IntersectIcon size={14} />} onClick={() => setSection("transition")} more>
                Transition into this shot
              </Item>
              <Item icon={<MusicNotesIcon size={14} />} onClick={() => setSection("sound")} more>
                Sound effect
              </Item>
              <Item
                icon={<MagnifyingGlassPlusIcon size={14} />}
                onClick={() =>
                  add(
                    "zooms",
                    (id, anchor) => ({
                      id,
                      anchor,
                      duration: 1.2,
                      scale: 1.25,
                      focus: { x: 0.5, y: 0.42 },
                      ease: "punch",
                    }),
                    "Added a zoom",
                  )
                }
              >
                Zoom
              </Item>
              <Item
                icon={<TextTIcon size={14} />}
                onClick={() =>
                  add(
                    "titles",
                    (id, anchor) => ({ id, anchor, role: "title", duration: 2.5, text: "New title" }),
                    "Added a title",
                  )
                }
              >
                Title
              </Item>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSection(null)}
                className="px-2.5 py-1.5 text-left text-[11px] text-muted hover:text-fg"
              >
                ← Back
              </button>
              <div className="flex max-h-72 flex-col overflow-y-auto">
                {section === "graphic" &&
                  (menuGraphics.length ? (
                    menuGraphics.map((g) => (
                      <Item
                        key={g.id}
                        title={g.description}
                        onClick={() =>
                          add(
                            "visuals",
                            (id, anchor, room) => ({
                              id,
                              anchor,
                              duration: Math.max(0.5, Math.min(g.duration, room)),
                              layout: "overlay",
                              content: { kind: "graphic", graphic: g.id, params: {} },
                            }),
                            `Added ${g.name}`,
                          )
                        }
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{g.name}</span>
                          <span className="truncate font-mono text-[10px] text-faint">
                            graphics/{g.id}.html
                          </span>
                        </span>
                      </Item>
                    ))
                  ) : (
                    <p className="px-2.5 py-2 text-xs text-muted">
                      No graphics yet. Make one from the Files tab.
                    </p>
                  ))}
                {section === "cutaway" &&
                  sources
                    .filter((s) => s.kind === "video" || s.kind === "image")
                    .map((s) => (
                      <Item
                        key={s.id}
                        onClick={() =>
                          add(
                            "visuals",
                            (id, anchor, room) => ({
                              id,
                              anchor,
                              duration: Math.max(0.5, Math.min(2.5, room)),
                              layout: "full",
                              content: { kind: "cutaway", source: s.id, in: 0 },
                            }),
                            `Cut away to ${s.label}`,
                          )
                        }
                      >
                        <span className="truncate">{s.label}</span>
                      </Item>
                    ))}
                {section === "effect" &&
                  effects.map((e) => (
                    <Item
                      key={e.id}
                      title={e.description}
                      onClick={() =>
                        add(
                          "effects",
                          (id, anchor, room) => ({
                            id,
                            anchor,
                            kind: e.id,
                            duration: Math.max(0.1, Math.min(e.duration, room)),
                          }),
                          `Added ${e.name}`,
                        )
                      }
                    >
                      <Named name={e.name} file={`effects/${e.id}.css`} />
                    </Item>
                  ))}
                {section === "transition" &&
                  transitions.map((t) => (
                    <Item key={t.id} title={t.description} onClick={() => transitionInto(t)}>
                      <Named name={t.name} file={`transitions/${t.id}.css`} />
                    </Item>
                  ))}
                {section === "sound" &&
                  SFX_NAMES.map((name) => (
                    <Item
                      key={name}
                      onClick={() =>
                        add("sfx", (id, anchor) => ({ id, anchor, name, volume: 0.8 }), `Added ${name}`)
                      }
                    >
                      <span className="capitalize">{name}</span>
                    </Item>
                  ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Named({ name, file }: { name: string; file: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{name}</span>
      <span className="truncate font-mono text-[10px] text-faint">{file}</span>
    </span>
  );
}

function Item({
  icon,
  more,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; more?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-fg-2 hover:bg-raised hover:text-fg",
      )}
    >
      {icon && <span className="text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {more && <span className="text-faint">›</span>}
    </button>
  );
}
