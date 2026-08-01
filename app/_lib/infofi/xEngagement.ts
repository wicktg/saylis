/**
 * SERVER-ONLY: pulls a participant's campaign posts from twitterapi.io and
 * totals their engagement.
 *
 * Never import this from a client component — TWITTERAPI_IO_API_KEY has no
 * NEXT_PUBLIC_ prefix and must not reach the browser bundle.
 */
import type { Engagement } from "@/app/_lib/infofi/mindshare";

const TWEETS_URL = "https://api.twitterapi.io/twitter/user/last_tweets";

/** One post, reduced to what scoring needs. */
type RawTweet = {
  id?: string;
  text?: string;
  createdAt?: string;
  created_at?: string;
  viewCount?: number;
  view_count?: number;
  likeCount?: number;
  like_count?: number;
  replyCount?: number;
  reply_count?: number;
  retweetCount?: number;
  retweet_count?: number;
  quoteCount?: number;
  quote_count?: number;
  isReply?: boolean;
  is_reply?: boolean;
  inReplyToId?: string | null;
  in_reply_to_id?: string | null;
};

export class XEngagementError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "request_failed"
  ) {
    super(message);
  }
}

function num(...candidates: (number | undefined)[]): number {
  for (const c of candidates) if (typeof c === "number" && Number.isFinite(c)) return c;
  return 0;
}

/**
 * A reply is anything that hangs off another post. Campaign rules count
 * original posts and quote-tweets only, because a reply borrows its parent's
 * audience — farming a big account's replies would otherwise be the cheapest
 * possible way to accumulate views.
 *
 * A quote-tweet is deliberately NOT a reply here: it stands on the author's
 * own timeline and carries their own reach, which is the behaviour the
 * campaign is trying to reward.
 */
function isReply(tweet: RawTweet): boolean {
  if (typeof tweet.isReply === "boolean") return tweet.isReply;
  if (typeof tweet.is_reply === "boolean") return tweet.is_reply;
  const parent = tweet.inReplyToId ?? tweet.in_reply_to_id;
  if (parent) return true;
  // Last resort: the classic leading-@ convention.
  return typeof tweet.text === "string" && /^@\w/.test(tweet.text.trim());
}

function tweetTimestamp(tweet: RawTweet): number | null {
  const raw = tweet.createdAt ?? tweet.created_at;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Fetches recent posts for `username` and totals engagement across those
 * that count for this campaign.
 *
 * @param joinedAtMs Scoring cutoff. Posts at or before this instant are
 *        ignored — joining should not retroactively credit content written
 *        before the participant opted in.
 * @param mustMention Optional cashtag/handle the post has to mention to
 *        count, so unrelated posts do not earn campaign rewards.
 */
export async function fetchCampaignEngagement(
  username: string,
  joinedAtMs: number,
  mustMention?: string
): Promise<Engagement> {
  const apiKey = process.env.TWITTERAPI_IO_API_KEY;
  if (!apiKey) {
    throw new XEngagementError("twitterapi.io is not configured.", "not_configured");
  }

  const url = new URL(TWEETS_URL);
  url.searchParams.set("userName", username.replace(/^@/, ""));

  const response = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new XEngagementError(
      `twitterapi.io returned ${response.status}`,
      "request_failed"
    );
  }

  const payload = (await response.json()) as {
    status?: string;
    data?: { tweets?: RawTweet[] } | RawTweet[] | null;
  };

  // The API has returned both a bare array and a { tweets: [...] } wrapper
  // depending on endpoint/version, so accept either rather than trusting one.
  const raw = payload?.data;
  const tweets: RawTweet[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.tweets)
      ? raw.tweets
      : [];

  const needle = mustMention?.toLowerCase().replace(/^[$@]/, "");

  const totals: Engagement = {
    views: 0,
    likes: 0,
    comments: 0,
    reposts: 0,
    postCount: 0,
  };

  for (const tweet of tweets) {
    if (isReply(tweet)) continue;

    const ts = tweetTimestamp(tweet);
    if (ts === null || ts <= joinedAtMs) continue;

    if (needle) {
      const text = (tweet.text ?? "").toLowerCase();
      if (!text.includes(`$${needle}`) && !text.includes(`#${needle}`) && !text.includes(needle)) {
        continue;
      }
    }

    totals.views += num(tweet.viewCount, tweet.view_count);
    totals.likes += num(tweet.likeCount, tweet.like_count);
    totals.comments += num(tweet.replyCount, tweet.reply_count);
    // Reposts count both plain retweets and quote-tweets of this post: both
    // are someone putting it on their own timeline.
    totals.reposts +=
      num(tweet.retweetCount, tweet.retweet_count) + num(tweet.quoteCount, tweet.quote_count);
    totals.postCount += 1;
  }

  return totals;
}
