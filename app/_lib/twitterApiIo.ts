/**
 * SERVER-ONLY client for twitterapi.io — a third-party, read-only Twitter/X
 * data API used solely to check a public profile's bio for a verification
 * code. It has no OAuth and no login flow; ownership is proven out-of-band
 * by asking the user to paste a code into their own bio (see
 * /api/x/verify/confirm), not by anything this client does.
 *
 * Never import this from a client component — TWITTERAPI_IO_API_KEY has no
 * NEXT_PUBLIC_ prefix and must not reach the browser bundle.
 */

const BASE_URL = "https://api.twitterapi.io/twitter/user/info";

export type TwitterApiIoProfile = {
  id: string;
  username: string;
  bio: string;
  avatarUrl: string | null;
};

export class TwitterApiIoError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "not_found" | "request_failed"
  ) {
    super(message);
  }
}

/**
 * Looks up a public X profile by username. Throws `TwitterApiIoError` with
 * a `code` the callers can branch on rather than parsing message strings.
 */
export async function fetchXProfile(username: string): Promise<TwitterApiIoProfile> {
  const apiKey = process.env.TWITTERAPI_IO_API_KEY;
  if (!apiKey) {
    throw new TwitterApiIoError("twitterapi.io is not configured.", "not_configured");
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("userName", username);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    });
  } catch {
    throw new TwitterApiIoError("Could not reach twitterapi.io.", "request_failed");
  }

  if (!response.ok) {
    throw new TwitterApiIoError(
      `twitterapi.io returned HTTP ${response.status}.`,
      "request_failed"
    );
  }

  const body = await response.json();

  // The API reports a missing/suspended/private account as HTTP 200 with
  // `data.unavailable: true` rather than a 404, so this has to be checked
  // explicitly instead of relying on response.ok above.
  if (body?.status !== "success" || !body?.data || body.data.unavailable) {
    throw new TwitterApiIoError(
      body?.data?.unavailableReason || body?.msg || "X account not found.",
      "not_found"
    );
  }

  const data = body.data;
  return {
    id: String(data.id),
    username: String(data.userName),
    bio: String(data.description ?? ""),
    avatarUrl: typeof data.profilePicture === "string" ? upscaleAvatar(data.profilePicture) : null,
  };
}

/** twitterapi.io mirrors X's own default 48px `_normal` avatar; upsize it. */
function upscaleAvatar(url: string): string {
  return url.replace("_normal.", "_400x400.");
}
