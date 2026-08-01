// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title AggregatorV3Interface (minimal)
/// @notice Chainlink's standard price-feed interface — only the two
/// functions `BondingCurve` needs (`decimals` read once at construction,
/// `latestRoundData` read live on every sell that could be whale-taxed).
/// Deliberately NOT the full interface — this codebase vendors only what
/// it calls.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
