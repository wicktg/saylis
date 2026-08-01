// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal slice of Uniswap's SwapRouter02 — just the single-hop
///         exact-input swap `TokenFeeCollector` uses to convert collected
///         tax into WETH.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
