// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IReferralVault (minimal)
/// @notice The two calls `BondingCurve` makes into the protocol-wide
/// `ReferralVault` singleton, declared separately so the two contracts can
/// reference each other without a circular import.
interface IReferralVault {
    /// @notice `wallet`'s permanent referrer, or the zero address if none.
    /// Read once, at construction, and cached as an immutable — a curve
    /// never re-checks this after deployment.
    function getReferrer(address wallet) external view returns (address);

    /// @notice Credits `referrer`'s pull-payment balance with `msg.value`.
    /// Called at fee-accrual time with that trade's referral cut.
    function creditReferral(address referrer) external payable;
}
