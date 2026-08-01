// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUniswapV3Factory} from "../../src/interfaces/IUniswapV3Factory.sol";

/// @notice Settable `getPool` lookup, so `InfoFiCampaign`'s post-graduation
///         price path can be pointed at a `MockUniswapV3Pool` without
///         forking. Deliberately separate from the real factory interface's
///         other behaviour — nothing here creates pools.
contract MockUniswapV3FactoryStub is IUniswapV3Factory {
    mapping(bytes32 => address) internal _pools;
    mapping(uint24 => int24) internal _tickSpacing;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        _pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function setFeeAmountTickSpacing(uint24 fee, int24 spacing) external {
        _tickSpacing[fee] = spacing;
    }

    function getPool(address tokenA, address tokenB, uint24 fee)
        external
        view
        override
        returns (address)
    {
        return _pools[_key(tokenA, tokenB, fee)];
    }

    function feeAmountTickSpacing(uint24 fee) external view override returns (int24) {
        return _tickSpacing[fee];
    }

    /// @dev Order-independent, matching the real factory's canonical sort.
    function _key(address a, address b, uint24 fee) internal pure returns (bytes32) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(t0, t1, fee));
    }
}
