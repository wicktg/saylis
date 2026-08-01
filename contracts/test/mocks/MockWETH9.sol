// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal WETH9 for tests: wraps/unwraps native ETH 1:1 and lets
///         the mock router mint balances directly.
contract MockWETH9 is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "MockWETH9: ETH transfer failed");
    }

    /// @dev Test hook so the router can hand out WETH without pre-funding.
    ///      The contract is kept solvent via `fund` below.
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Backs minted WETH with real ETH so `withdraw` can pay out.
    function fund() external payable {}

    receive() external payable {}
}
