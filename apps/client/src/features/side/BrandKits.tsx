/**
 * Brand kits: this project's taste saved for the next one, and saved taste brought in. A kit holds the
 * look, captions, graphics, effects, fonts, mix, checks, cover style and STYLE.md (kit.ts).
 */

import { StarIcon, TrashIcon } from "@phosphor-icons/react";
import type { KitInfo } from "@vedit/project";
import { clsx } from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { useDoc } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";

export function BrandKits() {
  const linked = useDoc((d) => d.meta.kit);
  const projectName = useDoc((d) => d.meta.name);
  const [kits, setKits] = useState<KitInfo[]>([]);
  const [fallback, setFallback] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    void host.kits.list().then(setKits);
    void host.settings.get().then((s) => setFallback(s.kit));
  }, []);
  useEffect(refresh, [refresh]);
  const mine = kits.find((k) => k.id === linked);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast(done);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted">
        Your look, captions, graphics, effects, fonts, sound and STYLE.md, saved to start the next video with.
        {mine
          ? ` This project uses "${mine.name}": what the agent learns about your taste goes into it.`
          : ""}
      </p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={mine ? mine.name : `${projectName} style`}
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] outline-none focus:border-edge"
        />
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                host.kits.save(
                  name.trim() || mine?.name || `${projectName} style`,
                  name.trim() ? undefined : mine?.id,
                ),
              mine && !name.trim() ? `Updated "${mine.name}"` : "Saved the brand kit",
            ).then(() => setName(""))
          }
        >
          {mine && !name.trim() ? "Update kit" : "Save as kit"}
        </Button>
      </div>
      {kits.length > 0 && (
        <ul className="flex flex-col gap-1">
          {kits.map((k) => (
            <li
              key={k.id}
              className={clsx(
                "flex items-center gap-2 rounded-md px-2 py-1.5",
                k.id === linked ? "bg-accent/10" : "hover:bg-raised",
              )}
            >
              <button
                type="button"
                title={
                  k.id === fallback ? "New projects start with this kit" : "Start new projects with this kit"
                }
                onClick={() =>
                  void run(
                    () => host.settings.set({ kit: k.id === fallback ? "" : k.id }),
                    k.id === fallback ? "New projects start plain" : `New projects start with "${k.name}"`,
                  )
                }
                className={k.id === fallback ? "text-accent" : "text-faint hover:text-fg"}
              >
                <StarIcon size={13} weight={k.id === fallback ? "fill" : "regular"} />
              </button>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]">{k.name}</span>
                <span className="truncate font-mono text-[10px] text-faint">
                  {k.graphics} graphics{k.fonts.length ? ` · ${k.fonts.join(", ")}` : ""}
                </span>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await host.kits.apply(k.id);
                    if (!r.ok) throw new Error(r.error);
                  }, `Applied "${k.name}"`)
                }
              >
                Apply
              </Button>
              <button
                type="button"
                title="Delete this kit"
                className="text-faint hover:text-bad"
                onClick={() => {
                  if (window.confirm(`Delete the brand kit "${k.name}"? Projects using it keep their look.`))
                    void run(() => host.kits.remove(k.id), "Deleted the kit");
                }}
              >
                <TrashIcon size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
