/**
 * A plain rotating ring, sized and coloured by the caller's own text
 * classes (`text-xl text-[var(--brand)]` etc.) via `font-size`/`currentColor`
 * — same calling convention the ASCII cycling-character spinner this
 * replaced used, so no call site needed to change beyond the import.
 *
 * A CSS animation rather than a JS interval: the previous spinner cycled
 * discrete glyphs on a timer because a character has no "in-between"
 * frames. A ring is a continuous rotation, which is exactly what
 * `@keyframes spin` is for, and it costs nothing while off-screen.
 */
export default function Spinner({
  className = "",
  label = "Loading",
}: {
  className?: string;
  /** Announced to screen readers; the ring itself is decorative. */
  label?: string;
}) {
  return (
    <span role="status" aria-label={label} className={`inline-block ${className}`}>
      <span aria-hidden="true" className="spinner-circle block w-[1em] h-[1em]" />
    </span>
  );
}
