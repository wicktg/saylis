/**
 * Inline SVG icon, keyed by the original iconify name.
 *
 * The names ("pixelarticons:close", "mdi:telegram", ...) are kept from when
 * this was the `<iconify-icon>` web component, and then from the ASCII text
 * tokens that replaced it. Keeping the vocabulary stable has now paid for
 * itself twice: both swaps were a change to this one file, with no call
 * site touched and nothing to re-decide per usage.
 *
 * Why not go back to the iconify font: it was a render-blocking
 * third-party script for a fixed, small set of glyphs. These are ~30 paths
 * that ship in the bundle already parsed.
 *
 * Sizing follows the text, via `1em` and `currentColor`, so `text-sm` /
 * `text-[var(--ink-faint)]` on the call site keep working exactly as they
 * did for the text tokens.
 *
 * Unknown names fall back to a filled dot rather than throwing or
 * rendering nothing — a missing icon should be visible in review, not
 * silently swallowed, and must never take a page down.
 *
 * Accessibility: these are `aria-hidden`, as both predecessors were. They
 * are decoration beside real text. Where an icon is the ONLY content of a
 * control, that control carries its own `aria-label`.
 */

/** Every path is drawn on a 24x24 canvas with `currentColor`. */
const PATHS: Record<string, string> = {
  // ---- Structure / navigation ----
  "pixelarticons:close":
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z",
  "pixelarticons:close-box":
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z",
  "pixelarticons:check": "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z",
  "pixelarticons:chevron-right": "M9.29 6.71 13.17 10.6 9.29 14.5 10.7 15.9 16 10.6 10.7 5.3 9.29 6.71Z",
  "pixelarticons:chevron-left": "M14.71 6.71 10.83 10.6l3.88 3.9-1.41 1.4L8 10.6l5.3-5.3 1.41 1.41Z",
  "pixelarticons:chevron-down": "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z",
  "pixelarticons:chevron-up": "M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41Z",
  "pixelarticons:arrow-left": "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z",
  "pixelarticons:arrow-right": "M4 13h12.17l-5.59 5.59L12 20l8-8-8-8-1.42 1.41L16.17 11H4v2Z",
  "pixelarticons:arrow-down": "M13 4v12.17l5.59-5.59L20 12l-8 8-8-8 1.41-1.41L11 16.17V4h2Z",
  "pixelarticons:external-link":
    "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7ZM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7Z",
  "pixelarticons:plus": "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z",
  "pixelarticons:minus": "M19 13H5v-2h14v2Z",
  "pixelarticons:search":
    "M10.5 3a7.5 7.5 0 0 1 5.92 12.12l4.23 4.23-1.3 1.3-4.23-4.23A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z",
  "pixelarticons:dashboard":
    "M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm8-2h8v8h-8v-8Zm2 2v4h4v-4h-4Z",

  // ---- Objects / concepts ----
  "pixelarticons:wallet":
    "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm0 12H5V5h12v2h-6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h8v2Zm0-4h-8V9h8v6Zm-6-3.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z",
  "pixelarticons:users":
    "M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0-6a2 2 0 1 1-2 2 2 2 0 0 1 2-2ZM8 13a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0-4a1 1 0 1 1-1 1 1 1 0 0 1 1-1Zm8 4c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4Zm6 5H10v-1c0-.64 2.9-2 6-2s6 1.36 6 2v1ZM6 15.5V19H2v-2c0-1.2 1.9-2.16 4-2.42v.92Z",
  "pixelarticons:user":
    "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0-6a2 2 0 1 1-2 2 2 2 0 0 1 2-2Zm0 8c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4Zm6 5H6v-1c0-.64 2.9-2 6-2s6 1.36 6 2v1Z",
  "pixelarticons:ticket":
    "M20 6H4a2 2 0 0 0-2 2v3h1a1 1 0 0 1 0 2H2v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3h-1a1 1 0 0 1 0-2h1V8a2 2 0 0 0-2-2Zm0 3.17a3 3 0 0 0 0 5.66V17H4v-2.17a3 3 0 0 0 0-5.66V8h16v1.17Z",
  "pixelarticons:trophy":
    "M18 4V2H6v2H2v4a4 4 0 0 0 4 4h.35A6 6 0 0 0 11 15.91V18H7v2h10v-2h-4v-2.09A6 6 0 0 0 17.65 12H18a4 4 0 0 0 4-4V4h-4ZM4 8V6h2v4a2 2 0 0 1-2-2Zm11 2a3 3 0 0 1-6 0V4h6v6Zm5-2a2 2 0 0 1-2 2V6h2v2Z",
  "pixelarticons:shield":
    "M12 2 4 5v6c0 4.42 3.4 8.57 8 9.71 4.6-1.14 8-5.29 8-9.71V5l-8-3Zm6 9c0 3.35-2.53 6.62-6 7.65C8.53 17.62 6 14.35 6 11V6.39l6-2.25 6 2.25V11Z",
  "pixelarticons:link":
    "M10.59 13.41a1 1 0 0 1 0-1.41l2.83-2.83a1 1 0 0 1 1.41 1.41L12 13.41a1 1 0 0 1-1.41 0ZM8.46 16.95l-1.41 1.41a3 3 0 0 1-4.24-4.24l3.54-3.53a3 3 0 0 1 4.24 0l-1.42 1.41a1 1 0 0 0-1.41 0l-3.53 3.54a1 1 0 0 0 1.41 1.41l1.41-1.41 1.41 1.41Zm12.73-11.31a3 3 0 0 1 0 4.24l-3.54 3.53a3 3 0 0 1-4.24 0l1.42-1.41a1 1 0 0 0 1.41 0l3.53-3.54a1 1 0 0 0-1.41-1.41l-1.41 1.41-1.42-1.41 1.42-1.41a3 3 0 0 1 4.24 0Z",
  "pixelarticons:info-box":
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm1-13h-2v2h2V7Zm0 4h-2v6h2v-6Z",
  "pixelarticons:alert":
    "M12 2 1 21h22L12 2Zm0 4.24L19.53 19H4.47L12 6.24ZM11 10h2v5h-2v-5Zm0 6h2v2h-2v-2Z",
  "pixelarticons:image-plus":
    "M19 5V2h-2v3h-3v2h3v3h2V7h3V5h-3ZM5 3h7v2H5v14h14v-7h2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2.5 9.5 2 2.5 3-4 4 5.5H6l1.5-4Z",
  "pixelarticons:globe":
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm7.93 9h-3.02a15.6 15.6 0 0 0-1.1-5.2A8.02 8.02 0 0 1 19.93 11ZM12 4.04c.74 1.07 1.63 3.2 1.87 6.96h-3.74c.24-3.76 1.13-5.89 1.87-6.96ZM4.07 13h3.02a15.6 15.6 0 0 0 1.1 5.2A8.02 8.02 0 0 1 4.07 13Zm3.02-2H4.07a8.02 8.02 0 0 1 4.12-5.2A15.6 15.6 0 0 0 7.09 11ZM12 19.96c-.74-1.07-1.63-3.2-1.87-6.96h3.74c-.24 3.76-1.13 5.89-1.87 6.96Zm3.81-1.76a15.6 15.6 0 0 0 1.1-5.2h3.02a8.02 8.02 0 0 1-4.12 5.2Z",
  "pixelarticons:briefcase":
    "M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-10-2h4v2h-4V5ZM4 19V9h16v10H4Z",
  "pixelarticons:bell":
    "M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Zm-2 1H8v-6a4 4 0 0 1 8 0v6Z",
  "pixelarticons:notification":
    "M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Zm-2 1H8v-6a4 4 0 0 1 8 0v6Z",
  "pixelarticons:zap": "M13 2 3 14h7l-1 8 10-12h-7l1-8Z",
  "pixelarticons:send": "M2 21 23 12 2 3v7l15 2-15 2v7Z",
  "pixelarticons:coin":
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm.5-13h-1v1.09c-1.44.2-2.5 1.1-2.5 2.41 0 1.6 1.44 2.2 2.86 2.55 1.36.34 1.64.72 1.64 1.2 0 .38-.33.9-1.5.9-1.06 0-1.5-.45-1.56-1.07H8.4c.07 1.33 1.05 2.2 2.6 2.42V17h1v-1.1c1.5-.22 2.5-1.13 2.5-2.44 0-1.7-1.5-2.28-2.9-2.63-1.4-.35-1.6-.7-1.6-1.13 0-.36.28-.85 1.4-.85 1 0 1.38.42 1.43 1h1.53c-.06-1.25-.95-2.1-2.36-2.31V7Z",
  "pixelarticons:copy":
    "M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z",
  "pixelarticons:book-open":
    "M12 5.5A6.5 6.5 0 0 0 7.5 4C5.9 4 4.3 4.4 3 5v14.5c1.3-.6 2.9-1 4.5-1 1.7 0 3.3.4 4.5 1 1.2-.6 2.8-1 4.5-1s3.2.4 4.5 1V5c-1.3-.6-2.9-1-4.5-1A6.5 6.5 0 0 0 12 5.5Zm7 12A9.5 9.5 0 0 0 16.5 17c-1.3 0-2.5.2-3.5.6V7.6c1-.4 2.2-.6 3.5-.6 1 0 1.8.1 2.5.3v10.2Z",
  "pixelarticons:logout":
    "M17 8l-1.41 1.41L17.17 11H9v2h8.17l-1.58 1.58L17 16l4-4-4-4ZM5 5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7v-2H5V5Z",

  // ---- Social ----
  "mdi:telegram":
    "M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42Z",
  "ri:twitter-x-fill":
    "M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41Z",
};

export default function Icon({
  icon,
  className = "",
}: {
  icon: string;
  className?: string;
}) {
  const path = PATHS[icon];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={`inline-block shrink-0 w-[1em] h-[1em] align-[-0.125em] ${className}`}
      fill="currentColor"
    >
      {path ? <path d={path} /> : <circle cx="12" cy="12" r="4" />}
    </svg>
  );
}
