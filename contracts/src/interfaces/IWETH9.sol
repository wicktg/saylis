// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// @title IWETH9 (minimal)
/// @notice Canonical WETH9's `deposit`/`withdraw` — wrapping native ETH 1:1
/// into the standard `IERC20` balance it already exposes, and unwrapping it
/// back. These are the only two functions this codebase needs beyond plain
/// ERC-20.
interface IWETH9 is IERC20 {
    function deposit() external payable;

    /// @notice Burns `amount` WETH and sends the caller that much native ETH.
    function withdraw(uint256 amount) external;
}
