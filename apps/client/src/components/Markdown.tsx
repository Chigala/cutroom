/**
 * The agent's replies, rendered: bold, lists, links, code, quotes and tables. No raw HTML (the
 * renderer escapes it), and links open in the browser, never inside the app.
 */
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p className="my-0 [&:not(:first-child)]:mt-2.5">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-2 flex list-disc flex-col gap-1 pl-5 marker:text-faint">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 flex list-decimal flex-col gap-1 pl-5 marker:text-faint">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5 [&>ul]:my-1 [&>ol]:my-1">{children}</li>,
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-[14px] font-semibold text-fg">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1 text-[14px] font-semibold text-fg">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 text-[13px] font-semibold text-fg">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2.5 mb-1 text-[13px] font-semibold text-fg-2">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-fg-2">{children}</blockquote>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className="font-mono text-[12px]">{children}</code>
    ) : (
      <code className="rounded bg-control px-1 py-px font-mono text-[12px] text-fg">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-raised p-2.5 font-mono text-[12px] leading-[1.45]">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-line" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line-strong px-2 py-1 text-left font-semibold text-fg">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-2 py-1 align-top">{children}</td>,
};

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
