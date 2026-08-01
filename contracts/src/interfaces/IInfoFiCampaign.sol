// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IInfoFiCampaign (minimal)
/// @notice The single call `BondingCurve` makes into the protocol-wide
/// `InfoFiCampaign` singleton, declared separately so the two contracts can
/// reference each other without a circular import.
interface IInfoFiCampaign {
    /// @notice Records the InfoFi pool a freshly-deployed curve has just
    /// transferred in. Called exactly once per token, from the curve's own
    /// constructor, AFTER the tokens have already been sent — the campaign
    /// verifies the balance actually arrived rather than trusting `amount`.
    /// @param token The launch token whose pool is being registered.
    /// @param amount Pool size in token base units. Immutable once set.
    function registerAllocation(address token, uint256 amount) external;
}
