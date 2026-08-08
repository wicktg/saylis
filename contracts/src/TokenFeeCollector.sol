// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {IReferralVault} from "./interfaces/IReferralVault.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";

/// @title TokenFeeCollector
/// @notice Everything a graduated token earns, in one place. It is the
///         permanent custodian of the token's Uniswap V3 LP position, the
///         recipient of its post-graduation whale sell tax, and the
///         pull-payment ledger both are paid out of.
///
/// @dev WHY IT HOLDS THE LP POSITION INSTEAD OF BURNING IT
///
/// Migration used to send the position NFT to `0x000...dEaD`, on the
/// reasoning that burning the LP is the strongest possible proof the
/// liquidity can never be pulled. That part was true and is still true
/// here. What it also did, silently, was destroy the pool's fee income:
/// Uniswap V3 accrues swap fees to the POSITION, and the only way to
/// realise them is `collect()`, which the position manager gates on owning
/// the NFT. An address with no private key can never call it, so every
/// graduated token was permanently burning `poolFee` of all its
/// post-graduation volume.
///
/// This contract keeps the lock and recovers the income by being a strict
/// subset of an owner: it can call `collect`, and that is the entire
/// surface. It cannot decrease liquidity, cannot transfer or approve the
/// NFT, and cannot be told to. Those are not admin-gated — they are absent
/// from the bytecode, and the position-manager interface this compiles
/// against does not even declare `decreaseLiquidity`. There is no owner, no
/// setter, no upgrade path, no rescue function, and no `delegatecall`.
///
/// @dev THE TWO FEE STREAMS, AND WHY THEY PAY DIFFERENTLY
///
/// 1. LP FEES. A V3 position earns in BOTH pool assets — V3 takes its fee
///    from each swap's INPUT, so buys accrue WETH and sells accrue token.
///    Split 75/25, matching `BondingCurve.CREATOR_SHARE_BPS` exactly.
///
/// 2. WHALE SELL TAX. Charged in tokens by `TaxableLaunchToken`'s transfer
///    hook, which is the only asset present at transfer time. 100% to the
///    creator — no protocol cut, no referral cut — exactly matching how the
///    curve treats it before graduation.
///
/// @dev WHY THE CREATOR IS PAID IN KIND AND THE PROTOCOL IS NOT
///
/// The obvious implementation sells every token the moment it arrives and
/// pays everyone in ETH. That is a permanent, one-directional sell into the
/// token's own pool — roughly 1% of all sell volume, recycled straight back
/// as more selling, forever. The creator does not need that: they can hold
/// the tokens and choose their own moment, so `creatorTokensOwed` is paid
/// in kind and the protocol never trades on their behalf.
///
/// The protocol's slice cannot be handled the same way. The treasury is a
/// 901-byte contract with exactly two functions, `owner()` and
/// `withdraw(address,uint256)` — it moves ETH and has no ERC-20 path at
/// all, so any token sent there is stuck permanently. So the protocol's
/// 25% of the token side is the ONLY thing this contract ever sells, and
/// it is a quarter of one percent of sell volume rather than all of it.
///
/// @dev WHY THE SWAP NEEDS NO TRUSTED CALLER
///
/// A swap needs a slippage bound, and a caller-supplied bound is worthless
/// on a permissionless function: an attacker calls with a bound of zero
/// inside their own sandwich. The usual fix is to restrict the caller. This
/// contract derives the bound on-chain instead — see `_guardedMinimumOut` —
/// so there is nothing for a caller to weaken and `collect` can stay open
/// to anyone, like every other trigger in this system.
contract TokenFeeCollector is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Creator's share of LP fees: 75%, matching
    ///         `BondingCurve.CREATOR_SHARE_BPS` exactly. A creator earns
    ///         the same 75% of every trade fee their token generates, on
    ///         the curve and on the pool, for the token's whole life.
    uint256 public constant CREATOR_SHARE_BPS = 7_500;

    /// @notice Referral cut, in bps of the creator's share — identical to
    ///         `BondingCurve.REFERRAL_BPS`, so a referral keeps paying
    ///         after the token graduates.
    ///
    /// @dev ETH SIDE ONLY. `ReferralVault.creditReferral` is `payable` and
    ///      pools a referrer's earnings across every token they have ever
    ///      referred; it has no ERC-20 ledger, so there is nowhere to
    ///      credit a token-denominated cut. Carving one out of
    ///      `creatorTokensOwed` would mean building a second per-referrer
    ///      accounting system inside this contract for what is 5% of one
    ///      side of one of two streams. The referrer takes 5% of the
    ///      creator's ETH and nothing from their tokens.
    uint256 public constant REFERRAL_BPS = 500;

    /// @notice Window for the manipulation check on the protocol's swap.
    ///
    /// @dev Short on purpose. A V3 pool answers `observe` only as far back
    ///      as its observation ring buffer reaches, and `GraduationMigrator`
    ///      grows that buffer to `OBSERVATION_CARDINALITY` slots at
    ///      migration. Each slot holds at most one observation per second,
    ///      so the queryable history is bounded by the buffer size — asking
    ///      for more than it holds simply reverts, and the swap is skipped.
    ///      A longer window is not automatically safer here; an unanswerable
    ///      one is strictly worse than a short one that works.
    uint32 public constant TWAP_WINDOW = 60;

    /// @notice How far spot may sit from the TWAP before the swap is
    ///         abandoned, in ticks. 2000 ticks is ~22%.
    ///
    /// @dev WHY SO WIDE, AND WHY SPOT IS STILL THE QUOTE BASIS
    ///
    /// This started at 100 ticks (~1%), which is a sensible bound for a
    /// deep pool and completely wrong for this one. A graduated curve seeds
    /// roughly 4 ETH of liquidity into an asset that is volatile by design;
    /// a single ordinary trade moves the price several percent, and a
    /// 60-second average lags it badly. At 1% the check refused essentially
    /// every honest moment, which does not lose money — the slice is
    /// carried, see `_sellProtocolSlice` — but does mean the protocol's
    /// share of the token side would convert approximately never.
    ///
    /// The obvious alternative, quoting from the TWAP tick instead of spot,
    /// is worse here for the same reason. A lagging average used as
    /// `amountOutMinimum` reverts the swap outright whenever price fell
    /// during the window, and under-protects whenever it rose. Spot is what
    /// the pool will actually pay; the TWAP's job is only to answer whether
    /// that spot is real. So spot stays the basis and this stays a sanity
    /// check — it just has to be a sanity check calibrated for a memecoin
    /// rather than for WETH/USDC.
    ///
    /// 2000 ticks still refuses what it exists to refuse: a profitable
    /// sandwich of this slice needs a large dislocation, and a 2x move is
    /// ~6900 ticks. The sum being protected is small on purpose — 25% of
    /// the token-side fee, i.e. 0.25% of sell volume — while an attacker
    /// moving the pool that far pays the 1% tier twice on a far larger
    /// trade to set it up.
    ///
    /// This is a judgement call with margin, not a derived figure. Once
    /// real tokens have graduated, measure the deviations they actually
    /// produce and retune; it is a constant, so that costs a migrator
    /// redeploy rather than a redesign.
    int24 public constant MAX_TICK_DEVIATION = 2_000;

    /// @notice Slack below the (TWAP-validated) spot quote, in bps, to
    ///         absorb the price impact of the sale itself.
    uint256 public constant SWAP_SLIPPAGE_BPS = 100;

    /// @dev `collect`'s amountMax fields are uint128; Uniswap clamps them
    ///      to whatever the position actually has owed.
    uint128 private constant COLLECT_ALL = type(uint128).max;

    IERC20 public immutable token;
    address public immutable creator;
    address public immutable protocolTreasury;
    INonfungiblePositionManager public immutable positionManager;
    /// @notice The LP position this contract holds, forever.
    uint256 public immutable tokenId;
    IUniswapV3Pool public immutable pool;
    ISwapRouter02 public immutable swapRouter;
    IWETH9 public immutable weth9;
    uint24 public immutable poolFee;
    /// @dev Fixes which side of the pair is the token, once, so every
    ///      later read is a comparison against a cached bool.
    bool public immutable tokenIsToken0;

    /// @notice The protocol-wide `ReferralVault`, or zero to opt out.
    address public immutable referralVault;
    /// @notice The creator's permanent referrer, resolved ONCE here and
    ///         cached forever — exactly as `BondingCurve` does it.
    address public immutable referrer;

    /// @notice Pull-payment balances, mirroring BondingCurve's pattern.
    uint256 public creatorFeesOwed;
    uint256 public protocolFeesOwed;

    /// @notice Tokens owed to the creator: their 75% of the LP token side,
    ///         plus 100% of the whale sell tax. Withdrawn as tokens.
    uint256 public creatorTokensOwed;

    /// @notice The protocol's token slice, awaiting conversion to ETH.
    ///         Non-zero only when the last `collect` found the pool's price
    ///         untrustworthy and declined to sell into it.
    uint256 public protocolTokensPending;

    event FeesCollected(
        uint256 lpTokens, uint256 lpWeth, uint256 sellTax, uint256 protocolEthFromSwap
    );
    event CreatorFeesWithdrawn(uint256 amount);
    event ProtocolFeesWithdrawn(uint256 amount);
    event CreatorTokensWithdrawn(uint256 amount);
    /// @notice The protocol's slice could not be sold safely this round and
    ///         is being carried. Emitted instead of reverting, so a
    ///         manipulated or under-observed pool never blocks the creator.
    event ProtocolSwapSkipped(uint256 tokensPending);

    error ZeroAddress();
    error NothingCollected();
    error NothingOwed();
    error EthTransferFailed();
    /// @notice An ERC-721 other than this contract's own position was sent
    ///         here. Accepting it would strand it permanently.
    error UnexpectedPosition();

    constructor(
        address token_,
        address creator_,
        address protocolTreasury_,
        address swapRouter_,
        address weth9_,
        uint24 poolFee_,
        address positionManager_,
        uint256 tokenId_,
        address pool_,
        address referralVault_
    ) {
        if (
            token_ == address(0) || creator_ == address(0) || protocolTreasury_ == address(0)
                || swapRouter_ == address(0) || weth9_ == address(0) || positionManager_ == address(0)
                || pool_ == address(0)
        ) revert ZeroAddress();

        token = IERC20(token_);
        creator = creator_;
        protocolTreasury = protocolTreasury_;
        swapRouter = ISwapRouter02(swapRouter_);
        weth9 = IWETH9(weth9_);
        poolFee = poolFee_;
        positionManager = INonfungiblePositionManager(positionManager_);
        tokenId = tokenId_;
        pool = IUniswapV3Pool(pool_);
        tokenIsToken0 = token_ < weth9_;

        referralVault = referralVault_;
        referrer = referralVault_ == address(0)
            ? address(0)
            : IReferralVault(referralVault_).getReferrer(creator_);
    }

    /// @notice Claims the LP position's accrued fees, sweeps any whale sell
    ///         tax that has arrived since last time, and credits everything
    ///         to its pull-payment balances.
    ///
    /// @dev Permissionless. Every destination and every split is fixed at
    ///      construction, so who calls this cannot change where a single wei
    ///      goes — the same reasoning that makes `withdrawCreatorFees` open
    ///      to anyone. The one number a caller might have wanted to
    ///      influence, the swap's slippage bound, is computed on-chain in
    ///      `_guardedMinimumOut` rather than passed in.
    ///
    /// @return ethCredited Total ETH credited across both parties.
    /// @return tokensCredited Tokens credited to the creator.
    function collect() external nonReentrant returns (uint256 ethCredited, uint256 tokensCredited) {
        // ---- 1. Realise the position's fees ----
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: COLLECT_ALL,
                amount1Max: COLLECT_ALL
            })
        );
        (uint256 lpTokens, uint256 lpWeth) =
            tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);

        // ---- 2. LP token side: creator in kind, protocol queued for sale ----
        if (lpTokens > 0) {
            uint256 creatorCut = (lpTokens * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
            creatorTokensOwed += creatorCut;
            // Remainder, so the split is exhaustive to the wei.
            protocolTokensPending += lpTokens - creatorCut;
        }

        // ---- 3. Whale sell tax: whatever is here and not already spoken for ----
        //
        // The tax arrives by plain transfer from the token's `_update`
        // hook, with no callback and no event this contract can hook, so
        // there is no moment at which it could be booked directly. Instead
        // it is inferred: every token in this contract that is not already
        // owed to someone got here as tax. Because it is measured rather
        // than reported, a stray transfer or airdrop is treated as tax too
        // — which credits it to the creator rather than stranding it.
        uint256 balance = token.balanceOf(address(this));
        uint256 spokenFor = creatorTokensOwed + protocolTokensPending;
        uint256 sellTax = balance > spokenFor ? balance - spokenFor : 0;
        if (sellTax > 0) creatorTokensOwed += sellTax;

        // ---- 4. Sell the protocol's slice, if the pool can be trusted ----
        uint256 protocolEthFromSwap;
        if (protocolTokensPending > 0) {
            protocolEthFromSwap = _sellProtocolSlice();
        }

        // ---- 5. Credit the ETH ----
        if (lpWeth > 0) weth9.withdraw(lpWeth);

        if (lpTokens == 0 && lpWeth == 0 && sellTax == 0 && protocolEthFromSwap == 0) {
            revert NothingCollected();
        }

        // The swapped ETH is already the protocol's own share; only the
        // WETH side is split.
        protocolFeesOwed += protocolEthFromSwap;
        ethCredited = protocolEthFromSwap;
        if (lpWeth > 0) ethCredited += lpWeth;
        tokensCredited = sellTax + (lpTokens * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;

        emit FeesCollected(lpTokens, lpWeth, sellTax, protocolEthFromSwap);

        // Interactions last: `_creditEth` pays the referral vault.
        if (lpWeth > 0) _creditEth(lpWeth);
    }

    /// @dev Splits an ETH amount 75/25 and pays the referrer out of the
    ///      creator's share only — never the protocol's. Mirrors
    ///      `BondingCurve`'s accrual exactly.
    function _creditEth(uint256 amount) private {
        uint256 creatorFee = (amount * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        // Remainder, so creator + protocol is always exactly `amount`.
        uint256 protocolFee = amount - creatorFee;
        uint256 referralCut =
            referrer != address(0) ? (creatorFee * REFERRAL_BPS) / BPS_DENOMINATOR : 0;

        creatorFeesOwed += creatorFee - referralCut;
        protocolFeesOwed += protocolFee;

        if (referralCut > 0) {
            IReferralVault(referralVault).creditReferral{value: referralCut}(referrer);
        }
    }

    /// @dev Sells `protocolTokensPending` for WETH, unwraps it, and returns
    ///      the ETH. Returns 0 and carries the balance forward if the pool
    ///      cannot currently be priced safely or the swap fails — a bad
    ///      moment for the protocol's slice must never block the creator's.
    function _sellProtocolSlice() private returns (uint256 ethOut) {
        uint256 amountIn = protocolTokensPending;
        uint256 minOut = _guardedMinimumOut(amountIn);
        if (minOut == 0) {
            emit ProtocolSwapSkipped(amountIn);
            return 0;
        }

        // Cleared here rather than after the swap so a reentrant path can
        // never see the same tokens queued twice.
        protocolTokensPending = 0;
        token.forceApprove(address(swapRouter), amountIn);

        try swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(token),
                tokenOut: address(weth9),
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 wethOut) {
            token.forceApprove(address(swapRouter), 0);
            weth9.withdraw(wethOut);
            return wethOut;
        } catch {
            // Put it back and leave no allowance standing.
            token.forceApprove(address(swapRouter), 0);
            protocolTokensPending = amountIn;
            emit ProtocolSwapSkipped(amountIn);
            return 0;
        }
    }

    /// @notice The minimum WETH the protocol's slice must fetch, derived
    ///         entirely on-chain, or 0 to mean "do not trade right now".
    ///
    /// @dev The bound is spot, discounted by `SWAP_SLIPPAGE_BPS`, and spot
    ///      is only used at all once it has been checked against the pool's
    ///      own `TWAP_WINDOW` oracle. Ticks are compared directly rather
    ///      than converted to prices first — a tick IS the log of the
    ///      price, so a fixed tick gap is a fixed percentage gap, and it
    ///      spares this contract a vendored `TickMath`.
    ///
    ///      Returns 0 rather than reverting whenever the pool cannot answer
    ///      (a young pool whose observation buffer does not yet reach back
    ///      `TWAP_WINDOW` seconds) or answers suspiciously. Skipping is
    ///      always safe here: the tokens keep, and `collect` is callable
    ///      again the moment conditions are normal.
    function _guardedMinimumOut(uint256 amountIn) public view returns (uint256) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_WINDOW;
        secondsAgos[1] = 0;

        int24 twapTick;
        try pool.observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
            twapTick =
                int24((tickCumulatives[1] - tickCumulatives[0]) / int56(uint56(TWAP_WINDOW)));
        } catch {
            return 0;
        }

        (uint160 sqrtPriceX96, int24 spotTick,,,,,) = pool.slot0();
        if (sqrtPriceX96 == 0) return 0;

        int24 deviation = spotTick > twapTick ? spotTick - twapTick : twapTick - spotTick;
        if (deviation > MAX_TICK_DEVIATION) return 0;

        // price = (sqrtPriceX96 / 2**96)**2, squared in two `mulDiv` steps
        // because sqrtPriceX96**2 overflows uint256.
        uint256 sqrtP = uint256(sqrtPriceX96);
        uint256 expectedOut;
        if (tokenIsToken0) {
            // WETH (token1) per token (token0): multiply by the price.
            expectedOut = Math.mulDiv(Math.mulDiv(amountIn, sqrtP, 1 << 96), sqrtP, 1 << 96);
        } else {
            // WETH is token0: divide by the price instead.
            expectedOut = Math.mulDiv(Math.mulDiv(amountIn, 1 << 96, sqrtP), 1 << 96, sqrtP);
        }
        if (expectedOut == 0) return 0;

        return (expectedOut * (BPS_DENOMINATOR - SWAP_SLIPPAGE_BPS)) / BPS_DENOMINATOR;
    }

    /// @notice Pull the creator's accrued ETH. Permissionless trigger,
    ///         fixed destination.
    function withdrawCreatorFees() external nonReentrant {
        uint256 amount = creatorFeesOwed;
        if (amount == 0) revert NothingOwed();
        creatorFeesOwed = 0;
        emit CreatorFeesWithdrawn(amount);
        (bool ok,) = payable(creator).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Pull the protocol's accrued ETH.
    function withdrawProtocolFees() external nonReentrant {
        uint256 amount = protocolFeesOwed;
        if (amount == 0) revert NothingOwed();
        protocolFeesOwed = 0;
        emit ProtocolFeesWithdrawn(amount);
        (bool ok,) = payable(protocolTreasury).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Pull the creator's accrued tokens — their share of the LP
    ///         token side plus the whole whale sell tax.
    ///
    /// @dev There is deliberately no protocol equivalent. The treasury
    ///      cannot hold ERC-20s, so the protocol's tokens are converted in
    ///      `collect` and paid as ETH; a `withdrawProtocolTokens` would only
    ///      ever move value somewhere it could not be retrieved from.
    function withdrawCreatorTokens() external nonReentrant {
        uint256 amount = creatorTokensOwed;
        if (amount == 0) revert NothingOwed();
        creatorTokensOwed = 0;
        emit CreatorTokensWithdrawn(amount);
        token.safeTransfer(creator, amount);
    }

    /// @dev Accepts the position NFT from `GraduationMigrator`, and nothing
    ///      else. Any other ERC-721 sent here would be as unrecoverable as
    ///      it is in the burn address — there is no transfer path out — so
    ///      it is rejected at the door rather than silently swallowed.
    function onERC721Received(address, address, uint256 id, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(positionManager) || id != tokenId) revert UnexpectedPosition();
        return this.onERC721Received.selector;
    }

    /// @dev Accepts ETH from the WETH unwraps in `collect`.
    receive() external payable {}
}
