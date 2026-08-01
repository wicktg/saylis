import { arbitrumSepolia } from "wagmi/chains";

/** Chain this entire app targets — no other network is supported. */
export const TARGET_CHAIN = arbitrumSepolia;

/** Arbitrum Sepolia's block explorer, for tx links in notifications etc. */
export const BLOCK_EXPLORER_TX_URL = "https://sepolia.arbiscan.io/tx/";

/**
 * Already-deployed, protocol-wide ProtocolTreasury on Arbitrum Sepolia.
 * Every curve the frontend deploys routes its protocol fee share here.
 */
export const PROTOCOL_TREASURY_ADDRESS =
  "0x1B0B17721ed646FBA63421C898246D678A6fC5C9" as const;

/** Token decimals — matches every contract deployed by this app so far. */
export const TOKEN_DECIMALS = 18;

/** Default fixed total supply for newly-launched tokens: 1,000,000,000. */
export const DEFAULT_TOTAL_SUPPLY = 1_000_000_000n;

/**
 * Standard 800M/200M split: BondingCurve holds back
 * `LIQUIDITY_RESERVE_BPS` (20%) of total supply, untouched, for a future
 * DEX-liquidity migration — only the remaining 80% (800,000,000 of a 1B
 * supply) is ever sellable on the curve itself. This is enforced on-chain
 * by the contract, not by the frontend; exposed here only for UI display.
 */
export const DEFAULT_SELLABLE_SUPPLY = 800_000_000n;

/**
 * Virtual liquidity seeded into every new curve (whole ETH / whole tokens).
 *
 * `virtualTokenReserve` is set to roughly 4/3 of the 800M sellable supply
 * (1,066,666,667 ≈ 800,000,000 * 4/3), and `virtualEthReserve` is chosen so
 * the 4.2 ETH graduation threshold (DEFAULT_GRADUATION_THRESHOLD_WEI) is
 * reached comfortably BEFORE the 800M sellable pool is fully depleted —
 * landing graduation exactly at full depletion would race "insufficient
 * token liquidity" against the threshold check. At these values, the
 * constant-product invariant (k = ethReserve * tokenReserve, conserved
 * exactly across every trade) puts graduation at ~768.6M tokens sold
 * (~96.1% of the 800M sellable pool), leaving ~31.4M tokens still sellable
 * as headroom, plus the full untouched 200M DEX reserve. See
 * contracts/test/BondingCurve.t.sol:test_Graduation_ReachableWithProductionDefaults
 * for the on-chain-verified numbers this is based on.
 */
export const DEFAULT_VIRTUAL_ETH_RESERVE = 6n; // 6 ETH
export const DEFAULT_VIRTUAL_TOKEN_RESERVE = 1_066_666_667n;

/** Anti-snipe delay applied to every new curve. */
export const DEFAULT_DELAY_BLOCKS = 1n;

/**
 * USD price of 1 ETH used ONCE at curve construction to convert the fixed
 * $10,000,000 volume cap into a wei threshold. Not a live oracle.
 */
export const DEFAULT_ETH_USD_PRICE_WHOLE = 3_000n;

/** Fixed graduation threshold: 4.2 ETH. */
export const DEFAULT_GRADUATION_THRESHOLD_WEI = 4_200_000_000_000_000_000n; // 4.2 ether

/**
 * Already-deployed, protocol-wide GraduationMigrator on Arbitrum Sepolia —
 * the only address ever authorized to pull a graduated curve's remaining
 * real ETH reserve + reserved liquidity tokens (see BondingCurve.sol's
 * `withdrawForMigration`). Every curve the frontend deploys points at
 * this same migrator; it seeds a full-range Uniswap V3 pool and burns the
 * resulting LP position permanently.
 */
