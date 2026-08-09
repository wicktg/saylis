"use client";

import { asciiBarParts } from "@/app/_lib/asciiBar";

/**
 * A range input drawn as a terminal bar.
 *
 * The native `<input type="range">` is kept and simply made invisible,
 * stretched over the character track. That is deliberate rather than
 * rebuilding drag behaviour on a div: the real input keeps keyboard
 * support (arrows, Home/End, Page Up/Down), screen-reader semantics, the
 * `step` snapping, and touch handling for free. Only its appearance is
 * replaced, so nothing about how the value is produced changes.
 *
 * The track is a fixed number of character cells rather than a percentage
 * width, because a terminal bar is quantised by nature -- the exact value
 * is always printed next to it by the caller.
 */
const TRACK_CELLS = 28;

export default function AsciiSlider({
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  // Guard a zero-width range (min === max) rather than dividing by zero.
  const span = max - min;
  const pct = span > 0 ? ((value - min) / span) * 100 : 0;
  const { filled, empty } = asciiBarParts(pct, TRACK_CELLS);

  return (
    <div className={`relative select-none ${disabled ? "opacity-40" : ""}`}>
      <div
        aria-hidden="true"
        className="ascii text-[13px] leading-none tracking-[-0.05em] whitespace-nowrap overflow-hidden"
      >
        <span className={disabled ? "text-[var(--ink-faint)]" : "text-[var(--accent)]"}>{filled}</span>
        <span className="text-[var(--ink-faint)]">{empty}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
    </div>
  );
}
