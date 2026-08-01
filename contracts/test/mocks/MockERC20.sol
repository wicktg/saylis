// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice Plain mintable ERC-20 with configurable decimals, standing in for
///         a pairing asset (WETH, or one of the whitelisted equity tokens).
///
/// @dev Decimals are configurable precisely because several listed equities
///      are not 18dp, and `BondingCurve` must not assume they are.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
