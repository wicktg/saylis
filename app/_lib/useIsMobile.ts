"use client";

import { useEffect, useState } from "react";

/**
 * Viewport breakpoint, as a boolean, for cases where mobile and desktop
 * need genuinely DIFFERENT component trees rather than the same tree
 * scaled down.
 *
 * Most responsive work in this app should still be Tailwind's `md:`
 * classes -- CSS is cheaper, has no hydration cost, and reflows instantly
 * on rotate. Reach for this hook only when the structures actually differ:
 * the chart's drawing toolbar must be ABSENT from the DOM on mobile (not
 * merely hidden, so its bundle never loads), modals become full-screen
 * sheets rather than centred boxes, and navigation moves from a top bar to
 * a bottom tab bar.
 *
 * 768px is Tailwind's own `md` breakpoint. Keeping the two in lockstep
 * matters: a component that renders conditionally here and is styled with
 * `md:` elsewhere would otherwise disagree with itself in a narrow band of
 * viewport widths.
 */
export const MOBILE_BREAKPOINT_PX = 768;

/**
 * Returns `false` during SSR and on the very first client render, then the
 * real value immediately after mount.
 *
 * That two-phase behaviour is deliberate, not a bug. The server has no
 * viewport, so any guess it makes is wrong half the time; React would then
 * find different markup on hydration and throw a mismatch. Rendering the
 * desktop tree first and correcting on mount keeps hydration exact. Use
 * `hasMounted` below when a component must not paint the wrong layout at
 * all before correcting itself.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    // Set immediately, then track. Reading inside the effect (rather than
    // in a lazy useState initialiser) is what keeps the first client render
    // identical to the server's.
    setIsMobile(query.matches);

    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/**
 * True once the client has mounted. Pair with `useIsMobile` when rendering
 * the desktop tree first would be visibly wrong (a full-screen sheet
 * flashing as a centred modal, say) and showing nothing for one frame is
 * the better trade.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
