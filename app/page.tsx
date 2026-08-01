"use client";

import { useRef, useState } from "react";
import AppShell from "@/app/_components/AppShell";
import TokenGrid from "@/app/_components/TokenGrid";
import { useOutsideClick } from "@/app/_lib/useOutsideClick";
import { SORT_OPTIONS, type SortOption } from "@/app/_lib/sort";

export default function ExplorePage() {
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  useOutsideClick(sortRef, () => setSortOpen(false));

  const activeLabel = SORT_OPTIONS.find((option) => option.value === sortBy)?.label;

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">Tokens</h1>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="pixel-frame pixel-input flex items-center gap-2 px-3 py-2 w-48">
              <iconify-icon icon="pixelarticons:search" className="text-white/30 text-sm shrink-0" />
              <input
                type="text"
                placeholder="Search tokens or paste ca..."
                className="bg-transparent text-[11px] text-white focus:outline-none placeholder:text-white/30 w-full"
              />
            </div>

            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen((prev) => !prev)}
                className="pixel-frame pixel-btn-ghost flex items-center gap-2 px-3 py-2 cursor-pointer w-[168px] shrink-0"
              >
                <span className="text-[11px] text-white/40 shrink-0">Sort By:</span>
                <span className="text-[11px] font-medium text-white truncate">{activeLabel}</span>
                <iconify-icon
                  icon="pixelarticons:chevron-down"
                  className={`text-white/30 transition-transform shrink-0 ml-auto ${sortOpen ? "rotate-180" : ""}`}
                />
              </button>

              {sortOpen && (
                <div className="pixel-frame pixel-panel absolute right-0 top-full mt-2 w-40 z-50 py-1">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSortBy(option.value);
                        setSortOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-[11px] font-medium transition-colors ${
                        option.value === sortBy
                          ? "text-[var(--accent)] bg-[var(--accent-tint)]"
                          : "text-white/70 hover:bg-white/5 hover:text-white"
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

        <TokenGrid sortBy={sortBy} />
      </div>
    </AppShell>
  );
}
