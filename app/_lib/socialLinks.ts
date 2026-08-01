/**
 * Normalises the free-text social fields a creator types at mint into safe,
 * clickable URLs.
 *
 * The Create Token inputs are plain text boxes labelled "X" / "Telegram" /
 * "Website", so what lands in the database is whatever someone typed:
 * `@handle`, `handle`, `x.com/handle`, or a full URL. All of those should
 * work, and none of them should be trusted.
 *
 * SECURITY: these strings are attacker-controlled — anyone can launch a
 * token and set them to anything. Putting one straight into an `href` would
 * make `javascript:...` a stored-XSS vector against every visitor who
 * clicks. Only `http:` and `https:` are ever emitted; anything else
 * resolves to `null` and the icon is not rendered at all.
 */

export type SocialKind = "x" | "telegram" | "website";

/** Parses to a URL only if the result is genuinely http(s). */
function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Strips leading `@`, surrounding slashes, and any wrapping whitespace. */
function bareHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/^\/+|\/+$/g, "");
}

/**
 * Turns one stored social value into a URL, or `null` if it is empty or
 * cannot be made safe.
 */
export function resolveSocialUrl(kind: SocialKind, raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  // Already a full URL (with or without a scheme we can add).
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    // Has an explicit scheme — accept only if it survives the http(s) check,
    // which is what rejects `javascript:` and friends.
    return safeUrl(value);
  }

  // Scheme-less but clearly a domain, e.g. "x.com/foo" or "mysite.io".
  if (/^([a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(value)) {
    return safeUrl(`https://${value}`);
  }

  const handle = bareHandle(value);
  if (!handle) return null;

  // A bare handle only makes sense for the two platforms that have them.
  switch (kind) {
    case "x":
      // X handles are letters, digits and underscore, max 15.
      if (!/^\w{1,15}$/.test(handle)) return null;
      return `https://x.com/${handle}`;
    case "telegram":
      // Telegram usernames are 5-32 of letters, digits, underscore.
      if (!/^\w{5,32}$/.test(handle)) return null;
      return `https://t.me/${handle}`;
    case "website":
      // No sensible way to guess a domain from a bare word.
      return null;
  }
}

/** Iconify icon for each platform, matching the icons used at mint time. */
export const SOCIAL_ICONS: Record<SocialKind, string> = {
  x: "ri:twitter-x-fill",
  telegram: "mdi:telegram",
  website: "pixelarticons:globe",
};

export const SOCIAL_LABELS: Record<SocialKind, string> = {
  x: "X",
  telegram: "Telegram",
  website: "Website",
};
