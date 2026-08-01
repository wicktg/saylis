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
      <p className="text-[10px] uppercase tracking-wide text-white/30 mb-2">{meta.category}</p>
      <div className="docs-prose">{renderMarkdown(source)}</div>

      <div className="mt-12 pt-6 border-t border-white/10 flex items-center justify-between gap-4">
        {prev ? (
          <Link
            href={`/docs/${prev.slug}`}
            className="pixel-frame pixel-card px-4 py-3 flex-1 hover:bg-white/5 transition-colors"
          >
            <p className="text-[9px] uppercase tracking-wide text-white/30">Previous</p>
            <p className="text-[12px] font-bold mt-0.5">{prev.title}</p>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {next && (
          <Link
            href={`/docs/${next.slug}`}
            className="pixel-frame pixel-card px-4 py-3 flex-1 text-right hover:bg-white/5 transition-colors"
          >
            <p className="text-[9px] uppercase tracking-wide text-white/30">Next</p>
            <p className="text-[12px] font-bold mt-0.5">{next.title}</p>
          </Link>
        )}
      </div>
    </article>
  );
}
