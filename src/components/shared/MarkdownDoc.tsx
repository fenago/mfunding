// MarkdownDoc — read-only markdown renderer for the legal/onboarding documents.
//
// WHY IN-HOUSE: the app has no markdown dependency (Resources renders bodies as
// plain `whitespace-pre-wrap` text), and these documents are contracts — pulling
// in a full CommonMark + HTML pipeline to display them would be the one place we
// least want an HTML-injection surface. So this renders the small, known subset
// the legal docs actually use, extending the inline-token approach already used
// by NarrativeText in AIUnderwritingPanel.
//
// EVERYTHING IS A REACT TEXT NODE. There is no dangerouslySetInnerHTML anywhere
// in this file and none should ever be added — raw HTML in a source doc renders
// as literal text, which is the correct, safe failure mode for a contract.
//
// Supported: # / ## / ###, ---, - and * bullets, - [ ] / - [x] checkboxes,
// 1. ordered lists, > blockquotes, | pipe tables |, and inline **bold**,
// *italic*, `code`, [links](url).

import type { ReactNode } from "react";
import { headingSlugger } from "@/lib/markdownAnchors";

/** Inline tokens: **bold**, *italic*, `code`, [text](url). Text nodes only. */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-gray-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={i}
          className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[0.85em] font-mono text-ocean-blue dark:text-sky-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = link[2];
      const safe = /^(https?:|mailto:|\/)/i.test(href); // no javascript: URLs
      if (!safe) return <span key={i}>{link[1]}</span>;
      return (
        <a
          key={i}
          href={href}
          target={href.startsWith("/") ? undefined : "_blank"}
          rel="noreferrer noopener"
          className="text-ocean-blue hover:underline"
        >
          {link[1]}
        </a>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

const isTableRow = (l: string) => l.trim().startsWith("|") && l.trim().endsWith("|");
const isTableDivider = (l: string) => /^\|[\s:|-]+\|$/.test(l.trim());
const cells = (l: string) =>
  l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export default function MarkdownDoc({
  source,
  anchors = false,
}: {
  source: string;
  /** Give h2/h3 stable ids so a table of contents can link into the page. */
  anchors?: boolean;
}) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  const slug = headingSlugger();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // Blank
    if (!t) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      blocks.push(<hr key={i} className="my-6 border-gray-200 dark:border-gray-700" />);
      i++;
      continue;
    }

    // Headings
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      if (level === 1) {
        blocks.push(
          <h1 key={i} className="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-3 first:mt-0">
            {inline(text)}
          </h1>,
        );
      } else if (level === 2) {
        blocks.push(
          <h2
            key={i}
            id={anchors ? slug(text) : undefined}
            className="text-lg font-bold text-gray-900 dark:text-white mt-7 mb-2 pb-1 border-b border-gray-200 dark:border-gray-700 scroll-mt-24"
          >
            {inline(text)}
          </h2>,
        );
      } else if (level === 3) {
        blocks.push(
          <h3
            key={i}
            id={anchors ? slug(text) : undefined}
            className="text-sm font-semibold text-gray-600 dark:text-gray-300 mt-5 mb-2 scroll-mt-24"
          >
            {inline(text)}
          </h3>,
        );
      } else {
        blocks.push(
          <h3 key={i} className="text-sm font-semibold text-gray-600 dark:text-gray-300 mt-5 mb-2">
            {inline(text)}
          </h3>,
        );
      }
      i++;
      continue;
    }

    // Table
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`t${i}`} className="my-4 overflow-x-auto">
          <table className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {header.map((c, ci) => (
                  <th
                    key={ci}
                    className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((r, ri) => (
                <tr key={ri} className="align-top">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 text-gray-700 dark:text-gray-300">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote
    if (t.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={`q${i}`}
          className="my-4 border-l-4 border-ocean-blue/60 bg-ocean-blue/5 dark:bg-ocean-blue/10 pl-4 py-2 text-sm text-gray-700 dark:text-gray-300 space-y-1"
        >
          {quote.filter(Boolean).map((q, qi) => (
            <p key={qi}>{inline(q)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Bullet / checkbox list
    if (/^[-*+]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`u${i}`} className="my-3 space-y-1.5">
          {items.map((item, ii) => {
            const box = item.match(/^\[( |x|X)\]\s*(.*)$/);
            if (box) {
              const checked = box[1].toLowerCase() === "x";
              return (
                <li key={ii} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span
                    className={`mt-0.5 shrink-0 w-4 h-4 rounded border text-[10px] leading-[14px] text-center ${
                      checked
                        ? "bg-mint-green border-mint-green text-white"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <span>{inline(box[2])}</span>
                </li>
              );
            }
            return (
              <li key={ii} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="text-ocean-blue mt-0.5 shrink-0">▸</span>
                <span>{inline(item)}</span>
              </li>
            );
          })}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`o${i}`} className="my-3 space-y-1.5 list-decimal pl-5 marker:text-ocean-blue marker:font-semibold">
          {items.map((item, ii) => (
            <li key={ii} className="text-sm text-gray-700 dark:text-gray-300 pl-1">
              {inline(item)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph (consume until blank line or a new block starts)
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      const lt = l.trim();
      if (
        !lt ||
        /^(#{1,6})\s/.test(lt) ||
        /^[-*+]\s/.test(lt) ||
        /^\d+[.)]\s/.test(lt) ||
        lt.startsWith(">") ||
        isTableRow(l) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(lt)
      )
        break;
      para.push(lt);
      i++;
    }
    blocks.push(
      <p key={`p${i}`} className="my-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {inline(para.join(" "))}
      </p>,
    );
  }

  return <div className="max-w-none">{blocks}</div>;
}
