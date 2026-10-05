import { CaretRightIcon, CheckIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import { checksSummary, runChecks } from "@vedit/checks";
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { edit, useDoc } from "../../state/project.ts";

/**
 * The lint layer, shown like a test run: one line while everything passes, the problems (with their
 * fixes) when something doesn't, every check on a click. Re-runs on every change in well under a
 * millisecond.
 */
export function Checks() {
  const doc = useDoc((d) => d);
  const results = useMemo(() => runChecks(doc), [doc]);
  const [all, setAll] = useState(false);
  if (!results.length) return null;
  const { passed, total } = checksSummary(results);
  const problems = results.filter((r) => r.status !== "pass");
  const shown = all ? results : problems;
  const failing = problems.some((r) => r.status === "fail");
  return (
    <section
      className="flex max-h-[38%] shrink-0 flex-col gap-[7px] overflow-y-auto border-t border-line pt-3"
      aria-label="Checks"
    >
      <button
        type="button"
        aria-expanded={all}
        onClick={() => setAll(!all)}
        title={all ? "Show only what needs attention" : "Show every check"}
        className="flex items-center gap-1.5 rounded text-left hover:text-fg"
      >
        <CaretRightIcon
          size={13}
          className={clsx("shrink-0 text-faint transition-transform", all && "rotate-90")}
        />
        <span className="text-[13px] font-semibold">Checks</span>
        {!problems.length && <CheckIcon size={14} className="text-ok" />}
        <span
          className={clsx(
            "ml-auto font-mono text-xs tabular",
            failing ? "text-bad" : problems.length ? "text-accent" : "text-muted",
          )}
        >
          {passed} / {total}
        </span>
      </button>
      {shown.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-[12.5px] text-fg-2" title={r.detail}>
          {r.status === "pass" ? (
            <CheckIcon size={15} className="shrink-0 text-ok" />
          ) : r.status === "warn" ? (
            <WarningIcon size={15} className="shrink-0 text-accent" />
          ) : (
            <XCircleIcon size={15} className="shrink-0 text-bad" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {r.status === "pass" ? r.title : (r.detail ?? r.title)}
          </span>
          {r.fix && (
            <button
              type="button"
              title={r.fix.label}
              onClick={() =>
                edit([...r.fix!.ops], {
                  message: r.fix!.label,
                  groups: [{ label: r.fix!.label, ops: r.fix!.ops.map((_, i) => i) }],
                })
              }
              className="h-6 shrink-0 rounded-md bg-accent px-2.5 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover"
            >
              Fix
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
