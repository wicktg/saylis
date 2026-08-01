// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";

/// @title TokenFeeCollector
/// @notice Receives post-graduation whale sell tax (paid in tokens by
///         `TaxableLaunchToken`), converts it to ETH, and splits it between
///         the creator and the protocol treasury via the same pull-payment
///         pattern `BondingCurve` uses.
///
/// @dev WHY THE SWAP IS A SEPARATE TRANSACTION
///
/// A transfer hook can only see token amounts, so the tax necessarily
/// arrives in tokens. Converting it inside the transfer — the classic
/// "swap and liquify" pattern — is the most exploited construction in
/// tax-token history: the swap runs re-entrantly inside someone else's
/// trade and is trivially sandwiched.
///
/// So collection and conversion are split. Tax simply accumulates here, and
/// `distribute()` is an ordinary permissionless top-level call with a caller
/// supplied `amountOutMinimum`, exactly like any other swap.
///
/// @dev IMMUTABILITY
///
/// Every parameter is `immutable`. There is no owner, no setter, no rescue
/// function, and no path by which the creator or protocol split can be
/// changed after deployment.
contract TokenFeeCollector is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Creator's share of converted fees.
    ///
    /// @dev Fixed at `BondingCurve.MAX_CREATOR_SHARE_BPS`. On the curve this
    ///      share ramps 7500 -> 8500 bps with cumulative volume; a token only
    ///      reaches this contract by graduating, which means it already
    ///      cleared the volume cap, so the ramp is permanently topped out.
    uint256 public constant CREATOR_SHARE_BPS = 8_500;

    IERC20 public immutable token;
    address public immutable creator;
    address public immutable protocolTreasury;
    ISwapRouter02 public immutable swapRouter;
    IWETH9 public immutable weth9;
    uint24 public immutable poolFee;

    /// @notice Pull-payment balances, mirroring BondingCurve's pattern.
    uint256 public creatorFeesOwed;
    uint256 public protocolFeesOwed;

    event FeesDistributed(uint256 tokensSwapped, uint256 ethReceived, uint256 toCreator, uint256 toProtocol);
    event CreatorFeesWithdrawn(uint256 amount);
    event ProtocolFeesWithdrawn(uint256 amount);

    error ZeroAddress();
    error NothingToDistribute();
    error NothingOwed();
    error EthTransferFailed();

    constructor(
        address token_,
        address creator_,
        address protocolTreasury_,
        address swapRouter_,
        address weth9_,
        uint24 poolFee_
    ) {
        if (
            token_ == address(0) || creator_ == address(0) || protocolTreasury_ == address(0)
                || swapRouter_ == address(0) || weth9_ == address(0)
        ) revert ZeroAddress();

        token = IERC20(token_);
        creator = creator_;
        protocolTreasury = protocolTreasury_;
        swapRouter = ISwapRouter02(swapRouter_);
        weth9 = IWETH9(weth9_);
        poolFee = poolFee_;
    }

    /// @notice Swaps the entire collected token balance for ETH and credits
    ///         the creator/protocol split. Permissionless — anyone may call
    ///         it; the proceeds are fixed by this contract regardless of who
    ///         triggers it.
    ///
    /// @param amountOutMinimum Slippage bound for the swap, in wei. Callers
    ///        should quote off-chain; passing 0 invites a sandwich.
    function distribute(uint256 amountOutMinimum) external nonReentrant returns (uint256 ethReceived) {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) revert NothingToDistribute();

        // Approve exactly this swap, then swap into WETH held by this
        // contract so the unwrap below is self-contained.
        token.forceApprove(address(swapRouter), balance);

        ethReceived = swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(token),
                tokenOut: address(weth9),
                fee: poolFee,
                recipient: address(this),
                amountIn: balance,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        // Clear any residual allowance rather than leaving one standing.
        token.forceApprove(address(swapRouter), 0);

        weth9.withdraw(ethReceived);

        uint256 toCreator = (ethReceived * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toProtocol = ethReceived - toCreator;

        creatorFeesOwed += toCreator;
        protocolFeesOwed += toProtocol;

        emit FeesDistributed(balance, ethReceived, toCreator, toProtocol);
    }

    /// @notice Pull the creator's accrued ETH.
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

    /// @dev Accepts ETH from the WETH unwrap in `distribute`.
    receive() external payable {}
}
