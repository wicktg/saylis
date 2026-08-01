// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from
    "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IInfoFiCampaign} from "./interfaces/IInfoFiCampaign.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {TickMath} from "./libraries/TickMath.sol";

/// @dev The slice of `BondingCurve` this contract reads. Declared locally
///      rather than importing the full contract so the campaign does not
///      inherit its entire dependency graph.
interface IBondingCurveView {
    function token() external view returns (IERC20);
    function graduated() external view returns (bool);
    function currentMarketCapUsd() external view returns (uint256 mcapUsd18, bool valid);
    function infoFiReserveTokens() external view returns (uint256);
}

/// @title InfoFiCampaign
/// @notice Protocol-wide singleton holding every launch's InfoFi campaign
/// pool, gating campaigns behind a sustained market-cap threshold, and
/// settling them against an off-chain-computed mindshare leaderboard.
///
/// # Lifecycle
///
/// ```
///   Registered ──poke past $120k for 24h──> Eligible ──team──> Open
///        │                                      │                │
///        │                                      │        publishResults(root)
///        │                                      │                │
///        │                                      │                v
///        │                                      │            Settled ──claims──┐
///        │                                      │                │             │
///        └──────────── abandoned ───────────────┴────────────────┴─────────────┘
///                                                                 │
///                                                                 v
///                                                       burn to 0x…dEaD
/// ```
///
/// # What is deliberately NOT here
///
/// **No auto-open.** Crossing the market-cap bar only emits
/// `CampaignEligible`. A human still has to look at the token and call
/// `openCampaign`. Sustained price is evidence, not authorisation — an
/// automatic trigger would turn a manipulable number into a payout.
///
/// **No cancellation.** `openCampaign` is one-way. Once it fires the pool
/// is committed and the window runs to completion regardless of what the
/// price does afterwards. Participants are being asked to spend a week
/// producing content; a campaign that could be yanked mid-flight because
/// the chart moved is not a campaign anyone should enter.
///
/// **No owner sweep, anywhere.** There is no function on this contract that
/// moves a pool to an address the team controls. The only exits for a
/// registered pool are a participant claiming against a published merkle
/// root, or a burn to `0x…dEaD` that anyone may trigger. This is the whole
/// point: a creator who allocates 5% of supply is not handing it to us.
///
/// # Why claims are merkle-based
///
/// Mindshare is computed off-chain from X engagement (see the backend's
/// daily recompute), because nothing about views, likes, quote-tweets or
/// reply-filtering is knowable on-chain. Publishing a single root keeps the
/// on-chain footprint to one 32-byte word regardless of whether ten or ten
/// thousand people participated, and lets each winner pay their own claim
/// gas. The root is published only AFTER the campaign window closes, so a
/// participant's final standing cannot be known — or gamed — mid-campaign.
contract InfoFiCampaign is IInfoFiCampaign, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ------------------------------------------------------------------ */
    /*                               Types                                */
    /* ------------------------------------------------------------------ */

    enum State {
        /// @dev No pool registered for this token.
        None,
        /// @dev Pool registered and locked; market cap not yet sustained.
        Registered,
        /// @dev Sustained threshold met; `CampaignEligible` emitted, awaiting
        ///      team review. Still burnable, still not committed.
        Eligible,
        /// @dev Team opened it. One-way from here — the pool is committed.
        Open,
        /// @dev Window closed and a merkle root published; claims are live.
        Settled,
        /// @dev Whatever was left has been burned. Terminal.
        Burned
    }

    struct Campaign {
        State state;
        /// @dev The curve that registered this pool, used for price reads.
        ///      Zero for an externally-registered pool, which has no curve.
        address curve;
        /// @dev Who registered the pool and may open it once the team has
        ///      cleared it. Only meaningful for external pools; a
        ///      curve-registered launch is always opened by the team.
        address owner;
        /// @dev True when the pool was funded by a project that did NOT
        ///      launch here, so there is no bonding curve to price against
        ///      and eligibility is a human decision rather than a market
        ///      one. See `registerExternalPool`.
        bool isExternal;
        /// @dev Pool size, fixed at registration and never changed.
        uint256 allocation;
        /// @dev Total claimed so far, only ever increasing.
        uint256 claimed;
        /// @dev When the curve registered this pool. Anchors the
        ///      never-opened long-stop in `burnUnclaimed`.
        uint64 registeredAt;
        /// @dev Timestamp the market cap most recently went (and stayed)
        ///      above the threshold. Zero when currently below it.
        uint64 aboveSince;
        /// @dev When `openCampaign` fired.
        uint64 openedAt;
        /// @dev When the campaign window closes and results may be published.
        uint64 windowEnds;
        /// @dev Last moment a claim is accepted; after this anyone may burn.
        uint64 claimDeadline;
        /// @dev Merkle root of (account, amount) leaves. Zero until settled.
        bytes32 merkleRoot;
    }

    /* ------------------------------------------------------------------ */
    /*                             Constants                              */
    /* ------------------------------------------------------------------ */

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice How long the campaign window runs once opened: 7 days.
    uint64 public constant CAMPAIGN_WINDOW = 7 days;

    /// @notice How long winners have to claim after results are published:
    /// 7 days, matching the 7-day campaign window itself — a campaign's full
    /// lifecycle is a 7-day run followed by a 7-day claim period, then
    /// whatever's unclaimed becomes burnable.
    uint64 public constant CLAIM_WINDOW = 7 days;

    /// @notice If a pool is never opened, anyone may burn it after this long
    /// from registration. Without a long-stop, an ignored pool would be
    /// stranded forever — and since there is no sweep path, "stranded" would
    /// mean permanently removed from supply with no event ever marking it.
    uint64 public constant ABANDON_PERIOD = 365 days;

    /// @notice TWAP window used for the post-graduation price read. Long
    /// enough that moving it for the full duration costs more than the
    /// review it would buy.
    uint32 public constant TWAP_PERIOD = 30 minutes;

    /// @notice Rejected as stale beyond this age, matching `BondingCurve`.
    uint256 public constant PRICE_STALENESS_THRESHOLD = 1 hours;

    uint16 internal constant TARGET_OBSERVATION_CARDINALITY = 64;

    /* ------------------------------------------------------------------ */
    /*                             Immutables                             */
    /* ------------------------------------------------------------------ */

    /// @notice The address allowed to open campaigns and publish results.
    /// Expected to be the protocol multisig. It can start and settle a
    /// campaign; it can never take a pool.
    address public immutable team;

    /// @notice Market cap, in 18-decimal USD, a token must hold to qualify.
    uint256 public immutable mcapThresholdUsd18;

    /// @notice How long the market cap must stay at or above the threshold.
    uint64 public immutable sustainedDuration;

    /// @notice TESTING MODE. When true, a curve-backed launch qualifies the
    /// moment it GRADUATES, and `mcapThresholdUsd18`/`sustainedDuration` are
    /// not consulted at all.
    ///
    /// Graduation is a far cleaner test signal than a dollar market cap: it
    /// is a single boolean the curve already owns, it cannot be nudged
    /// across a threshold by a momentary price wick, and it does not depend
    /// on a live oracle being fresh. The USD path stays fully implemented
    /// and tested underneath, so switching this off is a redeploy, not a
    /// rewrite.
    bool public immutable graduationOnly;

    IUniswapV3Factory public immutable uniswapFactory;
    address public immutable weth9;
    uint24 public immutable poolFee;
    AggregatorV3Interface public immutable ethUsdPriceFeed;
    uint8 public immutable ethUsdPriceFeedDecimals;

    /* ------------------------------------------------------------------ */
    /*                               Storage                              */
    /* ------------------------------------------------------------------ */

    mapping(address token => Campaign) public campaigns;

    /// @dev token => account => already claimed. Prevents replaying a proof.
    mapping(address token => mapping(address account => bool)) public hasClaimed;

    /* ------------------------------------------------------------------ */
    /*                               Errors                               */
    /* ------------------------------------------------------------------ */

    error NotTeam();
    error ZeroAddress();
    error ZeroAllocation();
    error AlreadyRegistered(address token);
    error AllocationNotReceived(uint256 expected, uint256 received);
    error CurveTokenMismatch(address expected, address actual);
    error WrongState(address token, State expected, State actual);
    error NotEligibleYet(address token, uint64 aboveSince, uint64 requiredUntil);
    error CampaignWindowStillOpen(address token, uint64 windowEnds);
    error ClaimWindowClosed(address token, uint64 deadline);
    error ClaimWindowStillOpen(address token, uint64 deadline);
    error NotAbandonedYet(address token, uint64 burnableAt);
    error AlreadyClaimed(address token, address account);
    error InvalidProof();
    error ClaimExceedsPool(uint256 requested, uint256 remaining);
    error PriceUnavailable(address token);
    error EmptyRoot();
    /// @notice `markEligible` was aimed at a curve-backed launch, whose
    ///         eligibility must be earned on-chain rather than granted.
    error NotExternalPool(address token);
    /// @notice An external pool has no market to observe; clear it with
    ///         `markEligible` instead of poking it.
    error ExternalPoolNotPokeable(address token);

    /* ------------------------------------------------------------------ */
    /*                               Events                               */
    /* ------------------------------------------------------------------ */

    event AllocationRegistered(
        address indexed token, address indexed curve, uint256 amount
    );
    /// @notice A project funded a pool for a token that launched elsewhere.
    event ExternalPoolRegistered(
        address indexed token, address indexed owner, uint256 amount
    );
    /// @notice The signal the backend indexes to surface a token for review.
    event CampaignEligible(
        address indexed token, uint256 mcapUsd18, uint64 aboveSince, uint64 qualifiedAt
    );
    /// @dev Emitted on every poke that changes the sustained-window state,
    ///      so the backend can chart progress toward eligibility rather than
    ///      only seeing the final crossing.
    event MarketCapRecorded(address indexed token, uint256 mcapUsd18, uint64 aboveSince);
    event CampaignOpened(
        address indexed token, uint256 allocation, uint64 openedAt, uint64 windowEnds
    );
    event ResultsPublished(
        address indexed token, bytes32 merkleRoot, uint64 claimDeadline
    );
    event Claimed(address indexed token, address indexed account, uint256 amount);
    event Burned(address indexed token, uint256 amount, State fromState);

    /* ------------------------------------------------------------------ */
    /*                            Construction                            */
    /* ------------------------------------------------------------------ */

    /// @param team_ Multisig allowed to open/settle campaigns.
    /// @param mcapThresholdUsd18_ Sustained market cap required, 18dp USD
    ///        (default guidance: 120_000e18).
    /// @param sustainedDuration_ How long it must hold (default: 24 hours).
    /// @param graduationOnly_ Testing mode: qualify curve-backed launches on
    ///        graduation instead of a sustained USD market cap.
    constructor(
        address team_,
        uint256 mcapThresholdUsd18_,
        uint64 sustainedDuration_,
        address uniswapFactory_,
        address weth9_,
        uint24 poolFee_,
        address ethUsdPriceFeed_,
        bool graduationOnly_
    ) {
        if (
            team_ == address(0) || uniswapFactory_ == address(0) || weth9_ == address(0)
                || ethUsdPriceFeed_ == address(0)
        ) revert ZeroAddress();
        require(mcapThresholdUsd18_ > 0, "InfoFiCampaign: zero mcap threshold");
        require(sustainedDuration_ > 0, "InfoFiCampaign: zero sustained duration");

        team = team_;
        mcapThresholdUsd18 = mcapThresholdUsd18_;
        sustainedDuration = sustainedDuration_;
        uniswapFactory = IUniswapV3Factory(uniswapFactory_);
        weth9 = weth9_;
        poolFee = poolFee_;
        ethUsdPriceFeed = AggregatorV3Interface(ethUsdPriceFeed_);
        ethUsdPriceFeedDecimals = AggregatorV3Interface(ethUsdPriceFeed_).decimals();
        graduationOnly = graduationOnly_;
    }

    modifier onlyTeam() {
        if (msg.sender != team) revert NotTeam();
        _;
    }

    /* ------------------------------------------------------------------ */
    /*                            Registration                            */
    /* ------------------------------------------------------------------ */

    /// @inheritdoc IInfoFiCampaign
    /// @dev Called from `BondingCurve`'s constructor, after it has already
    ///      transferred the pool in.
    ///
    ///      NOTE ON THE MISSING IDENTITY CHECK: it is tempting to verify the
    ///      caller by reading `IBondingCurveView(msg.sender).token()`. That
    ///      cannot work. The curve is still executing its own constructor
    ///      when it calls this, so its runtime code is not yet deployed and
    ///      ANY external call back into it reverts with "call to non-contract
    ///      address". Registration has to be judged on evidence that exists
    ///      at this instant, which is the balance.
    ///
    ///      What actually secures it:
    ///
    ///      1. The tokens must ALREADY be here — verified against this
    ///         contract's own balance, never by trusting `amount`. Anyone
    ///         registering therefore pays for the pool they register.
    ///      2. First registration per token wins, permanently.
    ///      3. For a normally-launched token the whole supply is minted to
    ///         the curve and registration happens in the SAME transaction,
    ///         so there is no window in which a third party holds a balance
    ///         to front-run with.
    ///
    ///      The residual case is a token whose curve opted out of InfoFi
    ///      entirely: a holder could donate tokens and register a pool
    ///      naming a contract they control as the curve. That costs them
    ///      real tokens, yields a pool only they funded, and still cannot
    ///      pay out without the team opening it — so it buys nothing.
    function registerAllocation(address token, uint256 amount) external override nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAllocation();

        Campaign storage campaign = campaigns[token];
        if (campaign.state != State.None) revert AlreadyRegistered(token);

        uint256 received = IERC20(token).balanceOf(address(this));
        if (received < amount) revert AllocationNotReceived(amount, received);

        campaign.state = State.Registered;
        campaign.curve = msg.sender;
        campaign.owner = msg.sender;
        campaign.allocation = amount;
        campaign.registeredAt = uint64(block.timestamp);

        emit AllocationRegistered(token, msg.sender, amount);
    }

    /// @notice Fund a campaign pool OUTSIDE of a curve's own constructor —
    /// either "Path B" (a creator buys supply on a token that already
    /// launched here and locks it post-launch) or a genuinely external
    /// project with no Saylis curve at all.
    ///
    /// Same evidence rule as `registerAllocation` — transfer the tokens in
    /// first, then call this, and the balance is what is believed.
    ///
    /// @param curve The token's `BondingCurve`, or `address(0)` if none
    ///        exists. Unlike `registerAllocation` (called mid-constructor,
    ///        before the curve has code), this call happens strictly AFTER
    ///        the curve is fully deployed, so it CAN be verified externally:
    ///        passing a non-zero `curve` requires `curve.token() == token`.
    ///        Get this wrong and the pool is stuck as a true external with
    ///        no automatic eligibility — verified once, trusted forever.
    ///
    ///        - `curve` verified non-zero: eligibility is earned the same
    ///          way as a mint-time allocation (`recordMarketCap`, graduation
    ///          in testing mode). This is Path B.
    ///        - `curve` left zero: no market exists to observe, so
    ///          eligibility is a team decision (`markEligible`).
    function registerExternalPool(address token, uint256 amount, address curve)
        external
        nonReentrant
        returns (uint256 registered)
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAllocation();
        if (curve != address(0)) {
            address curveToken = address(IBondingCurveView(curve).token());
            if (curveToken != token) revert CurveTokenMismatch(token, curveToken);
        }

        Campaign storage campaign = campaigns[token];
        if (campaign.state != State.None) revert AlreadyRegistered(token);

        uint256 received = IERC20(token).balanceOf(address(this));
        if (received < amount) revert AllocationNotReceived(amount, received);

        campaign.state = State.Registered;
        campaign.curve = curve;
        campaign.owner = msg.sender;
        // Only a TRUE external (no verifiable curve) skips automatic
        // eligibility. A verified Path B pool behaves exactly like a
        // mint-time allocation from here on.
        campaign.isExternal = (curve == address(0));
        campaign.allocation = amount;
        campaign.registeredAt = uint64(block.timestamp);

        emit AllocationRegistered(token, curve, amount);
        emit ExternalPoolRegistered(token, msg.sender, amount);
        return amount;
    }

    /// @notice Team clearance for an externally-funded pool.
    ///
    /// @dev The counterpart to `recordMarketCap`, for pools that have no
    ///      market to record. It only moves `Registered -> Eligible`; it
    ///      cannot open a campaign, and it cannot touch a curve-backed
    ///      launch, whose eligibility must still be earned on-chain.
    function markEligible(address token) external onlyTeam {
        Campaign storage campaign = campaigns[token];
        if (campaign.state != State.Registered) {
            revert WrongState(token, State.Registered, campaign.state);
        }
        if (!campaign.isExternal) revert NotExternalPool(token);

        campaign.state = State.Eligible;
        emit CampaignEligible(token, 0, 0, uint64(block.timestamp));
    }

    /* ------------------------------------------------------------------ */
    /*                        Eligibility tracking                        */
    /* ------------------------------------------------------------------ */

    /// @notice Permissionless poke that samples the token's market cap and
    /// advances (or resets) its sustained-threshold timer.
    ///
    /// @dev The contract cannot watch price on its own, so "sustained" is
    ///      measured as "the timer was started at some point and has not been
    ///      reset since". A poke below the threshold clears `aboveSince`,
    ///      which is what makes the window continuous rather than cumulative.
    ///
    ///      This is honest about its limits: between two pokes the price is
    ///      unobserved, so a token could dip and recover unseen. That is
    ///      acceptable precisely because eligibility only buys a human
    ///      review — the backend pokes on a schedule, and the team sees the
    ///      real chart before committing anything.
    function recordMarketCap(address token) external returns (bool eligible) {
        Campaign storage campaign = campaigns[token];
        State state = campaign.state;
        // Only meaningful before the team has acted; afterwards the price is
        // explicitly no longer allowed to matter.
        if (state != State.Registered && state != State.Eligible) {
            revert WrongState(token, State.Registered, state);
        }

        // An external pool has no market to observe. It is cleared by
        // `markEligible` instead, so poking one is a caller mistake rather
        // than a transient failure.
        if (campaign.isExternal) revert ExternalPoolNotPokeable(token);

        // TESTING MODE: graduation IS the bar. Checked before any oracle
        // read so eligibility never depends on feed freshness.
        if (graduationOnly) {
            if (!IBondingCurveView(campaign.curve).graduated()) {
                return false;
            }
            if (state == State.Registered) {
                campaign.state = State.Eligible;
                campaign.aboveSince = uint64(block.timestamp);
                emit CampaignEligible(token, 0, uint64(block.timestamp), uint64(block.timestamp));
                return true;
            }
            return true;
        }

        (uint256 mcapUsd18, bool valid) = marketCapUsd(token);
        if (!valid) revert PriceUnavailable(token);

        uint64 nowTs = uint64(block.timestamp);

        if (mcapUsd18 < mcapThresholdUsd18) {
            // Dropped below: the streak is broken and must restart from zero.
            if (campaign.aboveSince != 0) {
                campaign.aboveSince = 0;
                emit MarketCapRecorded(token, mcapUsd18, 0);
            }
            return state == State.Eligible;
        }

        if (campaign.aboveSince == 0) {
            campaign.aboveSince = nowTs;
            emit MarketCapRecorded(token, mcapUsd18, nowTs);
        }

        uint64 qualifyAt = campaign.aboveSince + sustainedDuration;
        if (state == State.Registered && nowTs >= qualifyAt) {
            campaign.state = State.Eligible;
            emit CampaignEligible(token, mcapUsd18, campaign.aboveSince, nowTs);
            return true;
        }

        return state == State.Eligible;
    }

    /// @notice This token's market cap in 18-decimal USD, and whether the
    /// read was trustworthy.
    ///
    /// @dev Two regimes, because the price lives in two different places
    ///      over a token's life:
    ///
    ///      - **Pre-graduation** the curve IS the market, so its own
    ///        `currentMarketCapUsd()` is authoritative.
    ///      - **Post-graduation** the curve's reserves have been drained
    ///        into a Uniswap pool and `getPrice()` is frozen at a stale
    ///        value, so reading it would report a market cap that stopped
    ///        moving at graduation. The pool's TWAP is the live price.
    ///
    ///      Since a $120k threshold is typically crossed well after a
    ///      ~$12.6k-raise graduation, the second regime is the one that
    ///      actually decides most campaigns.
    function marketCapUsd(address token) public view returns (uint256 mcapUsd18, bool valid) {
        Campaign storage campaign = campaigns[token];
        address curve = campaign.curve;
        // Zero for an external pool (and for an unregistered token). Calling
        // `graduated()` on a non-contract would revert rather than return,
        // so this guard is what keeps every price path safe.
        if (curve == address(0)) return (0, false);

        if (!IBondingCurveView(curve).graduated()) {
            return IBondingCurveView(curve).currentMarketCapUsd();
        }
        return _poolMarketCapUsd(token);
    }

    /// @dev Market cap from the graduated token's Uniswap V3 pool TWAP.
    ///      Returns `(0, false)` rather than reverting on every failure mode
    ///      — no pool, too young an observation buffer, stale ETH/USD feed —
    ///      so a caller can distinguish "not qualified" from "cannot tell".
    function _poolMarketCapUsd(address token) internal view returns (uint256, bool) {
        address pool = uniswapFactory.getPool(token, weth9, poolFee);
        if (pool == address(0)) return (0, false);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_PERIOD;
        secondsAgos[1] = 0;

        int56[] memory tickCumulatives;
        try IUniswapV3Pool(pool).observe(secondsAgos) returns (
            int56[] memory ticks, uint160[] memory
        ) {
            tickCumulatives = ticks;
        } catch {
            // Buffer does not reach back TWAP_PERIOD yet (a freshly seeded
            // pool has cardinality 1). Not an error — just not answerable.
            return (0, false);
        }

        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(tickDelta / int56(uint56(TWAP_PERIOD)));
        // Solidity truncates toward zero; Uniswap's convention rounds the
        // average tick down, which matters for negative ticks (i.e. whenever
        // the launch token is cheaper than ETH, which is essentially always).
        if (tickDelta < 0 && tickDelta % int56(uint56(TWAP_PERIOD)) != 0) avgTick--;

        // `getSqrtRatioAtTick` reverts outside Uniswap's global tick bounds.
        // Every other failure mode in this function degrades to (0, false)
        // so `recordMarketCap` stays pokeable; an out-of-range average tick
        // must not be the one case that bricks it instead.
        if (avgTick < TickMath.MIN_TICK || avgTick > TickMath.MAX_TICK) return (0, false);

        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(avgTick);

        // sqrtPriceX96 encodes sqrt(token1/token0) in Q64.96. Square it to a
        // plain ratio, splitting the shift so the intermediate stays inside
        // 256 bits for the full legal price range.
        uint256 priceX96 = Math.mulDiv(
            uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96
        );
        // At the extreme low end of the tick range the squared price rounds
        // to zero, which would make the inverted branch below divide by zero
        // and revert. Unanswerable, not fatal — same contract as every other
        // failure path here.
        if (priceX96 == 0) return (0, false);

        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        uint256 wholeSupply = IERC20(token).totalSupply() / (10 ** uint256(tokenDecimals));
        if (wholeSupply == 0) return (0, false);

        // Normalise to "wei of ETH per whole token" regardless of which side
        // of the pair the launch token sorted onto.
        uint256 ethPerTokenWei = IUniswapV3Pool(pool).token0() == token
            ? Math.mulDiv(priceX96, 10 ** uint256(tokenDecimals), 1 << 96)
            : Math.mulDiv(1 << 96, 10 ** uint256(tokenDecimals), priceX96);

        (uint256 ethUsd18, bool feedValid) = _ethUsd18();
        if (!feedValid) return (0, false);

        uint256 mcapWei = ethPerTokenWei * wholeSupply;
        return (Math.mulDiv(mcapWei, ethUsd18, 1e18), true);
    }

    /// @dev ETH/USD as 18dp, or `(0, false)` if the feed is stale/invalid.
    function _ethUsd18() internal view returns (uint256, bool) {
        try ethUsdPriceFeed.latestRoundData() returns (
            uint80 roundId, int256 answer, uint256, uint256 updatedAt, uint80 answeredInRound
        ) {
            if (answer <= 0) return (0, false);
            // Incomplete or carried-over round. Eligibility must never be
            // granted off a price the feed itself has not finalised.
            if (updatedAt == 0 || answeredInRound < roundId) return (0, false);
            if (block.timestamp > updatedAt + PRICE_STALENESS_THRESHOLD) return (0, false);
            return (
                Math.mulDiv(uint256(answer), 1e18, 10 ** uint256(ethUsdPriceFeedDecimals)), true
            );
        } catch {
            return (0, false);
        }
    }

    /// @notice Permissionless helper that grows a graduated pool's
    /// observation buffer so `TWAP_PERIOD` becomes queryable. A pool seeded
    /// by `GraduationMigrator` starts at cardinality 1 and would otherwise
    /// never be able to answer a TWAP.
    function primePoolOracle(address token) external {
        address pool = uniswapFactory.getPool(token, weth9, poolFee);
        if (pool == address(0)) revert PriceUnavailable(token);
        IUniswapV3Pool(pool).increaseObservationCardinalityNext(
            TARGET_OBSERVATION_CARDINALITY
        );
    }

    /* ------------------------------------------------------------------ */
    /*                           Team lifecycle                           */
    /* ------------------------------------------------------------------ */

    /// @notice Commit a token's pool and start its 7-day campaign window.
    ///
    /// @dev One-way and uncancellable by construction: there is no path from
    ///      `Open` back to `Eligible`, and nothing here or below reads the
    ///      price again. A campaign that opens at $120k and immediately
    ///      halves still runs to completion and still pays out — participants
    ///      commit a week of work on the strength of this call, so it has to
    ///      be worth more than the chart it was triggered by.
    /// @dev Team-only, for every path. Eligibility (earned automatically for
    ///      a curve-backed pool, or granted via `markEligible` for a true
    ///      external) is evidence, not authorisation — the admin review is
    ///      the one human gate, and it belongs here for both Path A and
    ///      Path B alike.
    function openCampaign(address token) external onlyTeam {
        Campaign storage campaign = campaigns[token];
        if (campaign.state != State.Eligible) {
            revert WrongState(token, State.Eligible, campaign.state);
        }

        uint64 nowTs = uint64(block.timestamp);
        campaign.state = State.Open;
        campaign.openedAt = nowTs;
        campaign.windowEnds = nowTs + CAMPAIGN_WINDOW;

        emit CampaignOpened(token, campaign.allocation, nowTs, campaign.windowEnds);
    }

    /// @notice Publish the final mindshare leaderboard as a merkle root and
    /// open claiming.
    ///
    /// @dev Only after the window closes. Publishing mid-campaign would fix
    ///      the standings before participants had finished earning them, and
    ///      would leak each entrant's exact allocation while they could still
    ///      act on it.
    function publishResults(address token, bytes32 merkleRoot) external onlyTeam {
        Campaign storage campaign = campaigns[token];
        if (campaign.state != State.Open) {
            revert WrongState(token, State.Open, campaign.state);
        }
        if (block.timestamp < campaign.windowEnds) {
            revert CampaignWindowStillOpen(token, campaign.windowEnds);
        }
        if (merkleRoot == bytes32(0)) revert EmptyRoot();

        uint64 deadline = uint64(block.timestamp) + CLAIM_WINDOW;
        campaign.state = State.Settled;
        campaign.merkleRoot = merkleRoot;
        campaign.claimDeadline = deadline;

        emit ResultsPublished(token, merkleRoot, deadline);
    }

    /* ------------------------------------------------------------------ */
    /*                               Claims                               */
    /* ------------------------------------------------------------------ */

    /// @notice Claim a participant's share against the published root.
    /// @param amount The exact allocation the leaf was built with.
    /// @param proof Merkle proof for `keccak256(abi.encode(account, amount))`.
    function claim(address token, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
        returns (uint256 claimedAmount)
    {
        Campaign storage campaign = campaigns[token];
        if (campaign.state != State.Settled) {
            revert WrongState(token, State.Settled, campaign.state);
        }
        if (block.timestamp > campaign.claimDeadline) {
            revert ClaimWindowClosed(token, campaign.claimDeadline);
        }
        if (hasClaimed[token][msg.sender]) revert AlreadyClaimed(token, msg.sender);

        // Double-hashed leaf: the standard defence against a second-preimage
        // attack where an internal node is replayed as if it were a leaf.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verifyCalldata(proof, campaign.merkleRoot, leaf)) revert InvalidProof();

        // A root is team-published, so a bad one is possible; this makes the
        // pool a hard ceiling rather than trusting the root to sum correctly.
        uint256 remainingPool = campaign.allocation - campaign.claimed;
        if (amount > remainingPool) revert ClaimExceedsPool(amount, remainingPool);

        // ---- Effects ----
        hasClaimed[token][msg.sender] = true;
        campaign.claimed += amount;

        // ---- Interactions ----
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Claimed(token, msg.sender, amount);
        return amount;
    }

    /* ------------------------------------------------------------------ */
    /*                                Burn                                */
    /* ------------------------------------------------------------------ */

    /// @notice Send whatever is left of a token's pool to `0x…dEaD`.
    ///
    /// Permissionless, terminal, and the ONLY non-claim exit in this
    /// contract. Valid in exactly three situations:
    ///
    ///   - the claim window has closed with tokens unclaimed;
    ///   - a campaign was opened but never settled and its window plus the
    ///     full claim window has elapsed (results were never published);
    ///   - the pool was never opened at all and `ABANDON_PERIOD` has passed
    ///     since registration.
    ///
    /// @dev There is deliberately no team-only fast path and no recipient
    ///      parameter. Both would reintroduce exactly the discretion this
    ///      contract exists to remove.
    function burnUnclaimed(address token) external nonReentrant returns (uint256 burned) {
        Campaign storage campaign = campaigns[token];
        State state = campaign.state;

        if (state == State.None || state == State.Burned) {
            revert WrongState(token, State.Registered, state);
        }

        if (state == State.Settled) {
            if (block.timestamp <= campaign.claimDeadline) {
                revert ClaimWindowStillOpen(token, campaign.claimDeadline);
            }
        } else if (state == State.Open) {
            // Opened but never settled — give it the window it would have had
            // if results HAD been published on time, so a late publish is
            // still possible right up until then.
            uint64 burnableAt = campaign.windowEnds + CLAIM_WINDOW;
            if (block.timestamp <= burnableAt) revert NotAbandonedYet(token, burnableAt);
        } else {
            // Registered or Eligible: never opened.
            uint64 burnableAt = campaign.registeredAt + ABANDON_PERIOD;
            if (block.timestamp <= burnableAt) revert NotAbandonedYet(token, burnableAt);
        }

        burned = campaign.allocation - campaign.claimed;
        campaign.state = State.Burned;
        // Mark the pool fully drawn down so `claimed` and `allocation` stay
        // consistent for anything reading them after the fact.
        campaign.claimed = campaign.allocation;

        if (burned > 0) IERC20(token).safeTransfer(BURN_ADDRESS, burned);

        emit Burned(token, burned, state);
    }

    /* ------------------------------------------------------------------ */
    /*                                Views                               */
    /* ------------------------------------------------------------------ */

    function getCampaign(address token) external view returns (Campaign memory) {
        return campaigns[token];
    }

    /// @notice Tokens still available to claim (or burn) for a token.
    function remaining(address token) public view returns (uint256) {
        Campaign storage campaign = campaigns[token];
        return campaign.allocation - campaign.claimed;
    }

    /// @notice When this token becomes eligible if the market cap holds,
    /// or zero if it is not currently above the threshold.
    function qualifiesAt(address token) external view returns (uint64) {
        uint64 aboveSince = campaigns[token].aboveSince;
        return aboveSince == 0 ? 0 : aboveSince + sustainedDuration;
    }
}