/// !! MUST BE REDEPLOYED AND UPDATED BEFORE THE NEXT LAUNCH !!
/// The migrator's constructor gained a `swapRouter` parameter, and it now
/// deploys a TokenFeeCollector and calls `setAmmPair` on the token at
/// graduation. This address still points at the PREVIOUS migrator build.
///
/// It is also the `pairSetter` baked into every token deployed from here,
/// and that is immutable per token — so any token launched against a stale
/// address can never have its post-graduation tax armed.
export const GRADUATION_MIGRATOR_ADDRESS =
  "0x98d1f17E7D52353E71De8578F3aA299175940d9b" as const;

/**
 * Arbitrum Sepolia's real Chainlink-style ETH/USD price feed (verified
 * on-chain: `description()` returns "ETH/USD", `decimals()` returns 8).
 * Used ONLY to gate BondingCurve's whale sell tax live — see that
 * contract's "SELL TAX" NatSpec. Required by every curve deploy
 * regardless of whether this launch's sell tax is 0; the feed is simply
 * never read on-chain when the rate is zero.
 */
export const ETH_USD_PRICE_FEED_ADDRESS =
  "0x2d3bBa5e0A9Fd8EAa45Dcf71A2389b7C12005b1f" as const;

/**
 * Upper bound on the creator-configurable whale sell tax, in basis
 * points (300 = 3%) — mirrors BondingCurve's `MAX_SELL_TAX_BPS` exactly,
 * so the Create Token modal's slider can never submit a value the
 * contract would reject.
 */
export const MAX_SELL_TAX_BPS = 300n;

/**
 * Canonical Uniswap V3 deployment on Arbitrum Sepolia, plus the fee tier
 * GraduationMigrator seeds pools at (must match its `UNISWAP_V3_POOL_FEE`).
 *
 * Needed on the client so the token page can locate a graduated token's
 * pool and keep reading trades from it — after migration the curve stops
 * emitting Buy/Sell entirely and all activity moves to the pool's `Swap`.
 */
export const UNISWAP_V3_FACTORY_ADDRESS =
  "0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e" as const;

export const WETH9_ADDRESS = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" as const;

export const UNISWAP_V3_POOL_FEE = 3000;

/**
 * Already-deployed, protocol-wide ReferralVault on Arbitrum Sepolia. Every
 * curve the frontend deploys points at this same vault — see
 * BondingCurve.sol's "REFERRALS" NatSpec. A referrer's earnings unify
 * across every creator they've ever referred and every token those
 * creators launch, regardless of which curve the fee came from.
 *
 * Deployed 2026-08-01. No admin, no owner, nothing to configure.
 */
export const REFERRAL_VAULT_ADDRESS =
  "0x9988a43C1Bb2fdFA5e9baFBbD7CDa03e7e62914B" as const;

/**
 * Upper bound on the creator-configurable InfoFi allocation, in basis
 * points (500 = 5%) — mirrors BondingCurve's `MAX_INFOFI_BPS`, so the
 * Create Token slider can never submit a value the contract rejects.
 */
export const MAX_INFOFI_BPS = 500n;

