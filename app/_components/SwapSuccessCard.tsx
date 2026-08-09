"use client";

/**
 * The confirmation shown once a trade lands: a green tick, what went in,
 * what came out, and a way back.
 *
 * Replaces the panel body rather than floating over it, so the numbers that
 * are no longer true (balances, the quote) are gone rather than sitting
 * stale behind a scrim.
 *
 * The received figure is the quote the trade was signed against, not a
 * value read back from the receipt logs — see `SwapPanel`, which passes it
 * in. That is why the wording is deliberately "you swapped" rather than an
 * exact settlement statement.
 */
export default function SwapSuccessCard({
  paid,
  received,
  onDone,
}: {
  paid: string;
  received: string;
  onDone: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-[18px] py-8">
      <span className="success-badge grid place-items-center w-14 h-14 rounded-[var(--r-lg)] bg-[var(--up)] text-white">
        <svg viewBox="0 0 24 24" className="w-8 h-8" aria-hidden="true" fill="none">
          <path
            className="success-tick"
            d="M5 12.5 10 17.5 19 7.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <p className="success-line mt-4 text-[0.875rem] font-bold text-[var(--ink)]">Swap complete</p>

      <div className="success-line success-line-2 mt-4 flex items-center justify-center gap-2.5 flex-wrap">
        <span className="text-[0.8125rem] font-bold tabular-nums text-[var(--ink)]">{paid}</span>
        <span className="text-[var(--ink-faint)]" aria-hidden="true">
          &rarr;
        </span>
        <span className="text-[0.8125rem] font-bold tabular-nums text-[var(--brand)]">
          {received}
        </span>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="success-line success-line-3 btn btn-primary w-full mt-7"
      >
        Done
      </button>
    </div>
  );
}
