// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReferralVault} from "../src/ReferralVault.sol";

contract ReferralVaultTest is Test {
    ReferralVault internal vault;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public {
        vault = new ReferralVault();
    }

    /* -------------------------------------------------------------------- */
    /*                              Registration                            */
    /* -------------------------------------------------------------------- */

    function test_RegisterReferral_SetsPermanently() public {
        vm.prank(alice);
        vault.registerReferral(bob);

        assertEq(vault.referrerOf(alice), bob);
        assertEq(vault.getReferrer(alice), bob);
    }

    function test_RegisterReferral_EmitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit ReferralVault.ReferralRegistered(alice, bob);
        vm.prank(alice);
        vault.registerReferral(bob);
    }

    function test_RevertWhen_RegisteringTwice() public {
        vm.prank(alice);
        vault.registerReferral(bob);

        vm.expectRevert(abi.encodeWithSelector(ReferralVault.AlreadyRegistered.selector, alice));
        vm.prank(alice);
        vault.registerReferral(carol);
    }

    function test_RevertWhen_ReferrerIsZeroAddress() public {
        vm.expectRevert(ReferralVault.ZeroReferrer.selector);
        vm.prank(alice);
        vault.registerReferral(address(0));
    }

    function test_RevertWhen_SelfReferral() public {
        vm.expectRevert(ReferralVault.SelfReferral.selector);
        vm.prank(alice);
        vault.registerReferral(alice);
    }

    function test_UnregisteredWallet_HasZeroReferrer() public view {
        assertEq(vault.getReferrer(alice), address(0));
    }

    /* -------------------------------------------------------------------- */
    /*                                Accrual                               */
    /* -------------------------------------------------------------------- */

    function test_CreditReferral_AccumulatesBalance() public {
        vm.deal(address(this), 10 ether);
        vault.creditReferral{value: 1 ether}(bob);
        vault.creditReferral{value: 0.5 ether}(bob);

        assertEq(vault.referralFeesOwed(bob), 1.5 ether);
        assertEq(address(vault).balance, 1.5 ether);
    }

    function test_CreditReferral_IsPermissionless() public {
        // Anyone can credit anyone — funds only ever land on the stated
        // recipient's own balance, never redirectable.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.creditReferral{value: 1 ether}(bob);

        assertEq(vault.referralFeesOwed(bob), 1 ether);
        assertEq(vault.referralFeesOwed(alice), 0);
    }

    function test_CreditReferral_ZeroValueIsNoOp() public {
        vault.creditReferral{value: 0}(bob);
        assertEq(vault.referralFeesOwed(bob), 0);
    }

    function test_CreditReferral_EmitsEventWithCallerAsCurve() public {
        vm.deal(alice, 1 ether);
        vm.expectEmit(true, true, false, true);
        emit ReferralVault.ReferralAccrued(bob, alice, 1 ether);
        vm.prank(alice);
        vault.creditReferral{value: 1 ether}(bob);
    }

    /* -------------------------------------------------------------------- */
    /*                               Withdrawal                             */
    /* -------------------------------------------------------------------- */

    function test_WithdrawReferralFees_PaysFullBalanceAndZeroesIt() public {
        vm.deal(address(this), 2 ether);
        vault.creditReferral{value: 2 ether}(bob);

        uint256 before = bob.balance;
        vm.prank(bob);
        uint256 amount = vault.withdrawReferralFees();

        assertEq(amount, 2 ether);
        assertEq(bob.balance, before + 2 ether);
        assertEq(vault.referralFeesOwed(bob), 0);
    }

    function test_RevertWhen_WithdrawingNothingOwed() public {
        vm.expectRevert(ReferralVault.NothingOwed.selector);
        vm.prank(bob);
        vault.withdrawReferralFees();
    }

    function test_RevertWhen_WithdrawingTwice() public {
        vm.deal(address(this), 1 ether);
        vault.creditReferral{value: 1 ether}(bob);

        vm.prank(bob);
        vault.withdrawReferralFees();

        vm.expectRevert(ReferralVault.NothingOwed.selector);
        vm.prank(bob);
        vault.withdrawReferralFees();
    }

    function test_Withdraw_DoesNotAffectOtherReferrersBalance() public {
        vm.deal(address(this), 3 ether);
        vault.creditReferral{value: 1 ether}(bob);
        vault.creditReferral{value: 2 ether}(carol);

        vm.prank(bob);
        vault.withdrawReferralFees();

        assertEq(vault.referralFeesOwed(bob), 0);
        assertEq(vault.referralFeesOwed(carol), 2 ether);
    }
}
