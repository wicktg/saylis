/**
 * Fixtures for looking at UI that is hard to reach with real data.
 *
 * A Path A campaign needs a token minted with reserved supply; a Path B one
 * needs the team to issue an invite; a live one needs both plus an approval.
 * Producing all three on a local chain to check a layout is a lot of
 * ceremony for a design question, so these stand in.
 *
 * WHY THIS CANNOT REACH PRODUCTION
 *
 * `NODE_ENV` is set by the framework, not by us: `next dev` sets
 * "development" and `next build` / `next start` set "production". So the
 * guard below is not a flag anyone can flip by mistake in a deploy: the
 * only way to serve these is to be running a dev server.
 *
 * The bundler inlines `DEV_MOCKS` to `false` in a production build, so
 * every call site becomes `if (false)` and is unreachable. The fixture
 * strings themselves DO still appear in the server bundle, since the route
 * modules are not tree-shaken that aggressively. That is dead weight, not
 * an exposure: verified against a real `next start`, where both endpoints
 * return empty rather than the fixtures. Do not put anything secret here
 * on the assumption it gets stripped.
 *
 * Mocks are APPENDED to whatever the real query returned rather than
 * replacing it, so real local data still shows up beside them and nothing
 * here can mask a genuine bug in the query itself.
 */
export const DEV_MOCKS = process.env.NODE_ENV === "development";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/** 18 decimals, as a base-unit string, the way the API returns amounts. */
const tokens = (whole: number) => (BigInt(whole) * 10n ** 18n).toString();
/** ETH as wei, for referral earnings. */
const eth = (amount: string) => {
  const [w, f = ""] = amount.split(".");
  return (BigInt(w) * 10n ** 18n + BigInt(f.padEnd(18, "0").slice(0, 18))).toString();
};

/**
 * The two owner-only campaigns, one per entry path.
 *
 * Returned for whatever wallet asks, which is the point: the real route is
 * scoped by `owner_wallet`, and matching that in a fixture would mean
 * hardcoding somebody's address.
 */
export const MOCK_MY_CAMPAIGNS = [
  {
    // ---- Path A: supply reserved at mint, now needs its details + an
    // approval request. `eligible` with no title is the state that renders
    // the "add details" branch of CampaignCard.
    origin: "launched" as const,
    tokenAddress: "0xA11ce0000000000000000000000000000000A00A",
    curveAddress: "0xA11ce0000000000000000000000000000000C00C",
    name: "Harbour",
    ticker: "HRBR",
    imageUrl: null,
    state: "eligible" as const,
    allocationRaw: tokens(35_000_000),
    title: null,
    description: null,
    winnerCount: null,
    approvalStatus: null,
    approvalRequestedAt: null,
    approvalNote: null,
    openedAt: null,
    windowEndsAt: null,
    claimDeadlineAt: null,
    merkleRoot: null,
    lastMcapUsd18: (42_800n * 10n ** 18n).toString(),
    invitedAt: null,
    reportedAmountRaw: null,
  },
  {
    // ---- Path B: the team has issued the invite; nothing has moved yet,
    // so this renders the send-supply branch.
    origin: "post_launch" as const,
    tokenAddress: "0xB0b0000000000000000000000000000000000B0B",
    curveAddress: "0xB0b0000000000000000000000000000000000C0C",
    name: "Lantern",
    ticker: "LNTN",
    imageUrl: null,
    state: "invited" as const,
    allocationRaw: tokens(18_000_000),
    title: null,
    description: null,
    winnerCount: null,
    approvalStatus: null,
    approvalRequestedAt: null,
    approvalNote: null,
    openedAt: null,
    windowEndsAt: null,
    claimDeadlineAt: null,
    merkleRoot: null,
    lastMcapUsd18: (128_400n * 10n ** 18n).toString(),
    invitedAt: ago(2),
    reportedAmountRaw: null,
  },
];

/** The live one: public, joinable, mid-window. */
export const MOCK_PUBLIC_CAMPAIGNS = [
  {
    tokenAddress: "0xC0ffee00000000000000000000000000000C0FFE",
    name: "Meridian",
    ticker: "MRDN",
    imageUrl: null,
    state: "open" as const,
    allocationRaw: tokens(50_000_000),
    title: "Chart the Meridian",
    description:
      "Post your best thread, chart or clip about MRDN. The top voices by mindshare split the pool when the window closes.",
    winnerCount: 25,
    openedAt: ago(4),
    windowEndsAt: ahead(3),
  },
];

/** Five referred wallets, deliberately uneven: two big earners, a mid, and
 *  two that have barely traded, so the list is not a uniform column. */
