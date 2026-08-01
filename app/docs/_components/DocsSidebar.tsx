"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "../_lib/content";

export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-white/10 overflow-y-auto pixel-scrollbar hidden md:block">
      <nav className="p-4 flex flex-col gap-5">
        {DOCS_NAV.map((category) => (
          <div key={category.title}>
            <h3 className="text-[10px] uppercase tracking-wide text-white/30 font-bold px-2 mb-1.5">
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
                      className={`block px-2 py-1.5 rounded text-[12px] transition-colors ${
                        isActive
                          ? "bg-lime-400/10 text-lime-400 font-bold"
                          : "text-white/50 hover:text-white hover:bg-white/5"
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
