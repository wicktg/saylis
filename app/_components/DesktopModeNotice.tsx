"use client";

import { useEffect, useState } from "react";
import Icon from "@/app/_components/Icon";
import { MOBILE_BREAKPOINT_PX } from "@/app/_lib/useIsMobile";

const DISMISS_KEY = "saylis:desktop-mode-notice-dismissed";

/**
 * Nudges a phone that has been switched into "Request desktop site".
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
 *   - a small physical screen — `screen.width` still describes the panel,
 *     not the pretend viewport, so it stays phone-sized.
 *
 * All three together are a phone lying about its size. A touchscreen laptop
 * clears the first two but fails the third.
 *
 * Deliberately advisory. The app is not broken in desktop mode, it is just
 * cramped, so this is a dismissible line rather than a block, and the
 * dismissal is remembered.
 */
export default function DesktopModeNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;

    function evaluate() {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const wideViewport = window.innerWidth >= MOBILE_BREAKPOINT_PX;
      // `screen.width` reports the physical panel and is unaffected by
      // desktop mode, which is what makes it the deciding signal.
      const smallScreen = window.screen.width < 900;
      setShow(coarse && wideViewport && smallScreen);
    }

    evaluate();
    window.addEventListener("resize", evaluate);
    window.addEventListener("orientationchange", evaluate);
    return () => {
      window.removeEventListener("resize", evaluate);
      window.removeEventListener("orientationchange", evaluate);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="viewport-note" role="status">
      <p>
        You are in <b>desktop mode</b>. Turn it off for a layout built for your
        screen.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setShow(false);
        }}
      >
        <Icon icon="pixelarticons:close" className="text-xs" />
      </button>
    </div>
  );
}
