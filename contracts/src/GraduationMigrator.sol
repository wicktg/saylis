// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {BondingCurve} from "./BondingCurve.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {TaxableLaunchToken} from "./TaxableLaunchToken.sol";
import {TokenFeeCollector} from "./TokenFeeCollector.sol";

/// @title GraduationMigrator
/// @notice Seeds a Uniswap V3 pool for a graduated `BondingCurve`'s token,
/// using exactly the assets that curve set aside for this purpose (its
/// remaining real ETH reserve, and the 20% of total supply it never sold —
/// see `BondingCurve.liquidityReserveTokens`), then permanently locks the
/// resulting LP position in that token's immutable `TokenFeeCollector`.
///
/// LOCKED, NOT BURNED — AND WHY THAT CHANGED
/// ----------------------------------------------
/// This used to send the position NFT to `0x000...dEaD`, on the reasoning
/// that burning the LP is the strongest possible proof it can never be
/// pulled. That reasoning was sound; the side effect was not. Uniswap V3
/// accrues swap fees to the POSITION, claimable only via `collect()` by
/// the NFT's owner — so an unowned position earns fees that nobody can
/// ever reach. Every graduated token was silently destroying `poolFee` of
/// all its post-graduation volume.
///
/// `TokenFeeCollector` keeps the guarantee and recovers the income. It has
/// no owner, no setter, no unlock path, and — critically — no
/// `decreaseLiquidity` and no way to transfer or approve the NFT. Those
/// are not admin-gated; they are absent from its bytecode. The liquidity
/// is exactly as locked as it was under the burn address. Only the fees
/// moved from unreachable to reachable. Holding the position in the same
/// contract that already receives the whale sell tax also means one
/// address, one ledger, and one claim per graduated token.
///
/// SCOPE — ONE FUNCTION, ONE JOB
/// --------------------------------
/// This contract does exactly one thing: turn a graduated curve's
/// reserved assets into a permanently locked, full-range Uniswap V3 LP
/// position. It holds no admin key, no pausable switch, no upgrade path, and no
/// balance of its own beyond whatever a `migrate` call is mid-flight
/// processing — consistent with the rest of this system's "no admin,
/// ever" posture for anything that touches user/creator value.
///
/// PERMISSIONLESS TRIGGER, FIXED DESTINATION
/// ----------------------------------------------
/// `migrate` may be called by ANYONE, at any time after a curve
/// graduates — the same permissionless-trigger pattern
/// `BondingCurve.withdrawCreatorFees`/`withdrawProtocolFees` already use.
/// Nobody needs special permission to make migration happen, and doing so
/// carries no redirection risk: the assets involved can only ever end up
/// in the newly-seeded Uniswap V3 pool and then that token's immutable
/// `TokenFeeCollector`, never anywhere else, regardless of who calls
/// `migrate`.
///
/// ONE-TIME, IDEMPOTENT PER CURVE
/// -----------------------------------
/// `migrated[curve]` is a one-way latch, set BEFORE any external call is
/// made (checks-effects-interactions) — a given curve can never be
/// migrated twice. `nonReentrant` additionally blocks any reentrant call
/// into `migrate` at all, for any curve, as defense in depth.
///
/// ATOMICITY
/// -------------
/// Pulling funds from the curve, creating/initializing the pool, minting
/// the LP position, and burning it all happen inside a single external
/// call chain within one transaction. If ANY step reverts — pool
/// creation fails, minting fails, anything in between — the entire
/// transaction unwinds automatically, including the curve's own state
/// changes from `withdrawForMigration`. There is no partial or stuck
/// state possible: migration either fully succeeds, or it is as if it
/// was never attempted.
contract GraduationMigrator is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Thrown by `migrate` if `curve` has already been migrated.
    error AlreadyMigrated();

    /// @notice Thrown by `migrate` if `curve` has not graduated yet.
    error NotGraduated();

    /// @notice Thrown by `migrate` if pool creation unexpectedly returns
    /// the zero address (Uniswap's own position manager would normally
    /// revert first, but this is checked explicitly for clarity).
    error PoolCreationFailed();

    /// @notice Thrown by `migrate` if minting somehow produced zero
    /// liquidity (should be unreachable given non-zero desired amounts,
    /// checked explicitly for defense in depth).
    error ZeroLiquidityMinted();

    /// @notice Thrown by `migrate` when the pair already exists at a price
    /// materially different from the one derived from the curve's real
    /// reserves — i.e. someone pre-created and mispriced it. Clear it with
    /// `alignPoolPrice`, then migrate again.
    error PoolPriceOutOfRange(uint160 actual, uint160 expected);

    /// @notice Thrown by `alignPoolPrice` against a pool that holds real
    /// liquidity. That is a genuine market, not a squat — see that function.
    error PoolAlreadyFunded();

    /// @notice Thrown by `uniswapV3SwapCallback` if a swap ever asks this
    /// contract to pay. `alignPoolPrice` only swaps empty pools, which owe
    /// nothing, so this means the callback was reached some other way.
    error UnexpectedSwapDebt();

    /// @notice Basis-point denominator (100% == 10_000 bps).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice How far `migrate` tolerates an existing pool's price drifting
    /// from the value computed off the curve's own reserves, in bps of
    /// `sqrtPriceX96`. Tight on purpose — on a pool `migrate` itself creates
    /// the two are identical, so any real gap means the pair pre-existed.
    uint256 public constant PRICE_TOLERANCE_BPS = 100; // 1%

    /// @notice The standard, unrecoverable ERC-721/ERC-20 burn address.
    /// No private key exists for it; anything sent here is gone forever.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @dev Uniswap V3's global tick bounds — identical across every
    /// pool/chain, independent of fee tier.
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    /// @notice Canonical Uniswap V3 factory for the chain this is
    /// deployed on.
    IUniswapV3Factory public immutable factory;

    /// @notice Canonical Uniswap V3 NonfungiblePositionManager for the
    /// chain this is deployed on.
    INonfungiblePositionManager public immutable positionManager;

    /// @notice Canonical WETH9 for the chain this is deployed on. The
    /// curve's real ETH reserve is wrapped into this before seeding the
    /// pool, since Uniswap V3 pools are ERC-20/ERC-20 (no native ETH leg).
    IWETH9 public immutable weth9;

    /// @notice The fee tier (hundredths of a bip; e.g. `3000` = 0.3%) the
    /// pool is created/seeded at. Configurable per deployment — must be a
    /// tier `factory` recognizes.
    uint24 public immutable poolFee;

    /// @notice Uniswap SwapRouter02, handed to each `TokenFeeCollector`
    /// and `LiquidityLocker` so they can convert collected fees into ETH.
    address public immutable swapRouter;

    /// @notice The widest valid tick range for `poolFee`'s tick spacing —
    /// true full-range liquidity, computed once at construction from
    /// `factory.feeAmountTickSpacing(poolFee)`.
    int24 public immutable tickLower;
    int24 public immutable tickUpper;

    /// @notice One-way latch: `true` once `migrate` has successfully run
    /// for a given curve. Never reset by anything in this contract.
    mapping(address curve => bool) public migrated;

    /// @notice Emitted once per curve, immediately before the resulting
    /// LP position's NFT is locked in its `LiquidityLocker`.
    /// @param pool The Uniswap V3 pool seeded (created if it didn't
    ///        already exist).
    /// @param tokenId The LP position's NFT id (now permanently locked).
    /// @param liquidity The liquidity amount minted into that position.
    event Migrated(address indexed pool, uint256 indexed tokenId, uint128 liquidity);

    /// @notice Emitted once a graduated token has been pointed at its fee
    /// collector, arming the post-graduation sell tax. Absent for legacy
    /// tokens that predate `TaxableLaunchToken`.
    event PostGraduationFeesWired(
        address indexed token, address indexed pool, address indexed collector
    );

    /// @notice Emitted once the LP position has been handed to its
    /// permanent, ownerless custodian. Replaces the old burn transfer.
    /// @param collector The `TokenFeeCollector` now holding `tokenId` forever.
    event LiquidityLocked(address indexed token, address indexed collector, uint256 indexed tokenId);

    /// @notice How many observation slots each new pool's oracle buffer is
    /// grown to at migration. `TokenFeeCollector` needs a TWAP to price the
    /// protocol's fee slice safely, and a freshly created pool ships with
    /// cardinality 1 — enough for spot, useless for a window. Each slot
    /// holds at most one observation per second, so this bounds how far
    /// back `observe` can reach.
    uint16 public constant OBSERVATION_CARDINALITY = 120;

    /// @notice Emitted when a squatted, unfunded pool was shoved back to the
    /// price migration expects. See `alignPoolPrice`.
    event PoolPriceAligned(address indexed pool, uint160 fromSqrtPriceX96, uint160 toSqrtPriceX96);

    /// @param factory_ Canonical Uniswap V3 factory for this chain.
    /// @param positionManager_ Canonical Uniswap V3 NonfungiblePositionManager
    ///        for this chain.
    /// @param weth9_ Canonical WETH9 for this chain.
    /// @param poolFee_ Fee tier to create/seed the pool at (e.g. `3000`
    ///        for the standard 0.3% tier). Must be a tier `factory_`
    ///        recognizes (`feeAmountTickSpacing(poolFee_) != 0`).
    constructor(
        address factory_,
        address positionManager_,
        address weth9_,
        uint24 poolFee_,
        address swapRouter_
    ) {
        require(factory_ != address(0), "GraduationMigrator: zero factory");
        require(positionManager_ != address(0), "GraduationMigrator: zero position manager");
        require(weth9_ != address(0), "GraduationMigrator: zero weth9");
        require(swapRouter_ != address(0), "GraduationMigrator: zero swap router");

        factory = IUniswapV3Factory(factory_);
        positionManager = INonfungiblePositionManager(positionManager_);
        weth9 = IWETH9(weth9_);
        poolFee = poolFee_;
        swapRouter = swapRouter_;

        int24 spacing = factory.feeAmountTickSpacing(poolFee_);
        require(spacing > 0, "GraduationMigrator: unknown fee tier");

        // Widest valid full-range ticks for this spacing. Solidity's
        // integer division truncates toward zero, which is exactly the
        // rounding this needs: e.g. for spacing 60, -887272/60 = -14787
        // (not -14788), giving tickLower = -887220 — the highest-magnitude
        // multiple of 60 that still satisfies tickLower >= MIN_TICK.
        // Symmetric truncation gives tickUpper = 887220 <= MAX_TICK.
        tickLower = (MIN_TICK / spacing) * spacing;
        tickUpper = (MAX_TICK / spacing) * spacing;
    }

    /// @notice Migrate `curve`'s remaining real ETH reserve and reserved
    /// liquidity tokens into a fresh full-range Uniswap V3 position, then
    /// permanently burn that position's LP NFT. Permissionless — anyone
    /// may call this once `curve` has graduated.
    /// @param curve The graduated `BondingCurve` to migrate.
    /// @return pool The Uniswap V3 pool seeded (created if it didn't
    ///         already exist).
    /// @return tokenId The (now-burned) LP position's NFT id.
    /// @return liquidity The liquidity amount minted into that position.
    function migrate(BondingCurve curve)
        external
        nonReentrant
        returns (address pool, uint256 tokenId, uint128 liquidity)
    {
        if (migrated[address(curve)]) revert AlreadyMigrated();
        if (!curve.graduated()) revert NotGraduated();

        // ---- Effects (this contract's own one-way latch) ----
        migrated[address(curve)] = true;

        // ---- Interactions ----

        // Pulls the curve's real ETH reserve + reserved tokens to this
        // contract. `curve` enforces its own one-way latch
        // (`migrationExecuted`) and restricts this call to `msg.sender ==
        // migrator` (this contract), so it can only ever succeed once.
        (uint256 ethAmount, uint256 tokenAmount) = curve.withdrawForMigration();

        address tokenAddr = address(curve.token());
        weth9.deposit{value: ethAmount}();

        bool tokenIsToken0 = tokenAddr < address(weth9);
        address token0 = tokenIsToken0 ? tokenAddr : address(weth9);
        address token1 = tokenIsToken0 ? address(weth9) : tokenAddr;
        uint256 amount0Desired = tokenIsToken0 ? tokenAmount : ethAmount;
        uint256 amount1Desired = tokenIsToken0 ? ethAmount : tokenAmount;

        uint160 sqrtPriceX96 = _sqrtPriceX96(amount0Desired, amount1Desired);

        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, poolFee, sqrtPriceX96);
        if (pool == address(0)) revert PoolCreationFailed();

        // `createAndInitializePoolIfNecessary` is a NO-OP against a pool that
        // already exists — it does not re-initialise the price. Anyone may
        // therefore create this pair at an arbitrary price in the window
        // between graduation (a public event) and this call (permissionless,
        // so typically a keeper minutes-to-an-hour later), and without this
        // check the mint below would seed the curve's entire raise at that
        // attacker-chosen price, into a position whose LP NFT is then burned
        // — locking the mispricing in permanently for them to arbitrage.
        //
        // So: refuse to seed a pool that is not at the price this contract
        // just derived from the real reserves. Reverting here unwinds the
        // whole migration atomically (including the curve's own
        // `withdrawForMigration`), leaving everything retryable rather than
        // half-done.
        //
        // That deliberately cannot become a permanent block: `alignPoolPrice`
        // below lets ANYONE shove an unfunded squatted pool back to the right
        // price, after which `migrate` simply succeeds. See that function.
        _requirePoolPriceWithinTolerance(pool, sqrtPriceX96);

        IERC20(token0).forceApprove(address(positionManager), amount0Desired);
        IERC20(token1).forceApprove(address(positionManager), amount1Desired);

        (tokenId, liquidity,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: poolFee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                // This is a one-time bootstrap deposit at a price this
                // contract itself just derived from these exact amounts
                // (or, for a pre-existing pool, whatever partial fill the
                // existing price implies) — not a user-facing swap with
                // an external expectation to protect, so 0 is the correct
                // floor here rather than a meaningful slippage guard.
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        if (liquidity == 0) revert ZeroLiquidityMinted();

        // Clear the approvals the mint did not consume, so this contract
        // never leaves a standing allowance over a balance it still holds.
        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);

        _sweepLeftovers(tokenAddr, curve.protocolTreasury());

        emit Migrated(pool, tokenId, liquidity);

        // ---- Post-graduation fee capture ----
        //
        // Deliberately AFTER the mint above. Wiring the pair arms the
        // token's sell tax, and seeding liquidity is itself a transfer
        // INTO the pool — i.e. exactly the shape of a taxed sell. Doing
        // this before the mint would skim tax off the migration itself.
        //
        // Tokens predating this feature have no `setAmmPair`, so the call
        // is best-effort: a failure leaves the (already complete and
        // valid) migration untouched rather than bricking it.
        address collector = _wirePostGraduationFees(curve, tokenAddr, pool, tokenId);

        // Give the pool's oracle enough history for the collector's TWAP
        // check to be answerable. Permissionless and best-effort — a pool
        // that rejects this is merely one whose protocol fee slice waits
        // for better conditions, which must not unwind a valid migration.
        try IUniswapV3Pool(pool).increaseObservationCardinalityNext(OBSERVATION_CARDINALITY) {}
            catch {}

        // Lock: the collector has no unlock path and cannot decrease
        // liquidity, so this transfer is as final as the burn it replaced
        // — but the position's fees stay claimable.
        emit LiquidityLocked(tokenAddr, collector, tokenId);
        positionManager.safeTransferFrom(address(this), collector, tokenId);


    }

    /// @notice Drag a squatted, UNFUNDED pool back to the price `migrate`
    /// would initialise it at, so a griefer cannot permanently block a
    /// graduated token's migration by pre-creating its pair at a nonsense
    /// price.
    ///
    /// @dev Permissionless, and safe to be: it only ever moves the price
    /// TOWARD the value this contract independently derives from `curve`'s
    /// own real reserves — the caller supplies nothing but gas and cannot
    /// influence the destination.
    ///
    /// Restricted to pools with zero liquidity, which is exactly the griefing
    /// case (creating and initialising a pool is nearly free; funding one at
    /// a bad price is not). A pool that someone has actually funded is a real
    /// market, and moving its price is ordinary arbitrage that this contract
    /// has no business doing with assets it does not own — that case corrects
    /// itself through normal arbitrage instead.
    ///
    /// With no liquidity to cross, V3 walks `sqrtPriceX96` straight to the
    /// limit and settles zero tokens, so this costs nothing but gas.
    function alignPoolPrice(BondingCurve curve) external nonReentrant returns (uint160 sqrtPriceX96) {
        if (migrated[address(curve)]) revert AlreadyMigrated();
        if (!curve.graduated()) revert NotGraduated();

        address tokenAddr = address(curve.token());
        bool tokenIsToken0 = tokenAddr < address(weth9);
        address token0 = tokenIsToken0 ? tokenAddr : address(weth9);
        address token1 = tokenIsToken0 ? address(weth9) : tokenAddr;

        address pool = factory.getPool(token0, token1, poolFee);
        if (pool == address(0)) revert PoolCreationFailed();
        if (IUniswapV3Pool(pool).liquidity() != 0) revert PoolAlreadyFunded();

        // The same amounts `migrate` will use, read from the curve now. The
        // ETH figure mirrors `withdrawForMigration`'s own cap so the target
        // matches what migration will actually deposit.
        uint256 tokenAmount = curve.liquidityReserveTokens();
        uint256 owed = curve.creatorFeesOwed() + curve.protocolFeesOwed();
        uint256 balance = address(curve).balance;
        uint256 spendable = balance > owed ? balance - owed : 0;
        uint256 reserve = curve.realEthReserve();
        uint256 ethAmount = reserve < spendable ? reserve : spendable;

        uint256 amount0Desired = tokenIsToken0 ? tokenAmount : ethAmount;
        uint256 amount1Desired = tokenIsToken0 ? ethAmount : tokenAmount;
        sqrtPriceX96 = _sqrtPriceX96(amount0Desired, amount1Desired);

        (uint160 current,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (current == sqrtPriceX96) return sqrtPriceX96;

        // Direction is whichever way walks price toward the target. A tiny
        // `amountSpecified` is irrelevant — with zero liquidity the swap
        // stops at the limit having exchanged nothing.
        IUniswapV3Pool(pool).swap(address(this), current > sqrtPriceX96, 1, sqrtPriceX96, "");

        emit PoolPriceAligned(pool, current, sqrtPriceX96);
    }

    /// @notice Uniswap V3 swap callback. Only ever reached via
    /// `alignPoolPrice`, which swaps against a zero-liquidity pool, so both
    /// deltas are always <= 0 (nothing owed). Anything else means this was
    /// invoked in a context this contract never initiates, and it refuses to
    /// part with a balance it is mid-migration on.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external view {
        if (amount0Delta > 0 || amount1Delta > 0) revert UnexpectedSwapDebt();
    }

    /// @dev Reverts unless `pool`'s spot price is within `PRICE_TOLERANCE_BPS`
    /// of `expected`. Compared on `sqrtPrice` rather than price, so the
    /// tolerance is roughly half as wide in price terms — deliberately
    /// tight, since the expected value is not a market observation but a
    /// figure this contract computed moments ago from the exact amounts it
    /// is about to deposit. On a pool this call just created, the two match
    /// to the wei.
    function _requirePoolPriceWithinTolerance(address pool, uint160 expected) private view {
        (uint160 actual,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (actual == expected) return;

        uint256 diff = actual > expected ? actual - expected : expected - actual;
        if (diff * BPS_DENOMINATOR > uint256(expected) * PRICE_TOLERANCE_BPS) {
            revert PoolPriceOutOfRange(actual, expected);
        }
    }

    /// @dev A full-range mint almost never consumes both sides exactly:
    /// Uniswap takes whatever ratio the pool's price implies and leaves the
    /// remainder with the minter. On a freshly-created pool — the intended
    /// path, where this contract picked the initial price from these exact
    /// amounts — that remainder is rounding dust. But
    /// `createAndInitializePoolIfNecessary` is a no-op against a pool that
    /// ALREADY exists, so anyone may pre-create the pair at an arbitrary
    /// price before `migrate` runs, and the mint then consumes only a
    /// sliver of one side.
    ///
    /// Either way the leftovers must not simply sit here: this contract has
    /// no owner, no rescue path, and no other function that can move a
    /// balance, so anything left behind is stranded permanently and silently.
    /// Sweeping makes the outcome explicit and matches where each asset was
    /// already headed — launch tokens follow the LP position to the burn
    /// address (they are supply that was never sold and is now unbacked),
    /// and unspent ETH goes back to the curve's own protocol treasury rather
    /// than evaporating.
    ///
    /// This does not FIX the pre-created-pool case — see the audit report;
    /// a mispriced pool is still a mispriced pool — it only stops that case
    /// from also destroying the assets it failed to deposit.
    function _sweepLeftovers(address tokenAddr, address treasury) private {
        uint256 leftoverToken = IERC20(tokenAddr).balanceOf(address(this));
        if (leftoverToken > 0) {
            IERC20(tokenAddr).safeTransfer(BURN_ADDRESS, leftoverToken);
        }

        uint256 leftoverWeth = IERC20(address(weth9)).balanceOf(address(this));
        if (leftoverWeth > 0) {
            weth9.withdraw(leftoverWeth);
        }

        uint256 leftoverEth = address(this).balance;
        if (leftoverEth > 0) {
            // Best-effort: a treasury that rejects ETH must not be able to
            // unwind an otherwise-complete migration.
            (bool sent,) = treasury.call{value: leftoverEth}("");
            sent; // result deliberately unused — see above
        }
    }

    /// @dev Deploys this token's fee collector and points the token at it,
    /// so the whale sell tax keeps applying to every trade on the graduated
    /// pool — from any router or frontend — for the rest of the token's
    /// life. Silently skipped for non-taxable legacy tokens.
    function _wirePostGraduationFees(
        BondingCurve curve,
        address tokenAddr,
        address pool,
        uint256 tokenId_
    ) private returns (address)
    {
        TokenFeeCollector collector = new TokenFeeCollector(
            tokenAddr,
            curve.creator(),
            curve.protocolTreasury(),
            swapRouter,
            address(weth9),
            poolFee,
            address(positionManager),
            tokenId_,
            pool,
            curve.referralVault()
        );

        try TaxableLaunchToken(tokenAddr).setAmmPair(pool, address(collector)) {
            emit PostGraduationFeesWired(tokenAddr, pool, address(collector));
        } catch {
            // Legacy (non-taxable) token — no sell tax to route. The
            // collector still holds the LP position and still pays out its
            // fees; only the whale-tax stream is absent.
        }
        return address(collector);
    }

    /// @dev sqrtPriceX96 = sqrt(amount1/amount0) * 2**96, computed via
    /// OpenZeppelin's overflow-safe 512-bit `Math.mulDiv` (the
    /// intermediate `amount1 * 2**192` can vastly exceed 256 bits for
    /// realistic reserve sizes; `mulDiv` handles that without silently
    /// wrapping) followed by `Math.sqrt`. If the resulting price falls
    /// outside Uniswap's valid `MIN_SQRT_RATIO`/`MAX_SQRT_RATIO` bounds,
    /// pool initialization itself reverts — that failure propagates
    /// naturally and reverts this entire migration atomically.
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "GraduationMigrator: zero reserve");
        uint256 ratioX192 = Math.mulDiv(amount1, 2 ** 192, amount0);
        return uint160(Math.sqrt(ratioX192));
    }

    /// @notice Accepts the one-time native-ETH push from
    /// `BondingCurve.withdrawForMigration`, immediately wrapped into WETH9
    /// inside the same `migrate` call.
    receive() external payable {}
}
