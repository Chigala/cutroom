/**
 * The pieces every "edit it like a web page" editor shares: graphics (graphics/*.html) and caption looks
 * (captions/looks/*.css) are both a file you can type into, watch through the real composition, scrub
 * frame by frame, or describe to Claude.
 */
import { Player, type PlayerRef, Thumbnail } from "@remotion/player";
import { compositionMeta, VideoComposition } from "@vedit/composition";
import type { ProjectDoc } from "@vedit/project";
import { Sparkles } from "lucide-react";
import { type RefObject, useMemo, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { MEDIA_BASE } from "../../lib/host.ts";
import { AUDIO_TAGS } from "../../lib/player.ts";
import { useChat } from "../../state/chat.ts";
import { CodeEditor } from "./CodeEditor.tsx";

/** The code of a graphic, look or effect, in a real editor (highlighting, brackets, search; ⌘S saves). */
export function CodeArea(props: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  label: string;
  language?: "html" | "css";
}) {
  return <CodeEditor {...props} language={props.language ?? "css"} />;
}

/**
 * A preview project playing through the real composition, with a strip of frames underneath at the
 * moments worth seeing. Click a frame to jump there.
 */
export function PreviewPlayer({
  doc,
  frames,
  player,
  initialFrame = 0,
  inFrame,
  outFrame,
}: {
  doc: ProjectDoc;
  /** Frames for the strip, with what each one shows ("0.40s in"). */
  frames: readonly { frame: number; label: string }[];
  player: RefObject<PlayerRef | null>;
  initialFrame?: number;
  inFrame?: number;
  outFrame?: number;
}) {
  const meta = compositionMeta(doc);
  const props = useMemo(() => ({ doc, mediaBase: MEDIA_BASE }), [doc]);
  const last = meta.durationInFrames - 1;
  const clamp = (f: number) => Math.min(last, Math.max(0, f));
  return (
    <>
      <div
        className="mx-auto w-full max-w-[300px] shrink-0 overflow-hidden rounded-[18px] bg-black shadow-[0_0_0_1px_#2a2a30]"
        style={{ aspectRatio: `${meta.width}/${meta.height}` }}
      >
        <Player
          ref={player}
          component={VideoComposition}
          numberOfSharedAudioTags={AUDIO_TAGS}
          inputProps={props}
          durationInFrames={meta.durationInFrames}
          compositionWidth={meta.width}
          compositionHeight={meta.height}
          fps={meta.fps}
          style={{ width: "100%", height: "100%" }}
          initialFrame={clamp(initialFrame)}
          {...(inFrame !== undefined && { inFrame: clamp(inFrame) })}
          {...(outFrame !== undefined && { outFrame: clamp(outFrame) })}
          autoPlay
          // Muted, so autoplay is allowed without a click; previews are about the picture.
          initiallyMuted
          loop
          controls
          clickToPlay
        />
      </div>
      <div className="grid shrink-0 gap-1" style={{ gridTemplateColumns: `repeat(${frames.length}, 1fr)` }}>
        {frames.map(({ frame, label }) => (
          <button
            key={frame}
            type="button"
            title={label}
            onClick={() => {
              player.current?.pause();
              player.current?.seekTo(clamp(frame));
            }}
            className="overflow-hidden rounded-md bg-black shadow-[0_0_0_1px_#2a2a30] hover:shadow-[0_0_0_1px_var(--color-accent)]"
            style={{ aspectRatio: `${meta.width}/${meta.height}` }}
          >
            <Thumbnail
              component={VideoComposition}
              inputProps={props}
              frameToDisplay={clamp(frame)}
              durationInFrames={meta.durationInFrames}
              compositionWidth={meta.width}
              compositionHeight={meta.height}
              fps={meta.fps}
              style={{ width: "100%", height: "100%" }}
            />
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Describe what you want and Claude writes it: a change to the open file, or a new one. The agent saves
 * the file itself and checks it on rendered frames; the result shows up in the editor as it lands.
 */
export function AskClaude({
  label,
  placeholder,
  change,
  create,
}: {
  label: string;
  placeholder: string;
  /** Sends the request to change the open file. Returns false if it can't go yet (it says why). */
  change: (want: string) => boolean;
  create: (want: string) => boolean;
}) {
  const [text, setText] = useState("");
  const busy = useChat((s) => s.activeRun !== null);
  const ask = (run: (want: string) => boolean) => {
    const want = text.trim();
    if (want && !busy && run(want)) setText("");
  };
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-line p-2.5">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-2">
        <Sparkles size={13} className="text-accent" /> Describe it to Claude
      </span>
      <textarea
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(change);
        }}
        placeholder={placeholder}
        aria-label={label}
        className="resize-none rounded-md border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] leading-snug outline-none focus:border-edge"
      />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" disabled={!text.trim() || busy} onClick={() => ask(create)}>
          Make a new one
        </Button>
        <Button size="sm" variant="accent" disabled={!text.trim() || busy} onClick={() => ask(change)}>
          {busy ? "Claude is working…" : "Change this one"}
        </Button>
      </div>
    </div>
  );
}
