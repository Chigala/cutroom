import { CheckIcon, FolderOpenIcon, WarningIcon } from "@phosphor-icons/react";
import { runChecks } from "@vedit/checks";
import { formatTime, SHAPES, shapeOf, timelineOf } from "@vedit/project";
import { clsx } from "clsx";
import { useMemo } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { Button } from "../../components/ui.tsx";
import { took } from "../../lib/duration.ts";
import { host } from "../../lib/host.ts";
import { cancelExport, dismissExport, startExport, useJobs } from "../../state/jobs.ts";
import { edit, useDoc } from "../../state/project.ts";
import { setUi } from "../../state/ui.ts";

/** Render to MP4: a last look at the checks, then progress, then the file. */
export function ExportDialog() {
  const job = useJobs((s) => s.export);
  const doc = useDoc((d) => d);
  const failing = useMemo(() => runChecks(doc).filter((r) => r.status !== "pass"), [doc]);
  const indexing = doc.sources.filter((s) => s.status === "pending" || s.status === "indexing").length;
  const { width, height, fps } = doc.meta.format;
  const close = () => {
    if (job?.status !== "running") dismissExport();
    setUi({ dialog: null });
  };

  return (
    <Dialog title="Export" onClose={close}>
      {!job || job.status === "error" ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 font-mono text-xs text-muted">
            <Stat label="Length" value={formatTime(timelineOf(doc).duration, true)} />
            <Stat label="Size" value={`${width}×${height}`} />
            <Stat label="Frame rate" value={`${fps} fps`} />
          </div>
          <Shapes />
          {failing.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-accent/30 bg-accent/5 p-3">
              {failing.map((r) => (
                <div key={r.id} className="flex gap-2 text-[13px] text-fg-2">
                  <WarningIcon size={15} className="mt-0.5 shrink-0 text-accent" />
                  {r.detail ?? r.title}
                </div>
              ))}
            </div>
          )}
          {indexing > 0 && (
            <p className="text-[13px] text-muted">
              {indexing} {indexing === 1 ? "clip is" : "clips are"} still indexing. Export works, but captions
              only cover what is transcribed so far.
            </p>
          )}
          {job?.status === "error" && job.error !== "Cancelled" && (
            <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-fg-2">
              {job.error}
            </p>
          )}
          <p className="text-xs leading-relaxed text-faint">
            Renders full quality from your original footage, with the voice cleaned and levelled to -14 LUFS.
            The file goes in the project's exports folder.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="accent" onClick={() => void startExport()}>
              Export video
            </Button>
          </div>
        </div>
      ) : job.status === "running" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-fg-2">{job.label}</span>
            <span className="font-mono text-muted tabular">{Math.round(job.fraction * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-button">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${job.fraction * 100}%` }}
            />
          </div>
          <p className="text-xs text-faint">
            You can keep editing. Changes after this point go in the next export.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setUi({ dialog: null })}>Hide</Button>
            <Button onClick={cancelExport}>Stop export</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-ok/15">
            <CheckIcon size={22} className="text-ok" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">Your video is ready</span>
            <span className="font-mono text-xs break-all text-muted">{job.file?.split(/[\\/]/).pop()}</span>
            {job.elapsedMs && <span className="text-xs text-faint">Rendered in {took(job.elapsedMs)}</span>}
          </div>
          <div className="flex gap-2">
            <Button onClick={close}>Done</Button>
            <Button variant="accent" onClick={() => job.file && void host.project.showFile(job.file)}>
              <FolderOpenIcon size={14} /> Show in folder
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** The shapes to export (the project's own always), and whether the cover image comes too. */
function Shapes() {
  const format = useDoc((d) => d.meta.format);
  const xs = useDoc((d) => d.exportSettings);
  const own = shapeOf(format);
  const on = new Set([...xs.formats, ...(own ? [own] : [])]);
  const set = (patch: Partial<typeof xs>, message: string) =>
    edit([{ op: "merge", key: "exportSettings", patch }], { message });
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium text-muted">Shapes, each reframed on the person</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={s === own}
            onClick={() =>
              set(
                { formats: SHAPES.filter((x) => x !== own && (x === s ? !on.has(s) : on.has(x))) },
                `Export: ${on.has(s) ? "no" : "also"} ${s}`,
              )
            }
            className={clsx(
              "rounded-md border px-2.5 py-1 font-mono text-xs",
              on.has(s)
                ? "border-accent bg-accent/15 text-fg"
                : "border-line-strong text-muted hover:text-fg",
              s === own && "cursor-default",
            )}
          >
            {s}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={xs.cover}
            onChange={(e) =>
              set({ cover: e.target.checked }, `Export: ${e.target.checked ? "with" : "no"} cover`)
            }
          />
          Cover image
        </label>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-raised px-3 py-2">
      <span className="text-[10px] tracking-wide uppercase">{label}</span>
      <span className="text-[13px] text-fg tabular">{value}</span>
    </div>
  );
}
