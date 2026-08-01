// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IUniswapV3Factory (minimal)
/// @notice Only the two view functions `GraduationMigrator` needs from
/// Uniswap V3's factory: checking whether a pool already exists for a
/// given token pair + fee tier, and looking up the tick spacing a given
/// fee tier uses (needed to compute valid full-range ticks). Deliberately
/// NOT the full interface — this codebase vendors only what it calls.
interface IUniswapV3Factory {
    /// @notice Returns the pool address for a given pair of tokens and a
    /// fee, or `address(0)` if it does not exist.
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);

    /// @notice Returns the tick spacing for a given fee amount, or 0 if
    /// the fee tier is not enabled on this factory.
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}
