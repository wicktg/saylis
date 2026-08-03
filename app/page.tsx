"use client";

import { useRef, useState } from "react";
import AppShell from "@/app/_components/AppShell";
import TokenGrid from "@/app/_components/TokenGrid";
import { useOutsideClick } from "@/app/_lib/useOutsideClick";
import { SORT_OPTIONS, type SortOption } from "@/app/_lib/sort";

export default function ExplorePage() {
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sortRef = useRef<HTMLDivElement>(null);
  useOutsideClick(sortRef, () => setSortOpen(false));

  const activeLabel = SORT_OPTIONS.find((option) => option.value === sortBy)?.label;

  return (
    <AppShell>
      <div className="ascii flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-3 gap-3">
          <h1 className="text-lg text-white lowercase">
            <span className="text-white/25">./</span>tokens
          </h1>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <label className="ascii-box relative flex items-center gap-2 px-2.5 py-2.5 md:py-1.5 flex-1 md:flex-none md:w-56">
              <span className="text-[11px] text-[var(--accent)] shrink-0">&gt;</span>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="search ticker or address"
                className="bg-transparent text-[11px] text-white focus:outline-none placeholder:text-white/25 w-full"
              />
            </label>

            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen((prev) => !prev)}
                className="ascii-box relative flex items-center gap-2 px-2.5 py-2.5 md:py-1.5 cursor-pointer w-full md:w-[180px]"
              >
                <span className="ascii-label text-[11px] shrink-0">sort</span>
                <span className="text-[11px] text-white truncate">{activeLabel}</span>
                <span className="text-[10px] text-white/30 ml-auto shrink-0">
                  {sortOpen ? "[-]" : "[+]"}
                </span>
              </button>

              {sortOpen && (
                <div className="ascii-box absolute right-0 top-full mt-1 w-[180px] z-50 py-1">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSortBy(option.value);
                        setSortOpen(false);
                      }}
                      data-selected={option.value === sortBy}
                      className={`ascii-option w-full text-left px-2.5 py-2.5 md:py-1.5 text-[11px] transition-colors ${
                        option.value === sortBy
                          ? "text-[var(--accent)]"
                          : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ascii-rule text-[11px] leading-none mb-5" aria-hidden="true" />

        <TokenGrid sortBy={sortBy} search={search} />
      </div>
    </AppShell>
  );
}
