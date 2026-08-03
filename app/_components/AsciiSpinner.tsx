"use client";

import { useEffect, useState } from "react";

/**
 * The classic terminal spinner: a single character cycling through
 * | / - \ in place.
 *
 * Replaces the rotating CSS ring, which was the one deliberate exception
 * to the app's square-everything rule back when the design was pixel-art.
 * With an ASCII UI there is no longer any reason to keep a circle around
 * -- a spinning character IS what "loading" looks like in a terminal.
 *
 * Driven by an interval rather than a CSS animation because the frames are
 * discrete glyphs, not a continuous transform.
 */
const FRAMES = ["|", "/", "-", "\\"] as const;
const FRAME_MS = 120;

export default function AsciiSpinner({
  className = "",
  label = "Loading",
}: {
  className?: string;
  /** Announced to screen readers; the glyph itself is decorative. */
  label?: string;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span role="status" aria-label={label} className={`ascii inline-block ${className}`}>
      <span aria-hidden="true">{FRAMES[frame]}</span>
    </span>
  );
}
