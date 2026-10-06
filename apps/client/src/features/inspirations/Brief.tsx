/**
 * An inspiration's brief, read as a document: headings, paragraphs, bullet and numbered lists. Plain
 * React elements, never raw HTML (briefs can come from anywhere a user found them).
 */
import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

function blocks(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = out.at(-1);
    if (h) out.push({ kind: "h", level: h[1]!.length, text: h[2]! });
    else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      const text = (ul ?? ol)![1]!;
      if (last?.kind === kind) last.items.push(text);
      else out.push({ kind, items: [text] });
    } else if (!line.trim()) out.push({ kind: "p", text: "" });
    else if (last?.kind === "p" && last.text) last.text += ` ${line.trim()}`;
    else out.push({ kind: "p", text: line.trim() });
  }
  return out.filter((b) => b.kind !== "p" || b.text);
}

/** **bold** and `code`, the only inline marks briefs use. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? (
      <strong key={i} className="font-semibold text-fg">
        {p.slice(2, -2)}
      </strong>
    ) : p.startsWith("`") ? (
      <code key={i} className="rounded bg-control px-1 font-mono text-[11.5px]">
        {p.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

export function Brief({ md }: { md: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-fg-2">
      {blocks(md).map((b, i) => {
        if (b.kind === "h")
          return b.level <= 1 ? null : (
            <h3 key={i} className="m-0 mt-2 text-[13px] font-semibold text-fg">
              {b.text}
            </h3>
          );
        if (b.kind === "p")
          return (
            <p key={i} className="m-0">
              {inline(b.text)}
            </p>
          );
        const List = b.kind === "ul" ? "ul" : "ol";
        return (
          <List
            key={i}
            className={`m-0 flex flex-col gap-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}
          >
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
