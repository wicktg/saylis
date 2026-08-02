"use client";

export const WINNER_MIN = 25;
export const WINNER_MAX = 100;
export const WINNER_STEP = 5;

/** Clamps to the legal range and snaps to the nearest step boundary. */
export function normalizeWinnerCount(value: number): number {
  const snapped = Math.round(value / WINNER_STEP) * WINNER_STEP;
  return Math.min(WINNER_MAX, Math.max(WINNER_MIN, snapped));
}

/**
 * `[-] 50 [+]` picker for the airdrop size, stepping 5 at a time.
 *
 * A dropdown was the wrong control here. It presented sixteen options as if
 * they were unrelated choices, when the value is really one number on a
 * scale — and it made the number look casually re-selectable, which it is
 * not: participants decide whether to enter on the strength of these odds,
 * so the count is committed once and then fixed.
 *
 * Committing is therefore a separate, deliberate action rather than
 * something a stray click on the stepper can do. Pass `locked` once the
 * value is settled and this renders as plain text with no affordance to
 * change it.
 */
export default function WinnerCountStepper({
  value,
  onChange,
  disabled = false,
  locked = false,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** Already committed — render read-only. */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <p className="text-xs font-bold">
        {value} <span className="font-normal text-white/40">winners</span>
      </p>
    );
  }

  const atMin = value <= WINNER_MIN;
  const atMax = value >= WINNER_MAX;

  return (
    <div className="flex items-center gap-2">
      <StepButton
        label="Decrease winners"
        icon="pixelarticons:minus"
        disabled={disabled || atMin}
        onClick={() => onChange(normalizeWinnerCount(value - WINNER_STEP))}
      />

      <div className="pixel-frame pixel-input px-3 py-1.5 min-w-[64px] text-center">
        <span className="text-xs font-bold tabular-nums">{value}</span>
      </div>

      <StepButton
        label="Increase winners"
        icon="pixelarticons:plus"
        disabled={disabled || atMax}
        onClick={() => onChange(normalizeWinnerCount(value + WINNER_STEP))}
      />
    </div>
  );
}

function StepButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="pixel-frame pixel-btn-ghost w-7 h-7 flex items-center justify-center text-white/70 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
    >
      <iconify-icon icon={icon} className="text-sm" />
    </button>
  );
}
