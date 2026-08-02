import { robinhood } from "wagmi/chains";

/**
 * Chain this entire app targets — no other network is supported.
 *
 * MAINNET, deployed 2026-08-02. Robinhood Chain (Arbitrum Orbit L2, chain id
 * 4663) — real ETH, real user funds from this point on. Was Arbitrum
 * Sepolia testnet for the entire session up to this deploy.
 */
export const TARGET_CHAIN = robinhood;

/** Robinhood Chain's block explorer (Blockscout), for tx links etc. */
export const BLOCK_EXPLORER_TX_URL = "https://robinhoodchain.blockscout.com/tx/";

/**
 * Protocol-wide ProtocolTreasury on Robinhood Chain mainnet. Every curve
 * the frontend deploys routes its protocol fee share here.
 *
 * Deployed 2026-08-02, tx-verified: `owner()` reads back the multisig
 * (`TREASURY_OWNER_ADDRESS`) exactly as passed to the constructor.
 * `owner` is immutable — rotating it means deploying a NEW ProtocolTreasury
 * and re-pointing future curves at it; existing curves keep paying this one
 * forever.
 */
export const PROTOCOL_TREASURY_ADDRESS =
  "0x8CbB10B3DF639a51E128A41148719Bfb9f3d4103" as const;

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
 * Already-deployed, protocol-wide GraduationMigrator —
 * the only address ever authorized to pull a graduated curve's remaining
 * real ETH reserve + reserved liquidity tokens (see BondingCurve.sol's
 * `withdrawForMigration`). Every curve the frontend deploys points at
 * this same migrator; it seeds a full-range Uniswap V3 pool and burns the
 * resulting LP position permanently.
 */
/// MAINNET, deployed 2026-08-02 on Robinhood Chain from current source —
/// carries every security-audit fix (see audit/AUDIT_REPORT.md): the H-02
/// pool-price tolerance check with `alignPoolPrice` as its permissionless
/// escape hatch, the leftover sweep, and full TokenFeeCollector wiring
/// (`setAmmPair` correctly arms the post-graduation whale tax on every
/// token launched against this address).
///
/// Constructed with Robinhood's real Uniswap V3 deployment: factory
/// `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`, position manager
/// `0x73991a25c818bf1f1128deaab1492d45638de0d3`, SwapRouter02
/// `0xcaf681a66d020601342297493863e78c959e5cb2`, pool fee 3000 (0.3%) —
/// all verified to have real deployed bytecode on-chain before this
/// contract was constructed against them.
///
/// !! Redeploying this again means updating this constant BEFORE the next
/// launch — it is baked into each token as `pairSetter` and cannot be
/// changed once minted. !!
export const GRADUATION_MIGRATOR_ADDRESS =
  "0xBe8e28EA67015a7CF82173B617BF3Dd6ec008e9D" as const;

/**
 * Robinhood Chain's real Chainlink ETH/USD price feed — verified on-chain
 * before use: `description()` returns exactly "ETH / USD", `decimals()`
 * returns 8, `latestAnswer()` returned a live, plausible price at deploy
 * time. Used ONLY to gate BondingCurve's whale sell tax live — see that
 * contract's "SELL TAX" NatSpec. Required by every curve deploy
 * regardless of whether this launch's sell tax is 0; the feed is simply
 * never read on-chain when the rate is zero.
 */
export const ETH_USD_PRICE_FEED_ADDRESS =
  "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as const;

/**
 * Upper bound on the creator-configurable whale sell tax, in basis
 * points (300 = 3%) — mirrors BondingCurve's `MAX_SELL_TAX_BPS` exactly,
 * so the Create Token modal's slider can never submit a value the
 * contract would reject.
 */
export const MAX_SELL_TAX_BPS = 300n;

/**
 * Real Uniswap V3 deployment on Robinhood Chain mainnet, plus the fee tier
 * GraduationMigrator seeds pools at (must match its `UNISWAP_V3_POOL_FEE`).
 * Each address was checked for real deployed bytecode against chain 4663
 * before being used in any deploy.
 *
 * Needed on the client so the token page can locate a graduated token's
 * pool and keep reading trades from it — after migration the curve stops
 * emitting Buy/Sell entirely and all activity moves to the pool's `Swap`.
 */
export const UNISWAP_V3_FACTORY_ADDRESS =
  "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;

/**
 * Robinhood Chain's real WETH9 — confirmed via `name()`/`symbol()` both
 * returning "WETH" before use.
 */
export const WETH9_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

export const UNISWAP_V3_POOL_FEE = 3000;

/**
 * Protocol-wide ReferralVault on Robinhood Chain mainnet. Every curve the
 * frontend deploys points at this same vault — see BondingCurve.sol's
 * "REFERRALS" NatSpec. A referrer's earnings unify across every creator
 * they've ever referred and every token those creators launch, regardless
 * of which curve the fee came from.
 *
 * Deployed 2026-08-02. No admin, no owner, nothing to configure.
 */
export const REFERRAL_VAULT_ADDRESS =
  "0xdc10c0CEC697Cd730f1b071348D92fF20434E81F" as const;

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
 * MAINNET, deployed on Robinhood Chain 2026-08-02, configured with:
 *   graduationOnly     = FALSE        (the real rule, live from day one)
 *   mcapThresholdUsd18 = 120_000e18   ($120k)
 *   sustainedDuration  = 1 second     (effectively "sustained" is a formality —
 *                                      the contract requires > 0, so this is
 *                                      the minimum: eligibility follows the
 *                                      $120k crossing essentially immediately
 *                                      rather than requiring a 24h hold)
 *   CAMPAIGN_WINDOW    = 7 days       (constant)
 *   CLAIM_WINDOW       = 7 days       (constant)
 *   ABANDON_PERIOD     = 365 days     (constant)
 *
 * Every constructor value verified by reading it back on-chain
 * (`team()`, `mcapThresholdUsd18()`, `sustainedDuration()`,
 * `graduationOnly()`, `ethUsdPriceFeed()`) immediately after deploy, before
 * this address was wired into the app.
 */
export const INFOFI_CAMPAIGN_ADDRESS =
  "0x5F6517e825154FA30d61D10E260E68Ace685f3Fa" as const;

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
  "0xc0Ed3DAeaCb4c052753C6BF13DeDb940401C3A4C" as const;

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
