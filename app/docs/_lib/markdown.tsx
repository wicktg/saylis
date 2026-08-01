import type { ReactNode } from "react";

/**
 * A deliberately small markdown-lite renderer — just enough for the docs
 * content in this folder (headers, paragraphs, bold/inline-code, fenced
 * code blocks, lists, tables, blockquote callouts, links, hr) without
 * pulling in a markdown dependency for a handful of static pages we fully
 * author ourselves. Not a general-purpose parser; it trusts its input
 * (all content is hand-written in content.ts, never user-supplied).
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Order matters: code spans first (so ** inside `code` isn't touched),
  // then bold, then links.
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="px-1.5 py-0.5 bg-white/10 text-[var(--accent)] rounded text-[0.9em] font-mono">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-bold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        const external = /^https?:\/\//.test(href);
        nodes.push(
          <a
            key={key}
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="text-[var(--accent)] hover:underline"
          >
            {label}
          </a>
        );
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  function next() {
    return `md-${key++}`;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <div key={next()} className="my-4 pixel-frame pixel-card overflow-hidden">
          {lang && (
            <div className="px-3 py-1.5 border-b border-white/10 text-[10px] uppercase tracking-wide text-white/30 font-mono">
              {lang}
            </div>
          )}
          <pre className="p-4 overflow-x-auto no-scrollbar text-[12px] leading-relaxed font-mono text-white/80">
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      continue;
    }

    // Table
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|[\s-:|]+\|$/)) {
      const headerCells = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(
          lines[i]
            .trim()
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim())
        );
        i++;
      }
      blocks.push(
        <div key={next()} className="my-4 pixel-frame pixel-card overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-white/40 uppercase text-[10px] tracking-wide">
                {headerCells.map((cell, idx) => (
                  <th key={idx} className="text-left font-bold px-3 py-2 border-b border-white/10">
                    {renderInline(cell, `th-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-t border-white/5">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-white/70">
                      {renderInline(cell, `td-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Callout: > [!note] text  or  > text
    if (line.startsWith(">")) {
      const calloutLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        calloutLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      let tone: "note" | "warn" = "note";
      let content = calloutLines.join(" ");
      const toneMatch = /^\[!(note|warn)\]\s*/i.exec(content);
      if (toneMatch) {
        tone = toneMatch[1].toLowerCase() as "note" | "warn";
        content = content.slice(toneMatch[0].length);
      }
      blocks.push(
        <div
          key={next()}
          className={`my-4 pixel-frame p-4 flex gap-2.5 ${
            tone === "warn" ? "bg-red-400/5" : "bg-lime-400/5"
          }`}
        >
          <iconify-icon
            icon={tone === "warn" ? "pixelarticons:alert" : "pixelarticons:info-box"}
            className={`text-sm mt-0.5 shrink-0 ${tone === "warn" ? "text-red-400" : "text-lime-400"}`}
          />
          <p className="text-[13px] text-white/70 leading-relaxed">
            {renderInline(content, next())}
          </p>
        </div>
      );
      continue;
    }

    // Unordered list
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={next()} className="my-3 space-y-1.5 list-disc list-outside pl-5">
          {items.map((item, idx) => (
            <li key={idx} className="text-[13px] text-white/70 leading-relaxed">
              {renderInline(item, `li-${idx}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={next()} className="my-3 space-y-1.5 list-decimal list-outside pl-5">
          {items.map((item, idx) => (
            <li key={idx} className="text-[13px] text-white/70 leading-relaxed">
              {renderInline(item, `oli-${idx}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={next()} className="my-6 border-white/10" />);
      i++;
      continue;
    }

    // Headers
    const h3 = /^###\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h1 = /^#\s+(.*)/.exec(line);
    if (h3) {
      blocks.push(
        <h3 key={next()} className="text-sm font-bold text-white mt-6 mb-2">
          {renderInline(h3[1], next())}
        </h3>
      );
      i++;
      continue;
    }
    if (h2) {
      blocks.push(
        <h2
          key={next()}
          id={slugifyHeading(h2[1])}
          className="text-lg font-bold text-white mt-8 mb-3 pb-2 border-b border-white/10 scroll-mt-6"
        >
          {renderInline(h2[1], next())}
        </h2>
      );
      i++;
      continue;
    }
    if (h1) {
      blocks.push(
        <h1 key={next()} className="text-2xl font-bold text-white mb-2">
          {renderInline(h1[1], next())}
        </h1>
      );
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-blank, non-special lines.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith(">") &&
      !lines[i].startsWith("```") &&
      !/^-\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("|")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={next()} className="text-[13px] text-white/70 leading-relaxed my-3">
        {renderInline(paraLines.join(" "), next())}
      </p>
    );
  }

  return <>{blocks}</>;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
