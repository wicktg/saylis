// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

/// @dev Minimal, fully test-controlled stand-in for a Chainlink price
/// feed. Lets tests set an arbitrary `answer` (and `updatedAt`, defaulting
/// to "just now") to exercise `BondingCurve`'s live market-cap logic
/// deterministically, including simulating a stale/invalid feed.
contract MockV3Aggregator is AggregatorV3Interface {
    uint8 private immutable _decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;

    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
        _roundId = 1;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    /// @notice Update the price, timestamped to right now.
    function updateAnswer(int256 newAnswer) external {
        _answer = newAnswer;
        _updatedAt = block.timestamp;
        _roundId++;
    }

    /// @notice Update the price with an explicit (possibly stale)
    /// timestamp, to simulate a feed that hasn't reported recently.
    function updateAnswerAt(int256 newAnswer, uint256 updatedAt_) external {
        _answer = newAnswer;
        _updatedAt = updatedAt_;
        _roundId++;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
