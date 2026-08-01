// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {BondingCurve} from "./BondingCurve.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {TaxableLaunchToken} from "./TaxableLaunchToken.sol";
import {TokenFeeCollector} from "./TokenFeeCollector.sol";

/// @title GraduationMigrator
/// @notice Seeds a Uniswap V3 pool for a graduated `BondingCurve`'s token,
/// using exactly the assets that curve set aside for this purpose (its
/// remaining real ETH reserve, and the 20% of total supply it never sold —
/// see `BondingCurve.liquidityReserveTokens`), then permanently burns the
/// resulting LP position by sending its NFT to the standard
/// `0x000...dEaD` burn address. No custom lock contract, no
/// owner-controlled unlock path anywhere in this contract — burning the
/// LP NFT IS the lock, forever, exactly matching industry-standard
/// "burn the LP" practice.
///
/// SCOPE — ONE FUNCTION, ONE JOB
/// --------------------------------
/// This contract does exactly one thing: turn a graduated curve's
/// reserved assets into a burned, full-range Uniswap V3 LP position. It
/// holds no admin key, no pausable switch, no upgrade path, and no
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
/// in the newly-seeded Uniswap V3 pool and then the burn address, never
/// anywhere else, regardless of who calls `migrate`.
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

    /// @notice Uniswap SwapRouter02, handed to each `TokenFeeCollector` so
    /// it can convert collected tax into ETH.
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
    /// LP position's NFT is sent to `BURN_ADDRESS`.
    /// @param pool The Uniswap V3 pool seeded (created if it didn't
    ///        already exist).
    /// @param tokenId The LP position's NFT id (now permanently burned).
    /// @param liquidity The liquidity amount minted into that position.
    event Migrated(address indexed pool, uint256 indexed tokenId, uint128 liquidity);

    /// @notice Emitted once a graduated token has been pointed at its fee
    /// collector, arming the post-graduation sell tax. Absent for legacy
    /// tokens that predate `TaxableLaunchToken`.
    event PostGraduationFeesWired(
        address indexed token, address indexed pool, address indexed collector
    );

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
        _wirePostGraduationFees(curve, tokenAddr, pool);

        // Burn: no lock contract, no unlock path — this transfer is final.
        positionManager.safeTransferFrom(address(this), BURN_ADDRESS, tokenId);
    }

    /// @dev Deploys this token's fee collector and points the token at it,
    /// so the whale sell tax keeps applying to every trade on the graduated
    /// pool — from any router or frontend — for the rest of the token's
    /// life. Silently skipped for non-taxable legacy tokens.
    function _wirePostGraduationFees(BondingCurve curve, address tokenAddr, address pool)
        private
    {
        TokenFeeCollector collector = new TokenFeeCollector(
            tokenAddr,
            curve.creator(),
            curve.protocolTreasury(),
            swapRouter,
            address(weth9),
            poolFee
        );

        try TaxableLaunchToken(tokenAddr).setAmmPair(pool, address(collector)) {
            emit PostGraduationFeesWired(tokenAddr, pool, address(collector));
        } catch {
            // Legacy (non-taxable) token — nothing to wire. The collector
            // is left unused and inert; it holds no funds and has no
            // authority over anything.
        }
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
