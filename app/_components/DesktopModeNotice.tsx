"use client";

import { useEffect, useState } from "react";
import { MOBILE_BREAKPOINT_PX } from "@/app/_lib/useIsMobile";

/**
 * Blanks the app when a phone is running "Request desktop site".
 *
 * WHY THIS NEEDS A DEVICE SIGNAL, NOT A WIDTH
 *
 * Desktop mode does not change the device, it changes what the device
 * REPORTS: the browser starts claiming a ~980px viewport and ignores the
 * page's viewport meta, so every width-based check in the app decides it is
 * on a desktop and serves the desktop shell. A width alone therefore cannot
 * tell this case apart from an actual laptop.
 *
 * The tell is the combination:
 *
 *   - `pointer: coarse` — the primary input is a finger, not a mouse.
 *   - a wide reported viewport — the desktop shell is what is rendering.
 *   - a small physical screen — `screen.width` describes the panel and is
 *     not affected by desktop mode, so it stays phone-sized.
 *
 * All three together are a phone lying about its size. A touchscreen laptop
 * clears the first two and fails the third, which is what keeps this from
 * blanking a real desktop.
 *
 * WHY IT BLOCKS RATHER THAN SUGGESTS
 *
 * A phone rendering the desktop shell is not slightly worse, it is the
 * wrong build: the bottom tab bar is gone, so navigation is gone with it,
 * and every hit target is sized for a cursor. There is no version of that
 * worth letting someone struggle through, so this covers the app entirely
 * and re-checks on resize — the moment desktop mode goes off, the viewport
 * narrows, this unmounts itself and the real app is behind it.
 */
export default function DesktopModeNotice() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    function evaluate() {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const wideViewport = window.innerWidth >= MOBILE_BREAKPOINT_PX;
      const smallScreen = window.screen.width < 900;
      setBlocked(coarse && wideViewport && smallScreen);
    }

    evaluate();
    window.addEventListener("resize", evaluate);
    window.addEventListener("orientationchange", evaluate);
    return () => {
      window.removeEventListener("resize", evaluate);
      window.removeEventListener("orientationchange", evaluate);
    };
  }, []);

  // Nothing behind this should scroll while it is up.
  useEffect(() => {
    if (!blocked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [blocked]);

  if (!blocked) return null;

  return (
    <div className="viewport-block" role="alertdialog" aria-modal="true">
      <p>Switch to mobile view for the best possible experience.</p>
    </div>
  );
}
