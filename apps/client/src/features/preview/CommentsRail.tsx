import { ChatCircleTextIcon, SidebarSimpleIcon, XIcon } from "@phosphor-icons/react";
import { formatTime, resolveAnchor, timelineOf } from "@vedit/project";
import { clsx } from "clsx";
import { useRef } from "react";
import { SectionLabel } from "../../components/ui.tsx";
import { send, useChat } from "../../state/chat.ts";
import { COMMENTS_ROOM, layoutNow, useLayout, usePeekDismiss } from "../../state/layout.ts";
import { seekTime } from "../../state/playback.ts";
import { edit, useDoc } from "../../state/project.ts";
import { setCommentsOpen, setUi, useUi } from "../../state/ui.ts";

/**
 * Notes pinned to moments. Leave a few, then hand them all to the agent at once. Hidden, they're a chip
 * in the corner (with how many are open) that brings them back.
 */
export function CommentsRail() {
  const comments = useDoc((d) => d.comments);
  const tl = useDoc(timelineOf);
  const busy = useChat((s) => s.activeRun !== null);
  const docked = useLayout().comments;
  // Hidden for room (a narrow preview), the chip shows them over the stage for a moment instead.
  const peeking = useUi((s) => s.peek === "comments") && !docked;
  const rail = useRef<HTMLDivElement>(null);
  usePeekDismiss("comments", rail, peeking);
  const open = comments.filter((c) => c.status !== "resolved");

  if (!docked && !peeking)
    return (
      <button
        type="button"
        data-peek="comments"
        onClick={() =>
          layoutNow().preview >= COMMENTS_ROOM ? setCommentsOpen(true) : setUi({ peek: "comments" })
        }
        title="Show comments"
        className="absolute top-6 right-[22px] flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11px] tracking-[0.06em] text-muted uppercase hover:bg-button hover:text-fg"
      >
        <ChatCircleTextIcon size={14} />
        {open.length > 0 ? `Comments · ${open.length}` : "Comments"}
      </button>
    );

  return (
    <div
      ref={rail}
      className={clsx(
        "absolute top-6 right-[22px] bottom-6 flex w-[214px] flex-col gap-2.5",
        peeking && "z-30 -m-3 box-content rounded-xl border border-line-strong bg-panel p-3 shadow-2xl",
      )}
    >
      <SectionLabel
        right={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-faint">{open.length} open</span>
            <button
              type="button"
              aria-label="Hide comments"
              title="Hide comments"
              onClick={() => (peeking ? setUi({ peek: null }) : setCommentsOpen(false))}
              className="-my-1 rounded-md p-1 text-faint hover:bg-button hover:text-fg"
            >
              <SidebarSimpleIcon size={14} mirrored />
            </button>
          </span>
        }
      >
        Comments
      </SectionLabel>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
        {comments.length === 0 && (
          <p className="text-xs leading-relaxed text-faint">
            Press Point, click the video, and leave a note like "too slow here". Send them all when you're
            ready.
          </p>
        )}
        {comments.map((c) => {
          const t = resolveAnchor(tl, c.anchor);
          return (
            <div
              key={c.id}
              onClick={() => t !== null && seekTime(t)}
              className={clsx(
                "group relative flex flex-col gap-1 rounded-[10px] border border-[#2a2a30] bg-card px-3 py-2.5 animate-fade-in",
                c.status === "resolved" && "opacity-70",
              )}
            >
              <span className="font-mono text-[11px] text-accent">{t === null ? "cut" : formatTime(t)}</span>
              <span className="text-[13px] leading-snug">{c.text}</span>
              <span className={clsx("text-xs", c.status === "resolved" ? "text-ok" : "text-muted")}>
                {c.status === "resolved"
                  ? `Resolved${c.resolution ? ` · ${c.resolution}` : ""}`
                  : c.status === "queued"
                    ? "Queued"
                    : "Open"}
              </span>
              <button
                type="button"
                aria-label="Delete comment"
                onClick={(e) => {
                  e.stopPropagation();
                  edit([{ op: "remove", coll: "comments", id: c.id }]);
                }}
                className="absolute top-2 right-2 hidden rounded p-0.5 text-faint hover:text-fg group-hover:block"
              >
                <XIcon size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {open.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void send(`Resolve ${open.length === 1 ? "this comment" : `these ${open.length} comments`}.`, {
              comments: open.map((c) => c.id),
            })
          }
          className="h-9 shrink-0 rounded-lg border border-line-strong bg-button text-[13px] hover:bg-chip disabled:opacity-40"
        >
          Send comments to agent
        </button>
      )}
    </div>
  );
}
