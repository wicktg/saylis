// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {INonfungiblePositionManager} from "../../src/interfaces/INonfungiblePositionManager.sol";

/// @notice Stand-in for Uniswap V3's NonfungiblePositionManager, covering
///         only what `LiquidityLocker` exercises: holding a position NFT
///         and paying out settable per-side fee balances via `collect`.
///
/// @dev `collect` mirrors the real one's two behaviours the locker depends
///      on: it is owner-gated, and it clamps the requested amountMax to
///      whatever the position actually has owed.
contract MockPositionManager is ERC721, INonfungiblePositionManager {
    uint256 public nextId = 1;

    mapping(uint256 => uint256) public owed0;
    mapping(uint256 => uint256) public owed1;
    mapping(uint256 => address) public asset0;
    mapping(uint256 => address) public asset1;

    constructor() ERC721("MockPosition", "MPOS") {}

    /// @notice Mints a position to `to` and records which ERC-20s its two
    ///         sides pay out in.
    function mintTo(address to, address token0_, address token1_) external returns (uint256 id) {
        id = nextId++;
        asset0[id] = token0_;
        asset1[id] = token1_;
        _mint(to, id);
    }

    /// @notice Credits fees to a position, as trading would.
    function setOwed(uint256 id, uint256 a0, uint256 a1) external {
        owed0[id] = a0;
        owed1[id] = a1;
    }

    function collect(CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1)
    {
        require(
            _isAuthorized(_ownerOf(params.tokenId), msg.sender, params.tokenId),
            "Not approved"
        );

        amount0 = owed0[params.tokenId];
        amount1 = owed1[params.tokenId];
        if (amount0 > params.amount0Max) amount0 = params.amount0Max;
        if (amount1 > params.amount1Max) amount1 = params.amount1Max;

        owed0[params.tokenId] -= amount0;
        owed1[params.tokenId] -= amount1;

        if (amount0 > 0) IERC20(asset0[params.tokenId]).transfer(params.recipient, amount0);
        if (amount1 > 0) IERC20(asset1[params.tokenId]).transfer(params.recipient, amount1);
    }

    // ---- Unused by LiquidityLocker; present to satisfy the interface ----

    function createAndInitializePoolIfNecessary(address, address, uint24, uint160)
        external
        payable
        returns (address)
    {
        revert("not implemented");
    }

    function mint(MintParams calldata)
        external
        payable
        returns (uint256, uint128, uint256, uint256)
    {
        revert("not implemented");
    }
}