export const MOCK_REFERRALS = {
  code: "pod-chatter-dev",
  currentBalanceRaw: eth("0.4182"),
  lifetimeTotalRaw: eth("2.7405"),
  referred: [
    {
      walletAddress: "0x8F2c41A9b7E30cD5a1B4e6F80c93D27aE5b16C04",
      joinedAt: ago(41),
      earningsRaw: eth("1.2840"),
    },
    {
      walletAddress: "0x3aD9f70B2c48E15dA6b09C7f1E24B8d5039Ac6E1",
      joinedAt: ago(28),
      earningsRaw: eth("0.9127"),
    },
    {
      walletAddress: "0xE71b06C4d5F92a38B0cE47a1D6928fB3c05471Aa",
      joinedAt: ago(12),
      earningsRaw: eth("0.4903"),
    },
    {
      walletAddress: "0x24Fa9c108B7e6D350fA1c9B47E082d6135Ab7F92",
      joinedAt: ago(5),
      earningsRaw: eth("0.0482"),
    },
    {
      walletAddress: "0x9c05B3e18Af742D06b1E5c930aF87264Db3105fE",
      joinedAt: ago(1),
      earningsRaw: eth("0.0053"),
    },
  ],
  historyAvailable: true,
};

/** The mock live campaign's own address, shared by every fixture below so
 *  the card, the detail page and the API all agree on one token. */
export const MOCK_OPEN_TOKEN = "0xC0ffee00000000000000000000000000000C0FFE";

/** Stands in for the Supabase `tokens` row, which the detail page reads
 *  directly rather than through an API route. */
export const MOCK_TOKEN_RECORD = {
  id: "dev-mock-mrdn",
  contract_address: MOCK_OPEN_TOKEN,
  curve_address: "0xC0ffee00000000000000000000000000000CU2E",
  creator_wallet_address: "0x5Dd1b0aE21A5F3c8e947B2Ca6d09b7351cF4e820",
  name: "Meridian",
  ticker: "MRDN",
  description:
    "A community-run index of everything worth watching on-chain this week.",
  socials: {},
  image_url: null,
  created_at: ago(9),
};

/**
 * Eight participants, scored.
 *
 * Mindshare is a percentage share of total attention, so these are built to
 * sum to ~100 and to taper the way a real board does: a runaway leader, a
 * close second, then a long flat tail. A set of evenly spaced numbers would
 * make the ranking look decorative and would hide whether the bar widths
 * and the tabular figures actually cope with a spread.
 */
export const MOCK_LEADERBOARD = [
  {
    rank: 1,
    walletAddress: "0x7B4a9E2c05D18fA36bC7e401d9A5f8236B0cE914",
    xUsername: "chainpilot",
    xAvatarUrl: null,
    mindshare: 24.86,
  },
  {
    rank: 2,
    walletAddress: "0x1f83D0a7cE5B9264d70Af31c8B05e6924Ad7130B",
    xUsername: "0xmeridiem",
    xAvatarUrl: null,
    mindshare: 19.42,
  },
  {
    rank: 3,
    walletAddress: "0xC92e5B140fA7d38e0b6C1a9F250347Db8e05Ac61",
    xUsername: "saltwater_eth",
    xAvatarUrl: null,
    mindshare: 14.05,
  },
  {
    rank: 4,
    walletAddress: "0x460bF19a7D2c85E03f1B6dA9740C285e3bF01927",
    xUsername: "novaquant",
    xAvatarUrl: null,
    mindshare: 11.73,
  },
  {
    rank: 5,
    walletAddress: "0xAe37C05b1D8942f6e0B35c7A4109fD26845b0E73",
    xUsername: "deepbluecap",
    xAvatarUrl: null,
    mindshare: 9.18,
  },
  {
    rank: 6,
    walletAddress: "0x38D1a604F7bC29e5081B3fA67d94c0E25a71B385",
    xUsername: "tidal_research",
    xAvatarUrl: null,
    mindshare: 7.64,
  },
  {
    rank: 7,
    walletAddress: "0xF05c72Ba91e3D847a065C1b98Ef2340D71aC5628",
    xUsername: "harbourmaster",
    xAvatarUrl: null,
    mindshare: 6.91,
  },
  {
    rank: 8,
    walletAddress: "0x2b9E407aC61D538f0A72e5B14c8309Fd6a25E740",
    xUsername: "plankton_dao",
    xAvatarUrl: null,
    mindshare: 6.21,
  },
];

/** The detail page's payload: campaign, board, and a viewer who has not
 *  joined, so the Join panel renders its actionable state. */
export const MOCK_CAMPAIGN_DETAIL = {
  campaign: {
    tokenAddress: MOCK_OPEN_TOKEN,
    curveAddress: MOCK_TOKEN_RECORD.curve_address,
    ownerWallet: MOCK_TOKEN_RECORD.creator_wallet_address,
    state: "open" as const,
    allocationRaw: tokens(50_000_000),
    eligibleAt: ago(6),
    openedAt: ago(4),
    windowEndsAt: ahead(3),
    claimDeadlineAt: ahead(17),
    merkleRoot: null,
    lastMcapUsd18: (312_500n * 10n ** 18n).toString(),
    lastMcapAt: ago(0.02),
  },
  leaderboard: MOCK_LEADERBOARD,
  viewer: { joined: false, xUsername: null, allocation: null },
};
