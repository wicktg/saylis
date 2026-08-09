"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "../_lib/content";

export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--line)] overflow-y-auto hidden md:block">
      <nav className="p-4 flex flex-col gap-5">
        {DOCS_NAV.map((category) => (
          <div key={category.title}>
            <h3 className="text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[var(--ink-faint)] px-2 mb-1.5">
              {category.title}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {category.pages.map((page) => {
                const href = `/docs/${page.slug}`;
                const isActive = pathname === href;
                return (
                  <li key={page.slug}>
                    <Link
                      href={href}
                      className={`block px-2 py-1.5 rounded-[var(--r-sm)] text-[0.75rem] font-medium transition-colors ${
                        isActive
                          ? "bg-[var(--brand-tint)] text-[var(--brand)] font-bold"
                          : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--surface-sunken)]"
                      }`}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
