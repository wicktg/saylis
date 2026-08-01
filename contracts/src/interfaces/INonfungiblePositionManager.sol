// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

/// @title INonfungiblePositionManager (minimal)
/// @notice Only the two mutating functions `GraduationMigrator` needs
/// from Uniswap V3's periphery position manager: creating/initializing a
/// pool if one doesn't already exist, and minting a new LP position.
/// Ownership of a minted position is represented by an ERC-721 the
/// position manager itself mints — this interface extends `IERC721` so
/// `safeTransferFrom` is available to burn that position's NFT.
/// Deliberately NOT the full interface — this codebase vendors only what
/// it calls.
interface INonfungiblePositionManager is IERC721 {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    /// @notice Creates a new pool if it does not exist, then initializes
    /// it to `sqrtPriceX96` if it has not already been initialized. If the
    /// pool already exists AND is already initialized, this is a cheap
    /// no-op that just returns its address (the supplied `sqrtPriceX96`
    /// is ignored in that case).
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    /// @notice Creates a new LP position (minting an ERC-721 to
    /// `params.recipient`) for the given tick range and desired amounts.
    /// Any unused portion of `amount0Desired`/`amount1Desired` (beyond
    /// what the pool's current price requires for the resulting
    /// `liquidity`) is refunded to `msg.sender`, not `params.recipient`.
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}
