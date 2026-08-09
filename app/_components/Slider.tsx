"use client";

/**
 * A styled range input: a rounded track with a brand-coloured fill and a
 * round thumb.
 *
 * Replaces `AsciiSlider`, which drew the same control as a row of `█`/`░`
 * characters — a terminal affectation with no place in the light design
 * system, and quantised to 28 cells so the handle visibly stair-stepped
 * while dragging.
 *
 * The native `<input type="range">` is still doing all the work; only its
 * appearance is replaced. That is deliberate rather than rebuilding drag
 * behaviour on a div: the real input keeps keyboard support (arrows,
 * Home/End, Page Up/Down), screen-reader semantics, `step` snapping, and
 * touch handling for free.
 *
 * The fill is painted as a `linear-gradient` background on the input
 * itself, cut at the current percentage. That avoids a second absolutely
 * positioned element having to stay in sync with the thumb, and it is the
 * one approach that works identically in both the WebKit and Firefox
 * pseudo-element models.
 */
export default function Slider({
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

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(parseFloat(event.target.value))}
      disabled={disabled}
      className="range-slider"
      style={{ ["--range-pct" as string]: `${pct}%` }}
    />
  );
}
