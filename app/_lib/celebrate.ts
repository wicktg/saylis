import confetti from "canvas-confetti";

/** Brand palette: monochrome white/gray/black, matching the rest of the UI. */
const COLORS = ["#ffffff", "#d4d4d4", "#1a0c6d"];

/**
 * Classic "party popper" burst: two low-angle blasts firing up and inward
 * from the bottom corners, like a pair of party poppers going off toward
 * the center of the screen.
 */
export function celebrateTokenLaunch() {
  const shared: confetti.Options = {
    colors: COLORS,
    startVelocity: 55,
    spread: 65,
    ticks: 200,
    gravity: 1,
    scalar: 0.9,
    zIndex: 200,
  };

  confetti({ ...shared, particleCount: 90, angle: 60, origin: { x: 0, y: 1 } });
  confetti({ ...shared, particleCount: 90, angle: 120, origin: { x: 1, y: 1 } });
}
