// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from
    "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IInfoFiCampaign} from "./interfaces/IInfoFiCampaign.sol";
import {IReferralVault} from "./interfaces/IReferralVault.sol";

/// @title BondingCurve
/// @notice A virtual-reserve constant-product (x*y=k) bonding curve for a
/// single ERC-20 token, priced against native ETH, with a 1% trade fee
/// split between the token's creator and the protocol treasury.
///
/// @dev SCOPE: pricing mechanics + fee routing only. Still no wallet caps,
/// no anti-snipe / launch-delay logic, and no "graduation" — those remain
/// for a later layer. See `docs/BondingCurve-pricing.md`-equivalent NatSpec
/// below for the pricing model itself; this revision's NatSpec focuses on
/// the fee layer added on top of it.
///
/// FEE MECHANICS
/// --------------
/// Every trade pays a flat `FEE_BPS` (1%) fee, taken from whichever side of
/// the trade is denominated in ETH:
///
///   - `buy`: the fee is taken out of the ETH the buyer sends IN, before
///     the constant-product formula runs. Only the post-fee "net" ETH
///     amount is what actually enters the curve's real reserve and gets
///     priced into tokens. This keeps the invariant simple: the curve
///     itself never has to reason about fees, it only ever sees net
///     amounts on both sides.
///   - `sell`: the curve formula runs first on the FULL token amount (there
///     is no "ETH side" to deduct from before that math runs — the input
///     is tokens), producing a gross ETH amount; the fee is then taken out
///     of that gross ETH OUTPUT before it's paid to the seller. The gross
///     amount is what leaves `realEthReserve` (matching what the curve
///     formula actually priced), while the fee portion is diverted to the
///     fee-accounting balances instead of being paid out.
///
/// In both cases the *curve's own reserves* only ever move by the net (fee
/// adjusted) amount that isn't fee — fees are carved out to a separate pair
/// of accumulator variables and never touch `realEthReserve`.
///
/// FEE SPLIT — FLAT
/// -----------------
/// Each 1% fee is split between the token's `creator` and the immutable
/// `protocolTreasury`, 75% / 25%, for the life of the curve. There is no
/// escalation: `CREATOR_SHARE_BPS` is a constant, and the split is
/// identical on the first trade and the last. An earlier revision ramped
/// it 75% -> 85% against a $10,000,000 volume cap that was unreachable by
/// construction — see `CREATOR_SHARE_BPS` for why it was removed. This
/// rewards tokens that sustain real trading activity without needing any
/// on-chain oracle after deployment: the USD target is converted to an ETH
/// figure ONCE, at deploy time, using whatever price the deployer supplies
/// (e.g. a recent spot price) — baked in as an immutable, exactly like
/// every other configuration knob in this system. No live price feed
/// dependency is introduced (which would add an external-call failure mode
/// and a "whose oracle do we trust" question this contract deliberately
/// avoids).
///
/// The fee split for a given trade is always computed from the cumulative
/// volume BEFORE that trade is added to the running total — i.e. a trade
/// cannot influence its own fee split, only every trade after it. This
/// keeps the math simple and strictly deterministic given the on-chain
/// state at the start of the call.
///
/// `protocolFee` is always computed as `feeAmount - creatorFee` (the
/// remainder), never as an independent percentage calculation. This
/// guarantees `creatorFee + protocolFee == feeAmount` exactly, to the wei,
/// with no rounding dust ever left neither collected nor stuck.
///
/// PULL-PAYMENT FEE WITHDRAWAL
/// -----------------------------
/// Fees are never pushed to `creator` or `protocolTreasury` mid-trade.
/// Instead they accumulate in `creatorFeesOwed` / `protocolFeesOwed`, and
/// are only ever moved out by a later, separate call to
/// `withdrawCreatorFees()` / `withdrawProtocolFees()`. This is deliberate:
/// if fees were pushed directly during `buy`/`sell` and `creator` (an
/// arbitrary, possibly-a-contract address chosen by whoever created the
/// token) or `protocolTreasury` ever reverted on receiving ETH — or simply
/// ran out of gas in a fallback — EVERY SINGLE TRADE on this curve would
/// permanently revert too (a classic "revert-griefing" / denial-of-service
/// vector). Decoupling fee payout from the trade path means a broken or
/// hostile recipient can only ever hurt themselves (their own fees pile up
/// unclaimed), never the trading of the token itself. Both withdrawal
/// functions are intentionally PERMISSIONLESS (any address can call them)
/// but always send to the fixed, immutable `creator` / `protocolTreasury`
/// address regardless of caller — so anyone (the creator, the protocol
/// ops team, a keeper bot) can trigger settlement, but funds can only ever
/// land at the correct destination.
///
/// SUPPLY-INTEGRITY CHECKS — BUY-ONLY
/// -------------------------------------
/// Two additional checks apply to `buy` and ONLY `buy`. Both exist to blunt
/// predictable, mechanical attacks on a freshly-launched token; neither has
/// any legitimate reason to also constrain `sell`:
///
///   1. BLOCK-DELAY ANTI-SNIPE: `buy` reverts with `AntiSnipeDelayActive`
///      while `block.number <= launchBlock + delayBlocks`. `launchBlock` is
///      captured once, at construction. `delayBlocks` is a constructor
///      parameter (e.g. `1`) — configurable per deployment because
///      different launch strategies want different windows, but immutable
///      once set, so it cannot be quietly shortened or waived later. The
///      purpose is narrow: deny the trivial "buy in the same block (or the
///      next few) as deployment" MEV pattern where a bot front-runs every
///      real buyer by sniping supply the instant it exists. It is NOT a
///      trading pause — once the window elapses, `buy` behaves exactly as
///      before, forever, with no admin action required to "unlock" it.
///
///   2. MAX-WALLET CAP: after computing `tokensOut`, `buy` reverts with
///      `MaxWalletExceeded` if the buyer's resulting balance
///      (`token.balanceOf(buyer) + tokensOut`) would exceed
///      `maxWalletTokens` (a fixed 2.5% of total supply, computed once at
///      construction from `token.totalSupply()`). This is a full,
///      all-or-nothing revert — never a partial fill — so a buyer always
///      gets exactly the amount they asked for (down to `minTokensOut`
///      slippage) or nothing at all; the contract never silently changes
///      what a transaction does based on this cap. The purpose is to keep
///      any single wallet from accumulating a supply-dominating position
///      in the earliest, thinnest-liquidity trades, which is when a single
///      buyer doing so does the most damage to fair distribution and to
///      the price the curve can offer everyone after them.
///
/// WHY `sell` IS DELIBERATELY EXEMPT FROM BOTH:
///
///   - Neither check protects against anything a *seller* could do. The
///     anti-snipe delay exists to stop bots from acquiring a
///     disproportionate position before real users get a chance to buy —
///     selling never acquires a position, it only reduces one. Blocking
///     early sells would add friction with no corresponding benefit.
///   - The max-wallet cap exists to bound how much of the supply one
///     wallet can hold. Selling can only ever *decrease* a wallet's
///     balance, i.e. it can only ever move a wallet further from breaching
///     the cap, never closer. There is no scenario where an uncapped sell
///     undermines the property the cap protects.
///   - Most importantly: gating `sell` behind either check would mean real
///     ETH liquidity a trader is owed could become temporarily
///     unwithdrawable — turning a fairness/anti-bot mechanism into an
///     accidental funds-lockup mechanism. A user must always be able to
///     exit their position; this system treats that as non-negotiable
///     (consistent with `withdrawCreatorFees`/`withdrawProtocolFees` never
///     being blockable either, for the same underlying reason: nothing in
///     this contract should ever be able to trap value that's rightfully
///     someone's to move).
///
/// SELLABLE SUPPLY — 80/20 CURVE/RESERVE SPLIT
/// -----------------------------------------------
/// Not every token this contract receives at construction is put up for
/// sale. `LIQUIDITY_RESERVE_BPS` (20%) of `token.totalSupply()` is carved
/// out at construction into `liquidityReserveTokens` and excluded from
/// `realTokenReserve` — it sits in this contract's own token balance,
/// untouched by `buy`/`sell`, and is never priced into the curve. Only the
/// remaining 80% (`realTokenReserve` at construction) is ever sellable
/// here. This is the standard "800M sold / 200M reserved" split on a
/// 1B-supply token, expressed as a ratio so it scales with whatever total
/// supply a given token actually has. The held-back 20% sits untouched
/// until graduation, at which point it — together with the curve's
/// remaining real ETH reserve — is handed off, once, to the immutable
/// `migrator` contract via `withdrawForMigration` (see GRADUATION below).
///
/// SELL TAX — OPTIONAL, CREATOR-ONLY, SELL-ONLY, WHALE-GATED
/// ----------------------------------------------------------------
/// Independent of the 1% trade fee above, each deployment may configure an
/// additional `sellTaxBps` (0-300 bps, i.e. 0%-3%) taken ONLY from `sell`
/// proceeds, computed from the same gross curve-quoted amount the 1% fee
/// itself is computed from. Unlike the 1% fee, 100% of this tax goes to
/// `creator` — none of it is split with `protocolTreasury`. The RATE
/// (`sellTaxBps`) is immutable once set at construction, exactly like
/// every other configuration knob in this system: no admin can introduce,
/// raise, or waive it after deployment. `buy` is never subject to it.
///
/// The tax does NOT apply to every sell, though — it only applies to
/// "whale" sells, where a whale is defined RELATIVE TO THIS CURVE'S
/// CURRENT MARKET CAP, re-evaluated fresh on every single sell (not fixed
/// at launch, and not cached):
///
///   mcap ≤ $150k        → whale threshold = 2.00% of total supply
///   $150k < mcap ≤ $300k  → 1.50%
///   $300k < mcap ≤ $500k  → 1.00%
///   $500k < mcap ≤ $1M    → 0.75%
///   mcap > $1M            → 0.50%
///
/// A seller is only taxed if their OWN token balance, measured
/// immediately before that sell executes, exceeds the threshold implied
/// by the curve's market cap AT THAT MOMENT. Because both the curve's
/// price and the live ETH/USD rate move independently over the token's
/// life, the same wallet can cross in and out of "whale" status entirely
/// on its own, with no code path that fixes it once — this is
/// deliberate, matching the requirement that whale status track the
/// token's real-time market cap rather than a point-in-time snapshot.
///
/// Market cap is computed on-chain, live, as `getPrice() * totalSupply`
/// (in ETH) converted to USD via `ethUsdPriceFeed` — a live Chainlink-
/// style oracle read on every taxable sell. This is a deliberate,
/// narrowly-scoped EXCEPTION to this contract's general "no live oracle"
/// posture: tiered whale gating cannot be done
/// without SOME live USD reference, and Chainlink's push-oracle model is
/// the standard, widely-audited way to get one on-chain. To avoid that
/// dependency ever blocking a seller's ability to exit (a "user must
/// always be able to exit their position" guarantee this contract treats
/// as non-negotiable — see the SUPPLY-INTEGRITY CHECKS section), a
/// failed or stale (`> 1 hour` old) oracle read never reverts `sell` —
/// it silently falls back to the MOST GENEROUS tier (2% threshold, the
/// hardest to exceed), so an oracle outage can only ever reduce how much
/// tax is collected, never block a withdrawal.
///
/// The tax is deliberately kept out of the `FeeCollected` event's
/// `feeAmount`/`creatorFee`/`protocolFee` figures (which continue to
/// describe ONLY the 1% trade fee, preserving
/// `creatorFee + protocolFee == feeAmount` exactly as before) — instead
/// it is credited to `creatorFeesOwed` directly and reported via its own
/// `SellTaxCollected` event, so existing fee-split tooling/assumptions
/// built around `FeeCollected` don't need to account for a second,
/// differently-shaped, conditional deduction.
///
/// REFERRALS — A FIXED SLICE OF THE CREATOR'S OWN FEE SHARE, NEVER THE PROTOCOL'S
/// -----------------------------------------------------------------------------
/// If this curve's `creator` was referred by another wallet (recorded once,
/// permanently, in the protocol-wide `ReferralVault` singleton — see that
/// contract), `REFERRAL_BPS` (5%) of every `creatorFee` credit — the
/// escalating 75%-85% share `_splitFee` computes on the 1% trade fee, for
/// both `buy` and `sell` — is redirected to the referrer's OWN pull-payment
/// balance on `ReferralVault` instead of this curve's `creatorFeesOwed`.
///
/// Scoped deliberately narrowly: ONLY `_splitFee`'s `creatorFee` output is
/// touched. `protocolFee` is never reduced — a referral is a cost the
/// creator's own take absorbs, not something that dilutes the protocol's
/// share. The whale sell tax and the graduation bonus are separate credit
/// paths (see their own NatSpec) and are deliberately left alone too: both
/// are already documented as distinct from the fee-split `creatorFee`
/// figure, and carving referral cuts out of them as well would turn one
/// simple "5% of your trade-fee share" rule into several different partial
/// rules a creator would have to reason about separately.
///
/// `referrer` and `referralVault` are both resolved ONCE, at construction
/// (`referrer` via a single view call into the vault), and cached as
/// immutables — never re-checked. A wallet's referrer is permanent by the
/// vault's own design, so there is nothing to gain from re-reading it, and
/// caching means a buy/sell never pays for that external view call.
///
/// The actual ETH move to the vault happens via a real external call
/// (`IReferralVault.creditReferral`) in the Interactions section of `buy`/
/// `sell` — unlike ordinary creator/protocol fees, which stay as internal
/// bookkeeping until a later, separate `withdrawCreatorFees` call. This is
/// safe against the revert-griefing concern that keeps every OTHER payout
/// in this contract on a pull-payment path: `ReferralVault` is a trusted,
/// purpose-built protocol singleton (the same trust class as
/// `InfoFiCampaign`, which this contract already calls synchronously from
/// its constructor) whose `creditReferral` function does nothing but
/// increment a mapping — it cannot revert because of anything about
/// `referrer` themselves, only from a bug in the vault or from running out
/// of gas, the same residual risk already accepted for every other
/// synchronous protocol-singleton call in this codebase.
///
/// GRADUATION — THRESHOLD DETECTION + HALT HERE; MIGRATION IS A SEPARATE CONTRACT
/// -----------------------------------------------------------------------------
/// This contract detects "graduation" (the curve having raised enough real
/// ETH to be ready to migrate to a DEX pool) and HALTS trading at that
/// point — it does NOT perform the migration itself (creating the DEX
/// pool, minting the LP position, burning/locking it). That is deliberately
/// left to a separate contract (`GraduationMigrator`), for the same reason
/// the fee layer and the anti-snipe/cap layer are each scoped narrowly:
/// migrating liquidity to a DEX is a fundamentally different, higher-risk
/// operation (external protocol integration, LP token custody, pool
/// initialization) than anything else this contract does, and bundling it
/// in here would both bloat this contract's attack surface and make THIS
/// contract's already-audited pricing/fee logic harder to reason about in
/// isolation. This contract's entire involvement in migration is exactly
/// one function — `withdrawForMigration`, callable only by the immutable
/// `migrator` address, exactly once — everything after that (pool
/// creation, minting, burning the LP) lives entirely in `GraduationMigrator`.
///
/// Mechanically: `graduationThreshold` (immutable, e.g. "4.2 ETH
/// equivalent") is checked against `realEthReserve` at the end of every
/// `buy` — the ONLY place `realEthReserve` can increase. The very first
/// time `realEthReserve >= graduationThreshold`, `graduated` flips to
/// `true` — a one-way latch that is never reset by anything in this
/// contract (there is no setter, no admin override, no un-graduate path).
/// A fixed bonus (`graduationThreshold * 250 / 10_000`, i.e. 2.5% of the
/// THRESHOLD, not of whatever `realEthReserve` actually ended up at — see
/// `_maybeGraduate` for why that distinction matters) is credited to
/// `creatorFeesOwed` through the exact same pull-payment path as every
/// other creator fee, rather than pushed — consistent with the
/// revert-griefing rationale documented above for ordinary fees.
///
/// WHY TRADING FULLY HALTS ON GRADUATION (rather than continuing to allow
/// curve-based buys/sells alongside a future migrated DEX pool):
///
///   - A migration step will need to move `realEthReserve` and
///     `realTokenReserve` out of this contract and into a DEX pool
///     atomically, against a KNOWN, FROZEN snapshot of both. If trading
///     stayed open after the threshold was hit, that snapshot could keep
///     changing out from under the migration transaction, forcing it to
///     either race against ongoing trades or add its own complex
///     re-entrant-safe accounting — exactly the kind of extra complexity
///     this contract's fee/pricing logic has deliberately avoided
///     everywhere else.
///   - Two simultaneously-live venues for the same token (this curve AND
///     a DEX pool) would let arbitrageurs and price discrepancies exist
///     between them for as long as both remain open, which is confusing
///     for ordinary users and is not a state this system wants to spend
///     time in at all — graduation is meant to be a clean, instant
///     hand-off, not a gradual overlap.
///   - Halting is the safest DEFAULT while the migration step doesn't
///     exist yet at all (this PR/step): once `graduated` is `true`, ANY
///     further `buy`/`sell` reverting with `TokenGraduated()` guarantees
///     `realEthReserve`/`realTokenReserve` stay frozen at exactly the
///     values the future migration step will need to read, with zero risk
///     of this contract's own trading path corrupting that snapshot in
///     the meantime.
contract BondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Thrown by `buy` while still inside the post-launch delay
    /// window (`block.number <= launchBlock + delayBlocks`).
    error AntiSnipeDelayActive(uint256 currentBlock, uint256 unlockBlock);

    /// @notice Thrown by `buy` when the purchase would push the buyer's
    /// resulting balance above `maxWalletTokens` (2.5% of total supply).
    /// The whole transaction reverts — there is no partial fill.
    error MaxWalletExceeded(uint256 attemptedBalance, uint256 maxWalletTokens);

    /// @notice Thrown by BOTH `buy` and `sell` once `graduated` is `true`.
    /// Trading on this curve is over, permanently — see the contract-level
    /// NatSpec for why a full halt (rather than continued curve trading
    /// alongside a future migrated pool) is the correct default here.
    error TokenGraduated();

    /* -------------------------------------------------------------------- */
    /*                                Constants                             */
    /* -------------------------------------------------------------------- */

    /// @notice Trade fee, in basis points, taken from the ETH side of every
    /// buy/sell. 100 bps = 1%.
    uint256 public constant FEE_BPS = 100;

    /// @notice Basis-point denominator (100% == 10_000 bps).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Creator's share of every trade fee: 75%, flat, forever. The
    /// protocol takes the remaining 25%.
    ///
    /// @dev This replaced a ramp that escalated 75% -> 85% as a curve's
    /// cumulative volume approached a $10,000,000 USD-equivalent cap. The
    /// ramp was removed because it could not do what it described: a curve
    /// graduates once `graduationThreshold` of NET reserve is raised — 4.2
    /// ETH by default, order-of-magnitude $10k — and trading halts
    /// permanently at that point. Reaching a $10M GROSS volume cap first
    /// would have required turning over roughly three hundred times the
    /// graduation size without ever netting past it. No token was going to
    /// do that, so in practice every curve sat at the 75% floor for its
    /// entire life while the code, the docs and the UI all described an
    /// escalation that never moved.
    ///
    /// One honest rate is worth more than a mechanism whose only real
    /// effect was to be explained. It also removes the `ethUsdPrice`
    /// constructor parameter and the `volumeCapWei` immutable, which
    /// existed solely to convert that cap into wei.
    uint256 public constant CREATOR_SHARE_BPS = 7_500;

    /// @notice Max-wallet cap, in basis points of total supply: 2.5%.
    uint256 public constant MAX_WALLET_BPS = 250;

    /// @notice Graduation bonus, in basis points of `graduationThreshold`
    /// (not of the actual `realEthReserve` at graduation time): 2.5%.
    uint256 public constant GRADUATION_BONUS_BPS = 250;

    /// @notice Referral cut, in basis points of `creatorFee` (the fee-split
    /// share `_splitFee` computes — never `protocolFee`): 5%. See the
    /// contract-level "REFERRALS" NatSpec. Zero effect when `referrer` is
    /// the zero address (the common case — most creators have none).
    uint256 public constant REFERRAL_BPS = 500;

    /// @notice Portion of `token.totalSupply()`, in basis points, that is
    /// NEVER made sellable on this curve — held back in this contract's own
    /// token balance, untouched by `buy`/`sell`, reserved for a future
    /// migration step to seed DEX liquidity at graduation. 2,000 bps = 20%
    /// (the standard "800M sold / 200M reserved" split on a 1B-supply
    /// token, expressed as a ratio so it scales with whatever total supply
    /// a given token actually has). This contract does not move or spend
    /// this reserve itself — see the contract-level NatSpec on why DEX
    /// migration is deliberately left to a separate future contract/step.
    uint256 public constant LIQUIDITY_RESERVE_BPS = 2_000;

    /// @notice Upper bound on `infoFiBps`, in basis points: 500 = 5%.
    /// Enforced at construction, so no deployment can lock away more of the
    /// supply in an InfoFi pool than this regardless of what is requested.
    uint256 public constant MAX_INFOFI_BPS = 500;

    /// @notice Upper bound on `sellTaxBps`, in basis points: 300 = 3%.
    /// Enforced at construction — no deployment can configure a higher
    /// sell tax than this, regardless of what the deployer requests.
    uint256 public constant MAX_SELL_TAX_BPS = 300;

    /// @notice Whale-tier market-cap boundaries, 18-decimal fixed-point
    /// USD. See the contract-level "SELL TAX" NatSpec for the full table.
    uint256 public constant WHALE_TIER_1_MCAP_USD = 150_000e18;
    uint256 public constant WHALE_TIER_2_MCAP_USD = 300_000e18;
    uint256 public constant WHALE_TIER_3_MCAP_USD = 500_000e18;
    uint256 public constant WHALE_TIER_4_MCAP_USD = 1_000_000e18;

    /// @notice Whale-tier thresholds, in basis points of total supply —
    /// index-aligned with the `WHALE_TIER_n_MCAP_USD` boundaries above
    /// (tier 1 = mcap ≤ WHALE_TIER_1_MCAP_USD, ..., tier 5 = mcap above
    /// WHALE_TIER_4_MCAP_USD). Higher bps = a LARGER balance is required
    /// to count as a whale, i.e. tier 1 is the most lenient.
    uint256 public constant WHALE_TIER_1_BPS = 200; // 2.00%
    uint256 public constant WHALE_TIER_2_BPS = 150; // 1.50%
    uint256 public constant WHALE_TIER_3_BPS = 100; // 1.00%
    uint256 public constant WHALE_TIER_4_BPS = 75; // 0.75%
    uint256 public constant WHALE_TIER_5_BPS = 50; // 0.50%

    /// @notice Maximum age, in seconds, a Chainlink round is trusted for
    /// before `sell`'s whale-tax logic treats it as unavailable and falls
    /// back to `WHALE_TIER_1_BPS` (see the contract-level NatSpec for why
    /// a stale oracle degrades gracefully rather than blocking `sell`).
    uint256 public constant PRICE_STALENESS_THRESHOLD = 1 hours;

    /* -------------------------------------------------------------------- */
    /*                          Immutable configuration                     */
    /* -------------------------------------------------------------------- */

    /// @notice The ERC-20 token this curve prices and trades.
    IERC20 public immutable token;

    uint8 public immutable tokenDecimals;

    uint256 public immutable virtualEthReserve;
    uint256 public immutable virtualTokenReserve;

    /// @notice The token creator, fixed forever at deployment. Receives the
    /// escalating (75%-85%) share of every trade's 1% fee, claimable via
    /// `withdrawCreatorFees()`. Cannot be changed post-deploy — there is no
    /// setter, matching this system's "no admin, ever" posture even for a
    /// role that only receives revenue rather than controlling behavior.
    address public immutable creator;

    /// @notice Where `withdrawCreatorFees()` actually sends the creator's
    /// share. Defaults to `creator` when the deployer passes the zero
    /// address, but a launcher may point it at a different wallet, a
    /// multisig, or a splitter contract at deploy time.
    ///
    /// Deliberately separate from `creator` rather than replacing it:
    /// `creator` remains the token's identity for attribution and is what
    /// the whale sell tax and graduation bonus are credited on behalf of.
    /// This address only answers "where does the money land", and like
    /// everything else here it is immutable — a compromised creator wallet
    /// cannot later redirect the stream, and neither can anyone else.
    address public immutable creatorFeeRecipient;

    /// @notice The protocol's fee-collection treasury (a separate,
    /// already-deployed `ProtocolTreasury`-style contract, owned by a
    /// multisig). Receives the remainder of every trade's fee. Fixed
    /// forever at deployment.
    address public immutable protocolTreasury;

    /// @notice The block number this curve was deployed in. Combined with
    /// `delayBlocks` to gate `buy` against same-block/near-launch sniping.
    uint256 public immutable launchBlock;

    /// @notice Number of blocks after `launchBlock` during which `buy`
    /// reverts. Configurable per deployment, immutable once set. `sell` is
    /// never subject to this — see the contract-level NatSpec.
    uint256 public immutable delayBlocks;

    /// @notice Maximum tokens a single wallet may hold as a result of a
    /// `buy` (2.5% of total supply), computed once at construction from
    /// `token.totalSupply()`. `sell` is never subject to this either.
    uint256 public immutable maxWalletTokens;

    /// @notice The amount of `token`, out of the balance this contract
    /// received at construction, that is held back and never sold on this
    /// curve (`LIQUIDITY_RESERVE_BPS` of `token.totalSupply()`). Sits in
    /// this contract's token balance untouched by `buy`/`sell` — it is
    /// never counted in `realTokenReserve` and never priced into the
    /// curve — reserved for a future DEX-migration step to draw on.
    uint256 public immutable liquidityReserveTokens;

    /// @notice The amount of `token` carved out at construction for this
    /// launch's InfoFi campaign pool (`infoFiBps` of `token.totalSupply()`).
    ///
    /// Carved out ALONGSIDE `liquidityReserveTokens`, on the same principle:
    /// excluded from `realTokenReserve`, never sellable on the curve, never
    /// priced into it. The difference is where it physically sits — the
    /// liquidity reserve stays in this contract awaiting migration, whereas
    /// the InfoFi pool is transferred straight out to the campaign
    /// singleton during construction, so it is locked away from this
    /// contract entirely from the very first block.
    ///
    /// Zero when the launch opted out (`infoFiBps == 0`), which is the
    /// default.
    uint256 public immutable infoFiReserveTokens;

    /// @notice Basis points of total supply reserved for the InfoFi
    /// campaign, 0-`MAX_INFOFI_BPS`. Chosen by the creator at launch and
    /// immutable thereafter.
    uint256 public immutable infoFiBps;

    /// @notice The protocol-wide `InfoFiCampaign` singleton this launch's
    /// pool was sent to, or the zero address when `infoFiBps == 0`.
    address public immutable infoFiCampaign;

    /// @notice The real-ETH-raised level at which this curve graduates
    /// (default guidance: "4.2 ETH equivalent", but this is a constructor
    /// parameter, not hardcoded — configurable per deployment, immutable
    /// once set).
    uint256 public immutable graduationThreshold;

    /// @notice The ONLY address ever authorized to call
    /// `withdrawForMigration` (expected to be a deployed
    /// `GraduationMigrator`). Fixed forever at deployment — there is no
    /// setter, matching every other privileged-but-narrowly-scoped address
    /// in this contract (`creator`, `protocolTreasury`).
    address public immutable migrator;

    /// @notice Additional creator-only tax taken from `sell` proceeds, in
    /// basis points of the gross curve-quoted amount (0-300, i.e. 0%-3%,
    /// enforced against `MAX_SELL_TAX_BPS` at construction). `buy` is
    /// never subject to this — see the contract-level NatSpec.
    uint256 public immutable sellTaxBps;

    /// @notice Chainlink-style ETH/USD price feed used ONLY to gate the
    /// whale sell tax (see contract-level NatSpec) — a live oracle read on
    /// every taxable sell. This is the contract's only oracle dependency.
    AggregatorV3Interface public immutable ethUsdPriceFeed;

    /// @notice `ethUsdPriceFeed`'s own decimals, fetched once at
    /// construction (a Chainlink feed's decimals never change post-
    /// deployment) so `sell` doesn't need a second live call per trade.
    uint8 public immutable ethUsdPriceFeedDecimals;

    /// @notice The protocol-wide `ReferralVault` singleton, or the zero
    /// address to opt this curve out of referrals entirely (in which case
    /// `referrer` is always the zero address too, regardless of what the
    /// vault might say — no vault means no lookup, not "assume none"
    /// silently masking a misconfiguration). See the contract-level
    /// "REFERRALS" NatSpec.
    address public immutable referralVault;

    /// @notice `creator`'s permanent referrer, resolved ONCE from
    /// `referralVault` at construction and cached here forever. The zero
    /// address means no referrer (the common case) — `buy`/`sell` skip the
    /// entire referral code path whenever this is zero.
    address public immutable referrer;

    /* -------------------------------------------------------------------- */
    /*                               Mutable state                          */
    /* -------------------------------------------------------------------- */

    uint256 public realEthReserve;
    uint256 public realTokenReserve;

    /// @notice One-way latch: `false` until `realEthReserve` first reaches
    /// `graduationThreshold`, then `true` forever. No function in this
    /// contract can ever set it back to `false`.
    bool public graduated;

    /// @notice Cumulative gross ETH value (pre-fee) of every trade this
    /// curve has ever executed. Monotonically non-decreasing; drives the
    /// creator fee-share escalation.
    uint256 public cumulativeVolume;

    /// @notice ETH owed to `creator`, accumulated from fees, claimable via
    /// `withdrawCreatorFees()`.
    uint256 public creatorFeesOwed;

    /// @notice ETH owed to `protocolTreasury`, accumulated from fees,
    /// claimable via `withdrawProtocolFees()`.
    uint256 public protocolFeesOwed;

    /// @notice One-way latch: `false` until `withdrawForMigration`
    /// successfully runs once, then `true` forever. Guarantees the
    /// curve's real ETH reserve and reserved liquidity tokens can only
    /// ever be handed off to `migrator` a single time.
    bool public migrationExecuted;

    event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut);
    event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut);
    event FeeCollected(
        bool indexed isBuy, uint256 feeAmount, uint256 creatorFee, uint256 protocolFee
    );
    event CreatorFeesWithdrawn(uint256 amount);
    event ProtocolFeesWithdrawn(uint256 amount);

    /// @notice Emitted exactly once per curve, the moment `realEthReserve`
    /// first reaches `graduationThreshold`.
    /// @param ethRaised `realEthReserve` at the moment graduation
    ///        triggered (may be >= `graduationThreshold` if the triggering
    ///        buy overshot it).
    /// @param bonusAmount The graduation bonus credited to `creatorFeesOwed`
    ///        (`graduationThreshold * GRADUATION_BONUS_BPS / BPS_DENOMINATOR`).
    /// @param blockNumber `block.number` at the moment graduation triggered.
    event Graduated(uint256 ethRaised, uint256 bonusAmount, uint256 blockNumber);

    /// @notice Emitted once, when `withdrawForMigration` successfully
    /// hands off this curve's remaining real ETH reserve and reserved
    /// liquidity tokens to `migrator`.
    event MigrationWithdrawn(address indexed migrator, uint256 ethAmount, uint256 tokenAmount);

    /// @notice Emitted on every `sell` where `sellTaxBps > 0`, alongside
    /// `FeeCollected` — reports the creator-only sell-tax portion, kept
    /// separate from `FeeCollected`'s `feeAmount`/`creatorFee`/
    /// `protocolFee` (which describe only the 1% trade fee).
    event SellTaxCollected(address indexed seller, uint256 amount);

    /// @param token_ The ERC-20 already holding its full sellable supply at
    ///        this contract's (predicted) address.
    /// @param virtualEthReserve_ Virtual ETH liquidity offset, > 0.
    /// @param virtualTokenReserve_ Virtual token liquidity offset, > 0.
    /// @param creator_ Token creator; receives the escalating fee share.
    /// @param protocolTreasury_ Protocol fee-collection treasury address.
    /// @param delayBlocks_ Number of blocks after deployment during which
    ///        `buy` is blocked (anti-snipe). `0` still blocks same-block
    ///        sniping (a bundled deploy+buy), since `buy` requires
    ///        `block.number > launchBlock`, which cannot hold within the
    ///        deployment's own block.
    /// @param graduationThreshold_ Real-ETH-raised level at which this
    ///        curve graduates and halts (e.g. `4.2 ether`), > 0.
    /// @param migrator_ The only address ever authorized to call
    ///        `withdrawForMigration` (expected: a deployed
    ///        `GraduationMigrator`), > 0.
    /// @param sellTaxBps_ Additional creator-only tax on `sell` proceeds,
    ///        in basis points (0-300, i.e. 0%-3%), applied only to whale
    ///        sells — see the contract-level "SELL TAX" NatSpec. `buy` is
    ///        never subject to this.
    /// @param ethUsdPriceFeed_ Chainlink-style ETH/USD price feed used
    ///        ONLY to gate the whale sell tax live, > address(0). Pass any
    ///        non-zero placeholder if `sellTaxBps_` is `0` — it is never
    ///        read when the tax rate itself is zero.
    /// @param creatorFeeRecipient_ Where `withdrawCreatorFees()` sends the
    ///        creator's share. Pass `address(0)` to default it to
    ///        `creator_`, which is the ordinary case.
    /// @param infoFiBps_ Basis points of total supply to carve out for this
    ///        launch's InfoFi campaign pool (0-`MAX_INFOFI_BPS`). Pass `0`
    ///        to opt out entirely.
    /// @param infoFiCampaign_ The protocol-wide `InfoFiCampaign` singleton
    ///        the carve-out is transferred to. Required to be non-zero when
    ///        `infoFiBps_ > 0`; ignored otherwise.
    /// @param referralVault_ The protocol-wide `ReferralVault` singleton.
    ///        Pass `address(0)` to opt this curve out of referrals entirely
    ///        (`referrer` is then always the zero address, with no lookup
    ///        attempted) — see the contract-level "REFERRALS" NatSpec.
    constructor(
        IERC20 token_,
        uint256 virtualEthReserve_,
        uint256 virtualTokenReserve_,
        address creator_,
        address protocolTreasury_,
        uint256 delayBlocks_,
        uint256 graduationThreshold_,
        address migrator_,
        uint256 sellTaxBps_,
        address ethUsdPriceFeed_,
        address creatorFeeRecipient_,
        uint256 infoFiBps_,
        address infoFiCampaign_,
        address referralVault_
    ) {
        require(address(token_) != address(0), "BondingCurve: token is zero address");
        require(virtualEthReserve_ > 0, "BondingCurve: zero virtual eth reserve");
        require(virtualTokenReserve_ > 0, "BondingCurve: zero virtual token reserve");
        require(creator_ != address(0), "BondingCurve: creator is zero address");
        require(protocolTreasury_ != address(0), "BondingCurve: protocol treasury is zero address");
        require(graduationThreshold_ > 0, "BondingCurve: zero graduation threshold");
        require(migrator_ != address(0), "BondingCurve: migrator is zero address");
        require(sellTaxBps_ <= MAX_SELL_TAX_BPS, "BondingCurve: sell tax too high");
        require(ethUsdPriceFeed_ != address(0), "BondingCurve: eth/usd price feed is zero address");
        require(infoFiBps_ <= MAX_INFOFI_BPS, "BondingCurve: infofi allocation too high");
        require(
            infoFiBps_ == 0 || infoFiCampaign_ != address(0),
            "BondingCurve: infofi campaign is zero address"
        );

        token = token_;
        tokenDecimals = IERC20Metadata(address(token_)).decimals();
        virtualEthReserve = virtualEthReserve_;
        virtualTokenReserve = virtualTokenReserve_;
        creator = creator_;
        creatorFeeRecipient = creatorFeeRecipient_ == address(0) ? creator_ : creatorFeeRecipient_;
        protocolTreasury = protocolTreasury_;
        launchBlock = block.number;
        delayBlocks = delayBlocks_;
        graduationThreshold = graduationThreshold_;
        migrator = migrator_;
        sellTaxBps = sellTaxBps_;
        ethUsdPriceFeed = AggregatorV3Interface(ethUsdPriceFeed_);
        ethUsdPriceFeedDecimals = AggregatorV3Interface(ethUsdPriceFeed_).decimals();
        referralVault = referralVault_;
        referrer = referralVault_ == address(0)
            ? address(0)
            : IReferralVault(referralVault_).getReferrer(creator_);

        uint256 initialBalance = token_.balanceOf(address(this));
        require(initialBalance > 0, "BondingCurve: no tokens to sell");

        uint256 supply = token_.totalSupply();
        uint256 reserve = (supply * LIQUIDITY_RESERVE_BPS) / BPS_DENOMINATOR;
        uint256 infoFiReserve = (supply * infoFiBps_) / BPS_DENOMINATOR;

        // Both carve-outs come off the same balance, so they must fit
        // together — checked as a sum rather than one at a time, otherwise a
        // launch could pass the liquidity check and still underflow below.
        require(
            initialBalance > reserve + infoFiReserve,
            "BondingCurve: balance below reserved supply"
        );

        liquidityReserveTokens = reserve;
        infoFiBps = infoFiBps_;
        infoFiReserveTokens = infoFiReserve;
        infoFiCampaign = infoFiBps_ == 0 ? address(0) : infoFiCampaign_;
        realTokenReserve = initialBalance - reserve - infoFiReserve;

        maxWalletTokens = (supply * MAX_WALLET_BPS) / BPS_DENOMINATOR;

        // ---- Interactions ----
        // Last, after every piece of state above is final. The campaign is a
        // trusted protocol singleton, but ordering it this way means even a
        // misbehaving one re-entering here would find a fully-initialised
        // curve rather than a half-built one.
        //
        // Tokens are moved BEFORE the register call so the campaign can
        // verify its own balance actually grew, rather than taking `amount`
        // on trust from an arbitrary caller.
        if (infoFiReserve > 0) {
            token_.safeTransfer(infoFiCampaign_, infoFiReserve);
            IInfoFiCampaign(infoFiCampaign_).registerAllocation(address(token_), infoFiReserve);
        }
    }

    /* -------------------------------------------------------------------- */
    /*                                 Trading                              */
    /* -------------------------------------------------------------------- */

    /// @notice Buy tokens with ETH along the constant-product curve, net of
    /// a 1% fee taken from the ETH sent in.
    /// @param minTokensOut Minimum acceptable tokens out (post-fee);
    ///        reverts otherwise (slippage protection).
    /// @return tokensOut The amount of tokens transferred to the buyer.
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (graduated) revert TokenGraduated();
        require(msg.value > 0, "BondingCurve: zero eth in");

        // ---- Checks ----

        // Anti-snipe: no buys until strictly past the launch delay window.
        uint256 unlockBlock = launchBlock + delayBlocks;
        if (block.number <= unlockBlock) {
            revert AntiSnipeDelayActive(block.number, unlockBlock);
        }

        uint256 feeAmount = (msg.value * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netEthIn = msg.value - feeAmount;

        tokensOut = _quoteBuyNet(netEthIn);
        require(tokensOut > 0, "BondingCurve: zero tokens out");
        require(tokensOut >= minTokensOut, "BondingCurve: slippage");
        require(tokensOut <= realTokenReserve, "BondingCurve: insufficient token liquidity");

        // Max-wallet cap: full revert, never a partial fill.
        uint256 resultingBalance = token.balanceOf(msg.sender) + tokensOut;
        if (resultingBalance > maxWalletTokens) {
            revert MaxWalletExceeded(resultingBalance, maxWalletTokens);
        }

        (uint256 creatorFee, uint256 protocolFee) = _splitFee(feeAmount);
        // See the contract-level "REFERRALS" NatSpec: a fixed slice of the
        // CREATOR's own fee share, never `protocolFee`. Zero when there is
        // no referrer, which is the common case.
        uint256 referralCut =
            referrer != address(0) ? (creatorFee * REFERRAL_BPS) / BPS_DENOMINATOR : 0;

        // ---- Effects ----
        realEthReserve += netEthIn;
        realTokenReserve -= tokensOut;
        creatorFeesOwed += creatorFee - referralCut;
        protocolFeesOwed += protocolFee;
        cumulativeVolume += msg.value;

        // Graduation check: deliberately placed AFTER the max-wallet-cap
        // check above and AFTER fee deduction/`realEthReserve` update, so
        // a single buy can simultaneously pass the cap, pay its fee, and
        // trigger graduation atomically in one transaction — there's no
        // reason to force a buyer's final, threshold-crossing purchase
        // into two separate transactions.
        _maybeGraduate();

        // ---- Interactions ----
        token.safeTransfer(msg.sender, tokensOut);
        if (referralCut > 0) {
            IReferralVault(referralVault).creditReferral{value: referralCut}(referrer);
        }

        emit Buy(msg.sender, msg.value, tokensOut);
        emit FeeCollected(true, feeAmount, creatorFee, protocolFee);
    }

    /// @notice Sell tokens back into the curve for ETH, net of a 1% fee
    /// taken from the ETH proceeds, plus this curve's `sellTaxBps` (if
    /// any) — see the contract-level "SELL TAX" NatSpec.
    /// @dev Caller must have approved this contract for at least
    ///      `tokenAmount` beforehand.
    /// @param tokenAmount Amount of tokens to sell.
    /// @param minEthOut Minimum acceptable ETH out (post-fee, post-tax);
    ///        reverts otherwise (slippage protection).
    /// @return netEthOut The amount of ETH transferred to the seller.
    function sell(uint256 tokenAmount, uint256 minEthOut)
        external
        nonReentrant
        returns (uint256 netEthOut)
    {
        if (graduated) revert TokenGraduated();
        require(tokenAmount > 0, "BondingCurve: zero tokens in");

        // ---- Checks ----
        uint256 grossEthOut = quoteSellGross(tokenAmount);
        require(grossEthOut > 0, "BondingCurve: zero eth out");
        require(grossEthOut <= realEthReserve, "BondingCurve: insufficient eth liquidity");

        uint256 feeAmount = (grossEthOut * FEE_BPS) / BPS_DENOMINATOR;
        // Balance read BEFORE this sell's transferFrom below — "whale"
        // status is based on what the seller held going INTO the trade.
        uint256 sellTaxAmount = _sellTaxAmount(grossEthOut, token.balanceOf(msg.sender));
        netEthOut = grossEthOut - feeAmount - sellTaxAmount;
        require(netEthOut >= minEthOut, "BondingCurve: slippage");
        require(address(this).balance >= grossEthOut, "BondingCurve: insufficient eth balance");

        (uint256 creatorFee, uint256 protocolFee) = _splitFee(feeAmount);
        // See the contract-level "REFERRALS" NatSpec — computed off
        // `creatorFee` only, never `sellTaxAmount` (a separate credit path,
        // deliberately left out of the referral cut).
        uint256 referralCut =
            referrer != address(0) ? (creatorFee * REFERRAL_BPS) / BPS_DENOMINATOR : 0;

        // ---- Effects ----
        realTokenReserve += tokenAmount;
        realEthReserve -= grossEthOut;
        creatorFeesOwed += (creatorFee - referralCut) + sellTaxAmount;
        protocolFeesOwed += protocolFee;
        cumulativeVolume += grossEthOut;

        // ---- Interactions ----
        token.safeTransferFrom(msg.sender, address(this), tokenAmount);

        (bool sent,) = msg.sender.call{value: netEthOut}("");
        require(sent, "BondingCurve: eth transfer failed");

        if (referralCut > 0) {
            IReferralVault(referralVault).creditReferral{value: referralCut}(referrer);
        }

        emit Sell(msg.sender, tokenAmount, netEthOut);
        emit FeeCollected(false, feeAmount, creatorFee, protocolFee);
        if (sellTaxAmount > 0) emit SellTaxCollected(msg.sender, sellTaxAmount);
    }

    /* -------------------------------------------------------------------- */
    /*                        Pull-payment fee withdrawal                   */
    /* -------------------------------------------------------------------- */

    /// @notice Sweep all currently-owed creator fees to `creator`.
    /// Permissionless: anyone may call this, but funds only ever go to the
    /// immutable `creator` address. See the contract-level NatSpec for why
    /// this is pull-payment rather than pushed during `buy`/`sell`.
    function withdrawCreatorFees() external nonReentrant returns (uint256 amount) {
        amount = creatorFeesOwed;
        require(amount > 0, "BondingCurve: no creator fees owed");

        // ---- Effects ----
        creatorFeesOwed = 0;

        // ---- Interactions ----
        (bool sent,) = creatorFeeRecipient.call{value: amount}("");
        require(sent, "BondingCurve: creator fee transfer failed");

        emit CreatorFeesWithdrawn(amount);
    }

    /// @notice Sweep all currently-owed protocol fees to `protocolTreasury`.
    /// Permissionless, same rationale as `withdrawCreatorFees`.
    function withdrawProtocolFees() external nonReentrant returns (uint256 amount) {
        amount = protocolFeesOwed;
        require(amount > 0, "BondingCurve: no protocol fees owed");

        // ---- Effects ----
        protocolFeesOwed = 0;

        // ---- Interactions ----
        (bool sent,) = protocolTreasury.call{value: amount}("");
        require(sent, "BondingCurve: protocol fee transfer failed");

        emit ProtocolFeesWithdrawn(amount);
    }

    /* -------------------------------------------------------------------- */
    /*                      Graduation migration hand-off                   */
    /* -------------------------------------------------------------------- */

    /// @notice One-time hand-off of this curve's remaining real ETH
    /// reserve and its untouched `liquidityReserveTokens` to `migrator`,
    /// once graduated. Callable ONLY by `migrator` — unlike
    /// `withdrawCreatorFees`/`withdrawProtocolFees`, this pushes real
    /// value out on the CALLER's say-so with no fixed destination baked
    /// into the transfer itself, so it cannot be permissionless the same
    /// way; permissionless *triggering* of the overall migration still
    /// happens on `migrator`'s own end (see `GraduationMigrator.migrate`,
    /// which anyone may call) — funds simply never leave this contract
    /// except to that one immutable, pre-configured address.
    /// @dev The graduation bonus (`_maybeGraduate`) is credited to
    /// `creatorFeesOwed` WITHOUT a matching increase to this contract's
    /// actual ETH balance — it's funded implicitly by whatever slack
    /// exists between `address(this).balance` and
    /// `realEthReserve + creatorFeesOwed + protocolFeesOwed`. Blindly
    /// forwarding the full nominal `realEthReserve` here could therefore
    /// leave the contract unable to fully honor already-owed, not-yet-
    /// withdrawn creator/protocol fees afterward. `ethAmount` is capped at
    /// whatever this contract can ACTUALLY spare once those owed amounts
    /// are set aside, guaranteeing `withdrawCreatorFees`/
    /// `withdrawProtocolFees` can always still pay out in full even after
    /// migration — this only ever reduces what gets migrated, never what
    /// creators/the protocol are owed.
    /// @return ethAmount The real ETH reserve handed off (the full
    ///         reserve, unless doing so would leave insufficient balance
    ///         to cover already-owed, unwithdrawn fees — see above).
    /// @return tokenAmount The reserved liquidity tokens handed off (all
    ///         of `liquidityReserveTokens`).
    function withdrawForMigration()
        external
        nonReentrant
        returns (uint256 ethAmount, uint256 tokenAmount)
    {
        require(msg.sender == migrator, "BondingCurve: not migrator");
        require(graduated, "BondingCurve: not graduated");
        require(!migrationExecuted, "BondingCurve: migration already executed");

        // ---- Effects ----
        migrationExecuted = true;
        tokenAmount = liquidityReserveTokens;

        uint256 owed = creatorFeesOwed + protocolFeesOwed;
        uint256 spendable = address(this).balance > owed ? address(this).balance - owed : 0;
        ethAmount = realEthReserve < spendable ? realEthReserve : spendable;
        realEthReserve = 0;

        // ---- Interactions ----
        token.safeTransfer(migrator, tokenAmount);
        (bool sent,) = migrator.call{value: ethAmount}("");
        require(sent, "BondingCurve: eth transfer failed");

        emit MigrationWithdrawn(migrator, ethAmount, tokenAmount);
    }

    /* -------------------------------------------------------------------- */
    /*                           Views / quoting                            */
    /* -------------------------------------------------------------------- */

    function ethReserve() public view returns (uint256) {
        return virtualEthReserve + realEthReserve;
    }

    function tokenReserve() public view returns (uint256) {
        return virtualTokenReserve + realTokenReserve;
    }

    /// @notice Current marginal spot price, in wei per one whole token.
    /// @dev Reflects only the curve's own reserves, not the trade fee (the
    /// fee is a flat 1% surcharge/deduction applied on top of whatever the
    /// curve itself would quote — it does not shift the underlying curve).
    function getPrice() public view returns (uint256) {
        return (ethReserve() * (10 ** uint256(tokenDecimals))) / tokenReserve();
    }

    /// @notice The creator's share of the 1% fee, in basis points.
    ///
    /// @dev Kept as a function rather than reading `CREATOR_SHARE_BPS`
    /// directly at the call site: it was the ramp's entry point, several
    /// integrations already read it, and a constant-returning view keeps
    /// them working while leaving one place to change if the split ever
    /// becomes dynamic again.
    function currentCreatorFeeShareBps() public pure returns (uint256) {
        return CREATOR_SHARE_BPS;
    }

    /// @notice Quote how many tokens `ethIn` wei would buy right now,
    /// NET of the 1% fee — i.e. exactly what `buy` would actually return.
    function quoteBuy(uint256 ethIn) public view returns (uint256 tokensOut) {
        if (ethIn == 0) return 0;
        uint256 feeAmount = (ethIn * FEE_BPS) / BPS_DENOMINATOR;
        return _quoteBuyNet(ethIn - feeAmount);
    }

    /// @notice Quote how much ETH `tokenAmount` would sell for right now if
    /// `msg.sender` were the seller, NET of the 1% fee and (if
    /// `msg.sender`'s current balance clears the live whale threshold)
    /// `sellTaxBps` — i.e. exactly what `sell` would actually pay out for
    /// this caller, right now.
    function quoteSell(uint256 tokenAmount) public view returns (uint256 netEthOut) {
        uint256 grossEthOut = quoteSellGross(tokenAmount);
        if (grossEthOut == 0) return 0;
        uint256 feeAmount = (grossEthOut * FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellTaxAmount = _sellTaxAmount(grossEthOut, token.balanceOf(msg.sender));
        return grossEthOut - feeAmount - sellTaxAmount;
    }

    /// @notice Quote the GROSS ETH `tokenAmount` would produce from the
    /// curve formula alone, before the 1% fee is deducted. Exposed
    /// separately because `sell`'s liquidity check
    /// (`grossEthOut <= realEthReserve`) is evaluated pre-fee.
    function quoteSellGross(uint256 tokenAmount) public view returns (uint256) {
        if (tokenAmount == 0) return 0;
        uint256 eReserve = ethReserve();
        uint256 tReserve = tokenReserve();
        return (eReserve * tokenAmount) / (tReserve + tokenAmount);
    }

    /// @notice This curve's live market cap in 18-decimal fixed-point USD
    /// — `getPrice() * totalSupply` (in ETH) converted via `ethUsdPriceFeed`
    /// — and whether that read succeeded. `valid == false` means the feed
    /// was stale (>`PRICE_STALENESS_THRESHOLD` old) or reported a
    /// non-positive price; callers (just `_sellTaxAmount` today) treat that
    /// as "assume the most generous whale tier" rather than reverting.
    function currentMarketCapUsd() public view returns (uint256 mcapUsd18, bool valid) {
        try ethUsdPriceFeed.latestRoundData() returns (
            uint80 roundId, int256 answer, uint256, uint256 updatedAt, uint80 answeredInRound
        ) {
            if (answer <= 0) return (0, false);
            // A round whose answer was carried over from an earlier round, or
            // that never completed (`updatedAt == 0`), is not a fresh price
            // no matter how recent its timestamp looks. Treated exactly like
            // staleness: fall back to the most generous tier, never revert.
            if (updatedAt == 0 || answeredInRound < roundId) return (0, false);
            if (block.timestamp > updatedAt + PRICE_STALENESS_THRESHOLD) return (0, false);

            uint256 totalSupplyWhole = token.totalSupply() / (10 ** uint256(tokenDecimals));
            uint256 mcapWei = getPrice() * totalSupplyWhole;
            mcapUsd18 = Math.mulDiv(mcapWei, uint256(answer), 10 ** uint256(ethUsdPriceFeedDecimals));
            return (mcapUsd18, true);
        } catch {
            return (0, false);
        }
    }

    /// @notice The whale-tax threshold basis points implied by this
    /// curve's LIVE market cap right now (see the contract-level "SELL
    /// TAX" NatSpec for the tier table). Falls back to the most lenient
    /// tier (`WHALE_TIER_1_BPS`) if `currentMarketCapUsd` couldn't get a
    /// valid live price.
    function currentWhaleThresholdBps() public view returns (uint256) {
        (uint256 mcapUsd18, bool valid) = currentMarketCapUsd();
        if (!valid) return WHALE_TIER_1_BPS;
        if (mcapUsd18 <= WHALE_TIER_1_MCAP_USD) return WHALE_TIER_1_BPS;
        if (mcapUsd18 <= WHALE_TIER_2_MCAP_USD) return WHALE_TIER_2_BPS;
        if (mcapUsd18 <= WHALE_TIER_3_MCAP_USD) return WHALE_TIER_3_BPS;
        if (mcapUsd18 <= WHALE_TIER_4_MCAP_USD) return WHALE_TIER_4_BPS;
        return WHALE_TIER_5_BPS;
    }

    /// @notice The token balance, right now, above which a seller is
    /// considered a "whale" and subject to `sellTaxBps` on their next
    /// sell — `currentWhaleThresholdBps` of `token.totalSupply()`.
    function currentWhaleThresholdTokens() public view returns (uint256) {
        return (token.totalSupply() * currentWhaleThresholdBps()) / BPS_DENOMINATOR;
    }

    /* -------------------------------------------------------------------- */
    /*                              Internal helpers                        */
    /* -------------------------------------------------------------------- */

    /// @dev Raw constant-product formula given an already-net ETH amount
    /// (fee already removed by the caller).
    function _quoteBuyNet(uint256 netEthIn) internal view returns (uint256) {
        if (netEthIn == 0) return 0;
        uint256 eReserve = ethReserve();
        uint256 tReserve = tokenReserve();
        return (tReserve * netEthIn) / (eReserve + netEthIn);
    }

    /// @dev Splits `feeAmount` between creator and protocol using the
    /// creator share implied by `cumulativeVolume` BEFORE the current
    /// trade is added to it. `protocolFee` is always the remainder, so
    /// `creatorFee + protocolFee == feeAmount` holds exactly, to the wei,
    /// with no rounding dust ever unaccounted for.
    function _splitFee(uint256 feeAmount)
        internal
        view
        returns (uint256 creatorFee, uint256 protocolFee)
    {
        uint256 creatorBps = currentCreatorFeeShareBps();
        creatorFee = (feeAmount * creatorBps) / BPS_DENOMINATOR;
        protocolFee = feeAmount - creatorFee;
    }

    /// @dev Shared by `sell` and `quoteSell` so both always agree exactly.
    /// Returns 0 outright if `sellTaxBps == 0` (skips the live oracle read
    /// entirely when the rate is zero — no reason to price a tier nobody
    /// pays) or if `sellerBalanceBeforeSale` doesn't clear the live whale
    /// threshold; otherwise `sellTaxBps` of `grossEthOut`.
    function _sellTaxAmount(uint256 grossEthOut, uint256 sellerBalanceBeforeSale)
        internal
        view
        returns (uint256)
    {
        if (sellTaxBps == 0) return 0;
        if (sellerBalanceBeforeSale <= currentWhaleThresholdTokens()) return 0;
        return (grossEthOut * sellTaxBps) / BPS_DENOMINATOR;
    }

    /// @dev Called only from `buy`, only after `realEthReserve` has already
    /// been updated for the current trade. The `!graduated` guard is what
    /// makes this idempotent/one-shot: once the first qualifying buy sets
    /// `graduated = true`, every later call (including one within the SAME
    /// buy transaction, though nothing loops back into this function
    /// twice per call today) short-circuits immediately and neither
    /// re-emits `Graduated` nor re-credits the bonus. This is the guarantee
    /// behind "the bonus never double-pays, even at the exact boundary."
    ///
    /// The bonus is computed from `graduationThreshold` (the configured
    /// target), NOT from `realEthReserve` (the actual amount raised at the
    /// moment of triggering) — a large buy that overshoots the threshold
    /// in one jump still only earns the bonus on the threshold amount, not
    /// on the overshoot. This keeps the bonus a predictable, fixed
    /// quantity known at deploy time (`graduationThreshold * 2.5%`) rather
    /// than something that varies with how "lumpy" the triggering trade
    /// happened to be.
    function _maybeGraduate() internal {
        if (graduated || realEthReserve < graduationThreshold) return;

        graduated = true;

        uint256 bonus = (graduationThreshold * GRADUATION_BONUS_BPS) / BPS_DENOMINATOR;
        creatorFeesOwed += bonus;

        emit Graduated(realEthReserve, bonus, block.number);
    }
}
