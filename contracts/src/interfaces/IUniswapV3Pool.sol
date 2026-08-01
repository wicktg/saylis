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
}
