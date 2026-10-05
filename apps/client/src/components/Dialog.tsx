import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/** A modal on the native <dialog>: real focus trapping, Escape to close, and a backdrop for free. */
export function Dialog({
  title,
  onClose,
  children,
  width = 440,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
      // Never taller than the window: the title stays put and only the contents scroll.
      className="m-auto max-h-[calc(100vh-48px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel p-0 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px] open:flex open:animate-rise"
      style={{ width }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-md p-1 text-muted hover:bg-button hover:text-fg"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}
