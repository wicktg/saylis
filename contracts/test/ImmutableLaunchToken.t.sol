// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol";
import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";

contract ImmutableLaunchTokenTest is Test {
    string internal constant NAME = "Loxley Doge";
    string internal constant SYMBOL = "LDOGE";
    uint8 internal constant DECIMALS = 18;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    address internal curve = makeAddr("bondingCurve");
    address internal deployer = makeAddr("deployer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    ImmutableLaunchToken internal token;

    function setUp() public {
        vm.prank(deployer);
        token = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, TOTAL_SUPPLY, curve);
    }

    /* -------------------------------------------------------------------- */
    /*                        Construction / initial state                  */
    /* -------------------------------------------------------------------- */

    function test_MetadataIsSetCorrectly() public view {
        assertEq(token.name(), NAME);
        assertEq(token.symbol(), SYMBOL);
        assertEq(token.decimals(), DECIMALS);
    }

    function test_TotalSupplyIsFixed() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }

    function test_EntireSupplyMintedToCurveAddress() public view {
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY);
    }

    /// @dev The deployer must receive exactly zero tokens. Supply goes only
    /// to the bonding-curve address specified at construction.
    function test_DeployerReceivesNothing() public view {
        assertEq(token.balanceOf(deployer), 0);
    }

    function test_RevertWhen_CurveIsZeroAddress() public {
        vm.expectRevert(bytes("ImmutableLaunchToken: curve is zero address"));
        new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, TOTAL_SUPPLY, address(0));
    }

    function test_RevertWhen_TotalSupplyIsZero() public {
        vm.expectRevert(bytes("ImmutableLaunchToken: zero total supply"));
        new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, 0, curve);
    }

    function test_DecimalsCanDifferFromDefault() public {
        ImmutableLaunchToken sixDecimalToken =
            new ImmutableLaunchToken(NAME, SYMBOL, 6, 1_000_000 * 10 ** 6, curve);
        assertEq(sixDecimalToken.decimals(), 6);
        assertEq(sixDecimalToken.totalSupply(), 1_000_000 * 10 ** 6);
    }

    /* -------------------------------------------------------------------- */
    /*                          Standard ERC-20 behavior                    */
    /* -------------------------------------------------------------------- */

    function test_Transfer() public {
        vm.prank(curve);
        token.transfer(alice, 1_000e18);

        assertEq(token.balanceOf(alice), 1_000e18);
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY - 1_000e18);
    }

    function test_Transfer_EmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(curve, alice, 1_000e18);

        vm.prank(curve);
        token.transfer(alice, 1_000e18);
    }

    function test_ApproveAndAllowance() public {
        vm.prank(curve);
        token.approve(alice, 500e18);

        assertEq(token.allowance(curve, alice), 500e18);
    }

    function test_TransferFrom() public {
        vm.prank(curve);
        token.approve(alice, 500e18);

        vm.prank(alice);
        token.transferFrom(curve, bob, 300e18);

        assertEq(token.balanceOf(bob), 300e18);
        assertEq(token.allowance(curve, alice), 200e18);
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY - 300e18);
    }

    function test_RevertWhen_TransferFromExceedsAllowance() public {
        vm.prank(curve);
        token.approve(alice, 100e18);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, alice, 100e18, 101e18
            )
        );
        token.transferFrom(curve, bob, 101e18);
    }

    function test_RevertWhen_TransferExceedsBalance() public {
        vm.prank(alice); // alice has a zero balance
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 1)
        );
        token.transfer(bob, 1);
    }

    function test_RevertWhen_TransferToZeroAddress() public {
        vm.prank(curve);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0))
        );
        token.transfer(address(0), 1);
    }

    function test_SelfTransferLeavesBalanceUnchanged() public {
        vm.prank(curve);
        token.transfer(curve, 1_000e18);

        assertEq(token.balanceOf(curve), TOTAL_SUPPLY);
    }

    /* -------------------------------------------------------------------- */
    /*             No owner / no privileged functions exist, anywhere       */
    /* -------------------------------------------------------------------- */

    /// @dev There is no `owner()` selector on the contract at all — calling
    /// it must revert because the function doesn't exist (as opposed to
    /// returning some address), proving no `Ownable`-style access control
    /// was inherited.
    function test_NoOwnerFunctionExists() public {
        (bool success,) = address(token).call(abi.encodeWithSignature("owner()"));
        assertFalse(success, "owner() must not exist on an immutable token");
    }

    function test_NoMintFunctionExists() public {
        (bool success,) =
            address(token).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1));
        assertFalse(success, "mint() must not exist on an immutable token");
    }

    function test_NoBurnFunctionExists() public {
        (bool success,) = address(token).call(abi.encodeWithSignature("burn(uint256)", 1));
        assertFalse(success, "burn() must not exist on an immutable token");
    }

    function test_NoPauseFunctionsExist() public {
        (bool pauseOk,) = address(token).call(abi.encodeWithSignature("pause()"));
        (bool unpauseOk,) = address(token).call(abi.encodeWithSignature("unpause()"));
        assertFalse(pauseOk, "pause() must not exist");
        assertFalse(unpauseOk, "unpause() must not exist");
    }

    function test_NoBlacklistFunctionsExist() public {
        (bool blacklistOk,) =
            address(token).call(abi.encodeWithSignature("blacklist(address)", alice));
        (bool banOk,) = address(token).call(abi.encodeWithSignature("addToBlacklist(address)", alice));
        assertFalse(blacklistOk, "blacklist() must not exist");
        assertFalse(banOk, "addToBlacklist() must not exist");
    }

    function test_NoUpgradeFunctionsExist() public {
        (bool upgradeOk,) =
            address(token).call(abi.encodeWithSignature("upgradeTo(address)", address(0xdead)));
        (bool implOk,) = address(token).call(abi.encodeWithSignature("implementation()"));
        assertFalse(upgradeOk, "upgradeTo() must not exist");
        assertFalse(implOk, "implementation() must not exist");
    }

    /// @dev Nobody, including the deployer, has any special ability. Prank
    /// as the deployer and confirm they hold no tokens and have no more
    /// power over the contract than a random address would.
    function test_DeployerHasNoSpecialPrivileges() public {
        assertEq(token.balanceOf(deployer), 0);

        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, deployer, 0, 1)
        );
        token.transfer(alice, 1);
    }

    /* -------------------------------------------------------------------- */
    /*                              Gas snapshot                            */
    /* -------------------------------------------------------------------- */

    /// @dev Run with `-vvvv` or `forge snapshot` to record/inspect the
    /// exact deployment gas cost. Asserting an upper bound here guards
    /// against an accidental regression (e.g. someone adding logic back in)
    /// silently blowing up deployment cost.
    function test_DeploymentGasCost() public {
        uint256 gasBefore = gasleft();
        new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, TOTAL_SUPPLY, curve);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Deployment gas used", gasUsed);
        assertLt(gasUsed, 1_000_000, "deployment gas exceeded expected budget");
    }

    /* -------------------------------------------------------------------- */
    /*                                Fuzzing                               */
    /* -------------------------------------------------------------------- */

    function testFuzz_Transfer(uint256 amount) public {
        amount = bound(amount, 0, TOTAL_SUPPLY);

        vm.prank(curve);
        token.transfer(alice, amount);

        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY - amount);
    }

    function testFuzz_RevertWhen_TransferExceedsBalance(uint256 amount) public {
        amount = bound(amount, TOTAL_SUPPLY + 1, type(uint256).max);

        vm.prank(curve);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, curve, TOTAL_SUPPLY, amount
            )
        );
        token.transfer(alice, amount);
    }

    function testFuzz_RevertWhen_TransferToZeroAddress(uint256 amount) public {
        amount = bound(amount, 0, TOTAL_SUPPLY);

        vm.prank(curve);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0))
        );
        token.transfer(address(0), amount);
    }

    function testFuzz_SelfTransferNeverChangesBalance(uint256 amount) public {
        amount = bound(amount, 0, TOTAL_SUPPLY);

        vm.prank(curve);
        token.transfer(curve, amount);

        assertEq(token.balanceOf(curve), TOTAL_SUPPLY);
    }

    function testFuzz_ApproveThenTransferFrom(uint256 approved, uint256 spent) public {
        approved = bound(approved, 0, TOTAL_SUPPLY);
        spent = bound(spent, 0, approved);

        vm.prank(curve);
        token.approve(alice, approved);

        vm.prank(alice);
        token.transferFrom(curve, bob, spent);

        assertEq(token.balanceOf(bob), spent);
        assertEq(token.allowance(curve, alice), approved - spent);
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY - spent);
    }

    /// @dev Fuzz arbitrary (sender, recipient, amount) triples, restricting
    /// only to what's needed to keep the test meaningful (nonzero
    /// recipient, sender starts with a known funded balance).
    function testFuzz_TransferToArbitraryRecipient(address recipient, uint256 amount) public {
        vm.assume(recipient != address(0));
        amount = bound(amount, 0, TOTAL_SUPPLY);

        vm.prank(curve);
        token.transfer(recipient, amount);

        // curve and recipient may collide (self-transfer case), handled
        // correctly either way since balanceOf reads current state.
        assertEq(token.balanceOf(recipient), recipient == curve ? TOTAL_SUPPLY : amount);
    }

    /* -------------------------------------------------------------------- */
    /*                        Event redeclaration for vm.expectEmit         */
    /* -------------------------------------------------------------------- */

    /// @dev Re-declared locally (identical signature to IERC20.Transfer) so
    /// the test file can `emit` it for `vm.expectEmit` comparison purposes
    /// without inheriting the token contract itself.
    event Transfer(address indexed from, address indexed to, uint256 value);
}
