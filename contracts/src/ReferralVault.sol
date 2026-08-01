// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title ReferralVault
/// @notice Protocol-wide singleton tracking who referred whom, and holding
/// every referrer's lifetime earnings from a single, unified pull-payment
/// balance — regardless of how many different creators they referred or how
/// many different tokens those creators ever launch.
///
/// # Why a separate singleton rather than per-curve accounting
///
/// A `BondingCurve` only ever knows about its own single creator. A
/// referrer's earnings are supposed to span EVERY token every creator they
/// referred ever launches, which no single curve can represent on its own.
/// Routing every curve's referral cut through one shared contract turns
/// "sum N small balances across N different curve contracts" into one
/// balance and one withdrawal, exactly like `BondingCurve.creatorFeesOwed`
/// but scoped to a referrer instead of a creator.
///
/// # Trust model
///
/// Registration (`registerReferral`) is self-service and one-way: a wallet
/// sets its own referrer exactly once, permanently. There is no admin
/// override, no re-assignment, matching this whole system's "no admin,
/// ever" posture for anything a user should be able to trust stays fixed.
///
/// `creditReferral` is deliberately PERMISSIONLESS, not restricted to
/// "known" BondingCurve addresses. Restricting it would mean this contract
/// maintaining an allowlist of every curve ever deployed — a coordination
/// problem for no real benefit, since the function only ever credits
/// whatever `referrer` the caller specifies with whatever ETH the caller
/// actually attaches. Nobody can direct funds anywhere but the stated
/// recipient's own pull-payment balance, the same non-custodial guarantee
/// `withdrawCreatorFees`/`withdrawProtocolFees` rely on elsewhere in this
/// system.
contract ReferralVault is ReentrancyGuard {
    /// @notice `referred`'s permanent referrer, or the zero address if none
    /// was ever registered. Set once, by `referred` themselves, via
    /// `registerReferral`.
    mapping(address referred => address referrer) public referrerOf;

    /// @notice ETH owed to `referrer`, accumulated from every curve's
    /// referral cut across every creator they've ever referred. Claimable
    /// via `withdrawReferralFees()`.
    mapping(address referrer => uint256) public referralFeesOwed;

    event ReferralRegistered(address indexed referred, address indexed referrer);
    event ReferralAccrued(address indexed referrer, address indexed curve, uint256 amount);
    event ReferralFeesWithdrawn(address indexed referrer, uint256 amount);

    error AlreadyRegistered(address referred);
    error ZeroReferrer();
    error SelfReferral();
    error NothingOwed();
    error TransferFailed();

    /// @notice Permanently records `msg.sender`'s referrer. Callable only by
    /// the referred wallet itself, and only once — there is no path for
    /// anyone, including this contract's own logic, to change it afterward.
    /// @param referrer The wallet that referred `msg.sender`.
    function registerReferral(address referrer) external {
        if (referrerOf[msg.sender] != address(0)) revert AlreadyRegistered(msg.sender);
        if (referrer == address(0)) revert ZeroReferrer();
        if (referrer == msg.sender) revert SelfReferral();
        referrerOf[msg.sender] = referrer;
        emit ReferralRegistered(msg.sender, referrer);
    }

    /// @notice Credits `referrer`'s pull-payment balance with `msg.value`.
    /// Called by a `BondingCurve` at fee-accrual time (see that contract's
    /// `REFERRAL_BPS`), but permissionless — see the contract-level NatSpec
    /// for why that is safe. A zero-value call is a silent no-op rather than
    /// a revert, so a curve with no referral cut this trade never needs to
    /// branch around calling this at all... except it still does, purely to
    /// save the gas of an unnecessary external call; this guard is the
    /// second line of defence, not the only one.
    /// @param referrer The wallet whose balance receives `msg.value`.
    function creditReferral(address referrer) external payable {
        if (msg.value == 0) return;
        referralFeesOwed[referrer] += msg.value;
        emit ReferralAccrued(referrer, msg.sender, msg.value);
    }

    /// @notice Sweep all currently-owed referral earnings to `msg.sender`.
    /// Pull-payment, same rationale as every other fee withdrawal in this
    /// system: never pushed, so a broken or hostile referrer address can
    /// only ever strand its own funds, never anyone else's trade.
    function withdrawReferralFees() external nonReentrant returns (uint256 amount) {
        amount = referralFeesOwed[msg.sender];
        if (amount == 0) revert NothingOwed();

        // ---- Effects ----
        referralFeesOwed[msg.sender] = 0;

        // ---- Interactions ----
        (bool sent,) = msg.sender.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit ReferralFeesWithdrawn(msg.sender, amount);
    }

    /// @notice `wallet`'s referrer, or the zero address if none is set.
    function getReferrer(address wallet) external view returns (address) {
        return referrerOf[wallet];
    }
}
