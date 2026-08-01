// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";

/// @notice Minimal stand-in for a Uniswap V3 pool, letting tests drive the
///         spot price `TaxableLaunchToken` reads for market-cap tiering.
contract MockUniswapV3Pool is IUniswapV3Pool {
    uint160 public sqrtPriceX96;
    address public override token0;
    address public override token1;

    /// @notice When true, `slot0()` reverts — exercises the oracle-failure
    ///         fallback path.
    bool public shouldRevert;

    constructor(address token0_, address token1_, uint160 sqrtPriceX96_) {
        token0 = token0_;
        token1 = token1_;
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function setSqrtPriceX96(uint160 v) external {
        sqrtPriceX96 = v;
    }

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    /// @notice Sets `slot0` so the raw token1/token0 ratio equals
    ///         `priceWei / 1e18`.
    ///
    /// @dev sqrtPriceX96 = sqrt(ratio) * 2^96. Computing that as
    ///      `sqrt(ratio << 192)` overflows uint256 for ratios above ~1e0,
    ///      which silently wrapped and produced nonsense prices. Splitting
    ///      the shift either side of the sqrt keeps every intermediate in
    ///      range:
    ///
    ///          sqrt(r · 2^192) == sqrt(r · 2^96) · 2^48
    function setPriceWeiAsToken0(uint256 priceWei) external {
        uint256 ratioX96 = (priceWei << 96) / 1e18;
        sqrtPriceX96 = uint160(_sqrt(ratioX96) << 48);
    }

    function slot0()
        external
        view
        override
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        require(!shouldRevert, "MockUniswapV3Pool: forced revert");
        return (sqrtPriceX96, int24(0), uint16(0), uint16(1), uint16(1), uint8(0), true);
    }

    /* ------------------------------------------------------------------ */
    /*                          TWAP (InfoFiCampaign)                      */
    /* ------------------------------------------------------------------ */

    /// @notice The constant tick this mock's TWAP reports. Tests set this
    ///         directly rather than simulating an observation buffer.
    int24 public twapTick;

    /// @notice When true, `observe()` reverts with Uniswap's `OLD` behaviour
    ///         — a pool whose buffer does not reach back far enough.
    bool public observeReverts;

    uint16 public observationCardinalityNext = 1;

    function setTwapTick(int24 tick) external {
        twapTick = tick;
    }

    function setObserveReverts(bool v) external {
        observeReverts = v;
    }

    /// @dev Returns cumulative ticks consistent with a flat `twapTick` over
    ///      the whole window, so `(tc[1] - tc[0]) / window == twapTick`
    ///      exactly — which is what the consumer divides out.
    function observe(uint32[] calldata secondsAgos)
        external
        view
        override
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityX128)
    {
        require(!observeReverts, "OLD");

        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityX128 = new uint160[](secondsAgos.length);

        // Anchor far enough forward that the oldest entry stays positive.
        int56 base = int56(twapTick) * int56(uint56(1 days));
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            tickCumulatives[i] =
                base - int56(twapTick) * int56(uint56(secondsAgos[i]));
        }
    }

    function increaseObservationCardinalityNext(uint16 next) external override {
        if (next > observationCardinalityNext) observationCardinalityNext = next;
    }

    /* ------------------------------------------------------------------ */
    /*                   Liquidity / swap (GraduationMigrator)             */
    /* ------------------------------------------------------------------ */

    /// @notice In-range liquidity this mock reports. Defaults to 0, which is
    ///         the squatted-pool case `alignPoolPrice` is built for; tests
    ///         set it non-zero to exercise the `PoolAlreadyFunded` refusal.
    uint128 public liquidityValue;

    function setLiquidity(uint128 v) external {
        liquidityValue = v;
    }

    function liquidity() external view override returns (uint128) {
        return liquidityValue;
    }

    /// @dev Mirrors the only V3 behaviour this codebase relies on: with no
    ///      liquidity to cross, the price walks straight to the limit and
    ///      nothing is exchanged, so the callback is owed nothing.
    function swap(address, bool, int256, uint160 sqrtPriceLimitX96, bytes calldata)
        external
        override
        returns (int256, int256)
    {
        require(liquidityValue == 0, "MockUniswapV3Pool: funded swap unsupported");
        sqrtPriceX96 = sqrtPriceLimitX96;
        return (int256(0), int256(0));
    }

    /// @dev Babylonian method.
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
