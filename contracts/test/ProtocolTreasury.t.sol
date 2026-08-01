// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ProtocolTreasury} from "../src/ProtocolTreasury.sol";

contract ProtocolTreasuryTest is Test {
    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    ProtocolTreasury internal treasury;

    function setUp() public {
        treasury = new ProtocolTreasury(owner);
    }

    function test_RevertWhen_OwnerIsZeroAddress() public {
        vm.expectRevert(bytes("ProtocolTreasury: zero owner"));
        new ProtocolTreasury(address(0));
    }

    function test_ReceivesPlainEthTransfers() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool sent,) = address(treasury).call{value: 1 ether}("");

        assertTrue(sent);
        assertEq(address(treasury).balance, 1 ether);
    }

    function test_Withdraw_OwnerCanWithdrawToAnyRecipient() public {
        vm.deal(address(treasury), 5 ether);
        address payable recipient = payable(makeAddr("recipient"));

        vm.prank(owner);
        treasury.withdraw(recipient, 2 ether);

        assertEq(recipient.balance, 2 ether);
        assertEq(address(treasury).balance, 3 ether);
    }

    function test_RevertWhen_NonOwnerWithdraws() public {
        vm.deal(address(treasury), 1 ether);
        vm.prank(stranger);
        vm.expectRevert(bytes("ProtocolTreasury: not owner"));
        treasury.withdraw(payable(stranger), 1 ether);
    }

    function test_RevertWhen_WithdrawToZeroAddress() public {
        vm.deal(address(treasury), 1 ether);
        vm.prank(owner);
        vm.expectRevert(bytes("ProtocolTreasury: zero recipient"));
        treasury.withdraw(payable(address(0)), 1 ether);
    }

    function test_RevertWhen_WithdrawZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(bytes("ProtocolTreasury: zero amount"));
        treasury.withdraw(payable(stranger), 0);
    }

    function test_RevertWhen_WithdrawExceedsBalance() public {
        vm.deal(address(treasury), 1 ether);
        vm.prank(owner);
        vm.expectRevert(bytes("ProtocolTreasury: transfer failed"));
        treasury.withdraw(payable(stranger), 2 ether);
    }

    function testFuzz_Withdraw_NeverExceedsBalance(uint256 funded, uint256 amount) public {
        funded = bound(funded, 0, 1_000 ether);
        vm.deal(address(treasury), funded);

        amount = bound(amount, 0, type(uint128).max);
        vm.assume(amount > 0);

        vm.prank(owner);
        if (amount > funded) {
            vm.expectRevert(bytes("ProtocolTreasury: transfer failed"));
            treasury.withdraw(payable(stranger), amount);
        } else {
            treasury.withdraw(payable(stranger), amount);
            assertEq(stranger.balance, amount);
        }
    }
}
