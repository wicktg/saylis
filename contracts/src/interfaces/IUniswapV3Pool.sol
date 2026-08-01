// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal slice of Uniswap V3's pool interface — only what
///         `TaxableLaunchToken` needs to price the token post-graduation.
interface IUniswapV3Pool {
    /// @dev Only the first two fields are consumed here; the rest are kept
    ///      so the ABI decodes correctly against the real pool.
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function token0() external view returns (address);

    function token1() external view returns (address);

    /// @notice Cumulative tick counters at each of `secondsAgos`, which is
    ///         how a V3 pool exposes a manipulation-resistant TWAP: the
    ///         arithmetic-mean tick over a window is
    ///         `(tickCumulatives[1] - tickCumulatives[0]) / window`.
    /// @dev Reverts (`OLD`) if the pool's observation buffer does not reach
    ///      back as far as the oldest entry in `secondsAgos`. A freshly
    ///      seeded pool has cardinality 1, so callers must tolerate that
    ///      revert until `increaseObservationCardinalityNext` has been
    ///      called and enough time has passed.
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128);

    /// @notice Grows the observation ring buffer so longer TWAP windows
    ///         become queryable. Permissionless and idempotent-ish: calling
    ///         with a value at or below the current `next` is a no-op.
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;

    /// @notice Currently in-range liquidity. Zero for a pool that has been
    ///         created and initialised but never funded — the state a
    ///         griefer leaves behind when they pre-create a pair to hijack
    ///         its price (see `GraduationMigrator.alignPoolPrice`).
    function liquidity() external view returns (uint128);

    /// @notice Swap, used here for exactly one purpose: dragging an EMPTY
    ///         pool's price to `sqrtPriceLimitX96`. With no liquidity to
    ///         cross, V3 walks the price to the limit and exchanges nothing,
    ///         so `uniswapV3SwapCallback` is handed zero-or-negative deltas
    ///         and owes the pool nothing.
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}
