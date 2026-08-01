// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title ProtocolTreasury
/// @notice Deliberately minimal: receive ETH, let the owner withdraw it.
/// Nothing else.
///
/// @dev This contract intentionally holds NO fee accounting, NO per-curve
/// bookkeeping, and NO business logic of any kind — every `BondingCurve`
/// instance tracks and accumulates its own protocol-fee balance internally
/// (`protocolFeesOwed`) and pushes ETH here only when
/// `BondingCurve.withdrawProtocolFees()` is triggered. This contract's only
/// job is to be a safe, simple place for that ETH to land and for the
/// protocol multisig to later move it out.
///
/// Unlike `ImmutableLaunchToken` and `BondingCurve`, this contract DOES
/// have an owner — that is intentional, not an oversight. The token/curve
/// pair must be permissionless and immutable because they hold *user*
/// funds and *user* tokens; this contract only ever holds the protocol's
/// own fee revenue, which legitimately needs a controlling party (a
/// multisig) to move into wherever the protocol treasury process sends it
/// next (payroll, buybacks, etc.). Giving that specific, narrowly-scoped
/// control to a multisig here does not compromise the no-admin guarantees
/// made elsewhere in this system.
contract ProtocolTreasury is ReentrancyGuard {
    /// @notice The multisig (or any address) authorized to withdraw funds.
    /// Immutable — even this contract's own owner cannot be changed later;
    /// deploying a new `ProtocolTreasury` and re-pointing new `BondingCurve`
    /// deployments at it is the intended way to "rotate" ownership.
    address public immutable owner;

    event Received(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address owner_) {
        require(owner_ != address(0), "ProtocolTreasury: zero owner");
        owner = owner_;
    }

    /// @notice Accepts plain ETH transfers (e.g. from `BondingCurve`'s
    /// low-level `.call`).
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// @notice Withdraw `amount` ETH to `to`. Owner-only.
    /// @dev No internal balance accounting beyond the EVM's own native ETH
    /// balance — `amount` is simply checked against `address(this).balance`
    /// implicitly by the `.call` itself failing if insufficient. CEI:
    /// nothing is left to update after the external call, and the guard
    /// still applies for defense-in-depth against a reentrant `to`.
    function withdraw(address payable to, uint256 amount) external nonReentrant {
        require(msg.sender == owner, "ProtocolTreasury: not owner");
        require(to != address(0), "ProtocolTreasury: zero recipient");
        require(amount > 0, "ProtocolTreasury: zero amount");

        (bool sent,) = to.call{value: amount}("");
        require(sent, "ProtocolTreasury: transfer failed");

        emit Withdrawn(to, amount);
    }
}
