/**
 * Drop-in replacement for the `<iconify-icon>` web component, rendering an
 * ASCII text token instead of a glyph from an icon font.
 *
 * The `icon` prop deliberately keeps the original iconify names
 * ("pixelarticons:close", "mdi:telegram", ...) rather than inventing a new
 * vocabulary. That made the swap across ~19 files a mechanical tag rename
 * with no per-call-site rethinking, and it keeps the diff readable.
 *
 * Unknown names fall back to "[?]" rather than throwing or rendering
 * nothing — a missing icon should be visible in review, not silently
 * swallowed, and must never take a page down.
 *
 * Accessibility: these are `aria-hidden`, exactly as the icon font was.
 * They are decoration sitting beside real text. Where an icon is the ONLY
 * content of a control, that control carries its own `aria-label` / `title`
 * (unchanged from before this conversion).
 */
const GLYPHS: Record<string, string> = {
  // Structure / navigation
  "pixelarticons:close": "[x]",
  "pixelarticons:close-box": "[x]",
  "pixelarticons:check": "[ok]",
  "pixelarticons:chevron-right": ">",
  "pixelarticons:chevron-left": "<",
  "pixelarticons:chevron-down": "v",
  "pixelarticons:chevron-up": "^",
  "pixelarticons:arrow-left": "<-",
  "pixelarticons:arrow-right": "->",
  "pixelarticons:external-link": "[^]",
  "pixelarticons:plus": "+",
  "pixelarticons:minus": "-",
  "pixelarticons:search": ">",

  // Objects / concepts
  "pixelarticons:wallet": "[wallet]",
  "pixelarticons:users": "[users]",
  "pixelarticons:user": "[user]",
  "pixelarticons:ticket": "[ticket]",
  "pixelarticons:shield": "[shield]",
  "pixelarticons:link": "[link]",
  "pixelarticons:info-box": "[i]",
  "pixelarticons:image-plus": "[img]",
  "pixelarticons:globe": "[www]",
  "pixelarticons:briefcase": "[work]",
  "pixelarticons:bell": "[bell]",
  "pixelarticons:zap": "[!]",
  "pixelarticons:send": "[send]",
  "pixelarticons:coin": "[$]",
  "pixelarticons:copy": "[copy]",

  // Social
  "mdi:telegram": "[tg]",
  "ri:twitter-x-fill": "[x.com]",
};

export default function Icon({
  icon,
  className = "",
}: {
  icon: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`ascii inline-block leading-none whitespace-nowrap ${className}`}
    >
      {GLYPHS[icon] ?? "[?]"}
    </span>
  );
}
