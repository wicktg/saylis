import { NextResponse, type NextRequest } from "next/server";

/**
 * Restricts /admin to a fixed set of IPs, and makes it look absent to
 * everyone else.
 *
 * A 404 rather than a 403 on purpose: a 403 confirms the route exists and
 * that you are simply not allowed, which is an invitation. Rewriting to a
 * path that does not exist makes Next render its ordinary not-found page,
 * so the response is indistinguishable from a URL that was never a route.
 *
 * THIS IS A SECOND LOCK, NOT THE LOCK
 *
 * The admin page already checks the connected wallet against
 * INFOFI_TEAM_ADDRESS, and that remains the real authorisation: an IP is a
 * network location, not an identity, and one shared home connection covers
 * everyone on it. What this adds is that the page stops being discoverable
 * or probeable from anywhere else, which is worth having and is not worth
 * mistaking for authentication.
 *
 * THE ALLOWLIST LIVES IN THE ENVIRONMENT, DELIBERATELY
 *
 * `ADMIN_ALLOWED_IPS`, comma separated. Not committed, for two reasons: a
 * home IP in a public repository is an unnecessary disclosure, and a
 * residential address is usually dynamic — so it WILL change, and it needs
 * to be changeable without a code edit.
 *
 * With the variable unset in production, nobody reaches /admin, including
 * you. That is the deliberate direction to fail: locked out is recoverable
 * in a minute, wide open is not.
 */

const ADMIN_PATHS = ["/admin"];

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};

/**
 * The client's address as the platform saw it.
 *
 * Read from the proxy headers rather than trusted from the client. On
 * Vercel the leftmost `x-forwarded-for` entry is the real client, appended
 * by the edge itself; `x-real-ip` is the same value under another name and
 * is the fallback for hosts that only set that one.
 *
 * Behind any OTHER proxy this needs checking before it is relied on — a
 * misconfigured chain lets a caller prepend their own value and choose
 * what this function returns.
 */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

function allowedIps(): string[] {
  return (process.env.ADMIN_ALLOWED_IPS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  // Local development is not reachable from outside, and gating it would
  // only mean the page cannot be worked on.
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const allowed = allowedIps();
  const ip = clientIp(request);

  if (allowed.length > 0 && ip !== null && allowed.includes(ip)) {
    return NextResponse.next();
  }

  // A route that does not exist, so Next answers with its own 404 rather
  // than anything that hints at what was really here.
  return NextResponse.rewrite(new URL("/_admin_absent", request.url));
}
