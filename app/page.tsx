"use client";

import { useState } from "react";
import AppShell from "@/app/_components/AppShell";
import TokenGrid from "@/app/_components/TokenGrid";
import CreateTokenModal from "@/app/_components/CreateTokenModal";
import Icon from "@/app/_components/Icon";
import { SORT_OPTIONS, type SortOption } from "@/app/_lib/sort";

/**
 * The token board.
 *
 * Sorting is a segmented control rather than a dropdown: there are only
 * four options and they are the primary way anyone navigates this page, so
 * hiding them behind a click to save a row of space is the wrong trade.
 */
export default function ExplorePage() {
  const [sortBy, setSortBy] = useState<SortOption>("trending");
  const [search, setSearch] = useState("");
  const [createTokenOpen, setCreateTokenOpen] = useState(false);

  return (
    <AppShell>
      <div className="w-full max-w-[var(--shell)] mx-auto px-[var(--gutter)] pt-[clamp(24px,4vh,40px)] pb-[clamp(40px,7vh,72px)]">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h1 className="font-display text-[clamp(1.375rem,2.6vw,1.875rem)] leading-tight text-[#2e2e2e] m-0">
            Tokens
          </h1>

          {/* Rendered whether or not a wallet is connected: the modal
              explains what to do about that, and hiding the entry point
              leaves a disconnected visitor with no way to find out the
              feature exists. */}
          <button
            type="button"
            onClick={() => setCreateTokenOpen(true)}
            className="btn btn-primary max-sm:w-full"
          >
            Create token
          </button>
        </div>

        <div className="mt-[clamp(20px,3vh,28px)] flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="filters" role="group" aria-label="Sort tokens">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="filter"
                aria-pressed={option.value === sortBy}
                onClick={() => setSortBy(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="pixel-frame pixel-input flex items-center gap-2.5 h-10 px-[15px] flex-1 basis-[220px] max-w-full md:max-w-[300px] min-w-0">
            <Icon
              icon="pixelarticons:search"
              className="text-[var(--ink-faint)] text-sm shrink-0"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or ticker"
              autoComplete="off"
              className="w-full min-w-0 bg-transparent border-0 text-[0.8125rem] font-medium text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-[clamp(28px,3.6vh,38px)]">
          <TokenGrid sortBy={sortBy} search={search} />
        </div>
      </div>

      <CreateTokenModal open={createTokenOpen} onClose={() => setCreateTokenOpen(false)} />
    </AppShell>
  );
}
