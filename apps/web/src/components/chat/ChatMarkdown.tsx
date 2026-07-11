/**
 * Renderizador de Markdown/hipertexto do chat (GFM completo): links, negrito,
 * itálico, riscado, listas (inclusive de tarefas), títulos, citações, tabelas,
 * imagens, código inline e blocos de código com syntax highlight.
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline decoration-accent-soft underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-fg">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="opacity-70">{children}</del>,
  h1: ({ children }) => (
    <h1 className="mb-1 mt-2 text-base font-semibold text-fg">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-2 text-sm font-semibold text-fg">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-0.5 mt-1.5 text-sm font-medium text-fg">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-0.5 mt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-2">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-1 text-xs font-semibold text-fg-2">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-1 text-xs font-medium text-fg-muted">{children}</h6>
  ),
  ul: ({ children }) => (
    <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  input: ({ checked }) => (
    // Checkbox de task list do GFM (- [x] item)
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      className="mr-1 -mt-0.5 inline-block align-middle accent-current"
    />
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-accent pl-2 text-fg-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-border" />,
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border-strong text-fg">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-t border-border px-2 py-1 align-top text-fg-2">
      {children}
    </td>
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      className="my-1.5 max-w-full rounded border border-border"
    />
  ),
  code: (props) => {
    const { className, children } = props;
    const match = /language-(\w+)/.exec(className ?? "");
    const text = String(children).replace(/\n$/, "");
    // Sem linguagem e sem quebra de linha = código inline.
    if (!match && !text.includes("\n")) {
      return (
        <code className="rounded bg-bg-3 px-1 py-0.5 font-mono text-[0.85em] text-fg">
          {text}
        </code>
      );
    }
    return (
      <SyntaxHighlighter
        language={match?.[1] ?? "text"}
        style={oneDark}
        customStyle={{
          margin: "0.375rem 0",
          borderRadius: "0.25rem",
          fontSize: "0.75rem",
          padding: "0.5rem",
        }}
        wrapLongLines
      >
        {text}
      </SyntaxHighlighter>
    );
  },
};

export const ChatMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-sm text-fg [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  </div>
);
