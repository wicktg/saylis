// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {MockWETH9} from "./MockWETH9.sol";

/// @notice Stand-in for Uniswap's SwapRouter02. Pulls `amountIn` of the
///         input token and mints the caller WETH at a settable rate, so
///         tests can drive `TokenFeeCollector.distribute` deterministically.
contract MockSwapRouter02 is ISwapRouter02 {
    MockWETH9 public immutable weth;

    /// @notice WETH returned per 1e18 of input token.
    uint256 public rateWeiPerToken = 1e15; // 0.001 ETH per token by default

    /// @notice When true, returns less than `amountOutMinimum` would allow
    ///         — used to prove slippage bounds are actually enforced.
    bool public shouldUnderfill;

    constructor(MockWETH9 weth_) {
        weth = weth_;
    }

    function setRate(uint256 rate) external {
        rateWeiPerToken = rate;
    }

    function setShouldUnderfill(bool v) external {
        shouldUnderfill = v;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        amountOut = (params.amountIn * rateWeiPerToken) / 1e18;
        if (shouldUnderfill) amountOut = amountOut / 2;

        require(amountOut >= params.amountOutMinimum, "Too little received");

        weth.mintTo(params.recipient, amountOut);
    }
}
