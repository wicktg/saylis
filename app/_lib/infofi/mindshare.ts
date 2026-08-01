/**
 * Mindshare scoring for InfoFi campaigns.
 *
 * Pure functions only — no network, no database — so the weighting and
 * normalisation can be unit-tested and reasoned about independently of the
 * daily job that feeds them.
 */

/** Engagement totals for one participant over a campaign. */
export type Engagement = {
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  postCount: number;
};

export type ParticipantInput = {
  walletAddress: string;
  xUsername: string;
  engagement: Engagement;
};

export type ScoredParticipant = {
  walletAddress: string;
  xUsername: string;
  engagement: Engagement;
  rawScore: number;
  /** Share of the fixed 100-point pool, rounded to 4dp. */
  mindshare: number;
  /** 1-based, highest mindshare first. */
  rank: number;
};

/**
 * Engagement weights.
 *
 * Ordered by how much effort each action costs the person taking it, which
 * is the same as how hard it is to fake:
 *
 *   comments (5) — someone wrote something; costs the most, easiest to spot
 *   reposts  (4) — puts the post on their own timeline, reputational cost
 *   likes    (3) — one tap, but still a deliberate account action
 *   views    (1) — almost entirely passive and the easiest metric to inflate
 *
 * Views are kept rather than dropped because reach genuinely matters, but
 * weighted so a viral-but-ignored post cannot outrank a smaller post that
 * actually started conversations.
 */
export const ENGAGEMENT_WEIGHTS = {
  views: 1,
  likes: 3,
  comments: 5,
  reposts: 4,
} as const;

/** Weighted engagement total for one participant. */
export function rawScore(engagement: Engagement): number {
  return (
    engagement.views * ENGAGEMENT_WEIGHTS.views +
    engagement.likes * ENGAGEMENT_WEIGHTS.likes +
    engagement.comments * ENGAGEMENT_WEIGHTS.comments +
    engagement.reposts * ENGAGEMENT_WEIGHTS.reposts
  );
}

/**
 * Normalises raw scores into a fixed 100-point pool and ranks them.
 *
 * Mindshare is deliberately relative, not absolute: it is a share of the
 * collective attention a campaign generated, so the leaderboard sums to 100
 * whether ten people joined or ten thousand, and whether the campaign was
 * enormous or quiet. That is what makes it fair to compare across campaigns
 * and what makes it directly usable as a payout weight.
 *
 * Ties are broken by username so the ordering is deterministic — a rank that
 * reshuffled between two runs over equal scores would produce a different
 * merkle root for identical inputs.
 */
export function computeMindshare(participants: ParticipantInput[]): ScoredParticipant[] {
  const withRaw = participants.map((p) => ({
    ...p,
    rawScore: rawScore(p.engagement),
  }));

  const total = withRaw.reduce((sum, p) => sum + p.rawScore, 0);

  const scored = withRaw.map((p) => ({
    walletAddress: p.walletAddress,
    xUsername: p.xUsername,
    engagement: p.engagement,
    rawScore: p.rawScore,
    // Zero total means nobody posted anything yet. Everyone sits at 0
    // rather than dividing by zero or splitting 100 between people who did
    // nothing.
    mindshare: total === 0 ? 0 : round4((100 * p.rawScore) / total),
  }));

  scored.sort(
    (a, b) => b.rawScore - a.rawScore || a.xUsername.localeCompare(b.xUsername)
  );

  return scored.map((p, i) => ({ ...p, rank: i + 1 }));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Converts a final leaderboard into integer token amounts summing to at
 * most `poolRaw`.
 *
 * Uses largest-remainder rather than naive rounding: allocate each
 * participant the floor of their exact share, then hand the leftover base
 * units out one at a time to whoever was rounded down hardest. Naive
 * rounding would either overshoot the pool (making the last claim revert
 * against the contract's cap) or silently strand dust that then burns.
 *
 * Anyone with a zero score is dropped entirely rather than carried as a
 * zero-amount leaf, since a leaf worth nothing only costs gas to prove.
 */
export function allocatePool(
  leaderboard: ScoredParticipant[],
  poolRaw: bigint
): { walletAddress: string; xUsername: string; mindshare: number; amountRaw: bigint }[] {
  const eligible = leaderboard.filter((p) => p.rawScore > 0);
  if (eligible.length === 0 || poolRaw === 0n) return [];

  const totalRaw = eligible.reduce((sum, p) => sum + BigInt(p.rawScore), 0n);

  const base = eligible.map((p) => {
    const exact = (poolRaw * BigInt(p.rawScore)) / totalRaw;
    const remainder = (poolRaw * BigInt(p.rawScore)) % totalRaw;
    return { p, amountRaw: exact, remainder };
  });

  let distributed = base.reduce((sum, b) => sum + b.amountRaw, 0n);
  let leftover = poolRaw - distributed;

  // Largest remainder first; ties by username to stay deterministic.
  const byRemainder = [...base].sort((a, b) => {
    if (a.remainder === b.remainder) {
      return a.p.xUsername.localeCompare(b.p.xUsername);
    }
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (let i = 0; leftover > 0n && i < byRemainder.length; i++) {
    byRemainder[i].amountRaw += 1n;
    leftover -= 1n;
  }

  return base.map((b) => ({
    walletAddress: b.p.walletAddress,
    xUsername: b.p.xUsername,
    mindshare: b.p.mindshare,
    amountRaw: b.amountRaw,
  }));
}

/**
 * Pairs today's leaderboard with yesterday's so the UI can render the
 * movement, e.g. "14.2 mindshare, up 3.1".
 *
 * A participant absent from yesterday is `null` rather than `0` — "joined
 * today" and "scored zero yesterday" are different facts and the UI should
 * be able to tell them apart.
 */
export function withDailyDelta(
  today: ScoredParticipant[],
  yesterday: { walletAddress: string; mindshare: number; rank: number }[]
): (ScoredParticipant & {
  mindshareDelta: number | null;
  rankDelta: number | null;
})[] {
  const prev = new Map(yesterday.map((p) => [p.walletAddress.toLowerCase(), p]));

  return today.map((p) => {
    const before = prev.get(p.walletAddress.toLowerCase());
    return {
      ...p,
      mindshareDelta: before ? round4(p.mindshare - before.mindshare) : null,
      // Inverted on purpose: moving from rank 5 to rank 2 is +3, an
      // improvement, even though the number itself went down.
      rankDelta: before ? before.rank - p.rank : null,
    };
  });
}