/**
 * The protocol-wide `InfoFiCampaign` singleton every launch's campaign pool
 * is transferred to at construction. Only consulted when a launch sets a
 * non-zero allocation — a plain 0% launch never touches it.
 *
 * Deployed on Arbitrum Sepolia 2026-07-31, configured with:
 *   graduationOnly     = TRUE         (testing mode, see below)
 *   mcapThresholdUsd18 = 120_000e18   ($120k, currently unused)
 *   sustainedDuration  = 86_400       (24 hours, currently unused)
 *   CAMPAIGN_WINDOW    = 7 days       (constant)
 *   CLAIM_WINDOW       = 30 days      (constant)
 *   ABANDON_PERIOD     = 365 days     (constant)
 *
 * !! TESTING MODE: `graduationOnly` IS TRUE !!
 * A curve-backed launch becomes campaign-eligible the moment it GRADUATES.
 * The $120k sustained market-cap rule is fully implemented and tested
 * underneath but is not consulted while this flag is set. Switching to the
 * USD rule is a redeploy with `INFOFI_GRADUATION_ONLY=false`, not a rewrite.
 *
 * Redeployed 2026-07-31 (two-path finalization): `openCampaign` is now
 * team-only for every path — the earlier owner-self-open branch for a true
 * external pool was removed, so admin review is the one human gate
 * everywhere. `registerExternalPool` gained a `curve` parameter: passing
 * the token's real deployed `BondingCurve` (verified via `curve.token()`)
 * makes a post-launch "buy + lock" pool (Path B) earn eligibility exactly
 * like a mint-time allocation (Path A) — `graduationOnly` applies to both.
 * Leaving `curve` as the zero address keeps the original true-external
 * behavior (`markEligible`, team-only, no automatic eligibility).
 *
 * Redeployed 2026-08-01 (team wallet): `team` set to
 * 0xcE1c491084752f90b3B4e235a199bB8cD687a454 — the project's official
 * wallet. Nobody but this address has ever held `team` since; it is
 * immutable on this deployment. As with every prior deployment it can
 * open campaigns and publish payout roots but can NEVER take a pool
 * (there is no sweep path in the contract).
 *
 * Redeployed again 2026-08-01 (claim window): `CLAIM_WINDOW` shortened
 * from 30 days to 7 days (immutable constant, contracts/src/
 * InfoFiCampaign.sol) — a campaign's full lifecycle is now a 7-day run
 * followed by a 7-day claim period, then whatever's unclaimed becomes
 * burnable. This orphaned the previous deployment's live CAT campaign
 * (no sweep/migration path exists for this contract) — accepted as a
 * testnet-only loss.
 */
export const INFOFI_CAMPAIGN_ADDRESS =
  "0x8C8181aDFd56E7B0C8dc023aE89110E26eA79ac4" as const;

/**
 * The wallet allowed to open campaigns and publish payout roots — mirrors
 * `InfoFiCampaign.team()` exactly (it is public on-chain, so exposing it
 * client-side leaks nothing). Used to gate the admin dashboard's UI (hide
 * the page from anyone else); every mutating action is ALSO re-checked
 * server-side against the same address before it does anything.
 *
 * This is the project's official wallet. Its private key is not, and must
 * never be, held anywhere in this codebase or its server environment — see
 * the admin approve flow in app/admin/page.tsx, which has the CONNECTED
 * wallet sign `openCampaign` directly in the browser rather than a server
 * holding a key on this address's behalf.
 */
export const INFOFI_TEAM_ADDRESS =
  "0xcE1c491084752f90b3B4e235a199bB8cD687a454" as const;

/**
 * Virtual token reserve for a launch reserving `infoFiBps` of supply.
 *
 * This is NOT a constant, and that matters. Graduation happens at a fixed
 * ETH raise, which under the constant-product invariant corresponds to a
 * fixed FRACTION of the curve's initial token reserve — so holding
 * `virtualTokenReserve` fixed while shrinking the sellable supply eats the
 * safety margin between "tokens graduation needs" and "tokens that exist to
 * sell". At a 5% allocation that margin collapses from ~31.4M tokens (3.9%
 * of sellable) to ~2.0M (0.27%), which is close enough to the edge that a
 * curve could start reverting with "insufficient token liquidity" before it
 * ever graduates.
 *
 * Keeping the reserve at 4/3 of the SELLABLE supply — the same ratio the
 * original 1,066,666,667 / 800,000,000 defaults encode — pins graduation at
 * ~96.1% of sellable for every allocation from 0% to 5%, preserving the
 * headroom exactly as designed. Verified on-chain in
 * contracts/test/InfoFiCampaign.t.sol:test_Graduation_ReachableAtEveryAllocation.
 */
export function virtualTokenReserveFor(infoFiBps: number): bigint {
  const BPS = 10_000n;
  const LIQUIDITY_RESERVE_BPS = 2_000n;
  const sellable =
    (DEFAULT_TOTAL_SUPPLY * (BPS - LIQUIDITY_RESERVE_BPS - BigInt(infoFiBps))) / BPS;
  return (sellable * 4n) / 3n;
}
