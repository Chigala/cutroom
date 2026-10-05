import { FilmStripIcon } from "@phosphor-icons/react";
import { host } from "../../lib/host.ts";

/** No blank timeline, ever: an empty project is one big invitation to drop footage. */
export function EmptyStage() {
  return (
    <div className="flex aspect-[9/16] h-[min(100%-50px,720px)] flex-col items-center justify-center gap-4 rounded-[22px] border-2 border-dashed border-line-strong p-8 text-center animate-fade-in">
      <FilmStripIcon size={32} className="text-faint" weight="light" />
      <div className="flex flex-col gap-1.5">
        <span className="text-[15px] font-semibold">Drop your clips here</span>
        <span className="text-[13px] leading-relaxed text-muted">
          {host.kind === "desktop"
            ? "Videos, photos or a whole folder. Then tell the agent what you want to make."
            : "Importing footage needs the desktop app. Run pnpm dev."}
        </span>
      </div>
    </div>
  );
}
