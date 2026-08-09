import Link from "next/link";
import { notFound } from "next/navigation";
import { renderMarkdown } from "../_lib/markdown";
import { DOCS_CONTENT } from "../_lib/pages";
import { findDocPage, flatPages } from "../_lib/content";

export default function DocPageBody({ slug }: { slug: string }) {
  const meta = findDocPage(slug);
  const source = DOCS_CONTENT[slug];
  if (!meta || !source) notFound();

  const pages = flatPages();
  const index = pages.findIndex((p) => p.slug === slug);
  const prev = index > 0 ? pages[index - 1] : null;
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;

  return (
    <article>
      <p className="text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[var(--ink-faint)] mb-2">
        {meta.category}
      </p>
      <div className="docs-prose">{renderMarkdown(source)}</div>

      <div className="mt-12 pt-6 border-t border-[var(--line)] flex items-center justify-between gap-4">
        {prev ? (
          <Link
            href={`/docs/${prev.slug}`}
            className="pixel-frame pixel-card px-4 py-3 flex-1 hover:border-[var(--brand-soft)] transition-colors"
          >
            <p className="text-[0.5625rem] font-bold uppercase tracking-[0.06em] text-[var(--ink-faint)]">
              Previous
            </p>
            <p className="text-[0.75rem] font-bold text-[var(--ink)] mt-0.5">{prev.title}</p>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {next && (
          <Link
            href={`/docs/${next.slug}`}
            className="pixel-frame pixel-card px-4 py-3 flex-1 text-right hover:border-[var(--brand-soft)] transition-colors"
          >
            <p className="text-[0.5625rem] font-bold uppercase tracking-[0.06em] text-[var(--ink-faint)]">
              Next
            </p>
            <p className="text-[0.75rem] font-bold text-[var(--ink)] mt-0.5">{next.title}</p>
          </Link>
        )}
      </div>
    </article>
  );
}
