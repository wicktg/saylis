// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TokenFeeCollector} from "../src/TokenFeeCollector.sol";
import {TaxableLaunchToken} from "../src/TaxableLaunchToken.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";
import {MockUniswapV3Pool} from "./mocks/MockUniswapV3Pool.sol";
import {MockSwapRouter02} from "./mocks/MockSwapRouter02.sol";
import {MockWETH9} from "./mocks/MockWETH9.sol";

contract TokenFeeCollectorTest is Test {
    uint256 constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 constant SELL_TAX_BPS = 300;
    uint24 constant POOL_FEE = 3000;
    int256 constant ETH_USD = 3_000e8;

    address curve = makeAddr("curve");
    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");
    address migrator = makeAddr("migrator");
    address whale = makeAddr("whale");
    address keeper = makeAddr("keeper");

    TaxableLaunchToken token;
    TokenFeeCollector collector;
    MockV3Aggregator feed;
    MockUniswapV3Pool pool;
    MockSwapRouter02 router;
    MockWETH9 weth;

    function setUp() public {
        feed = new MockV3Aggregator(8, ETH_USD);
        weth = new MockWETH9();
        router = new MockSwapRouter02(weth);

        token = new TaxableLaunchToken(
            "Loxley Test", "LOX", 18, TOTAL_SUPPLY, curve, SELL_TAX_BPS, address(feed), migrator
        );
        pool = new MockUniswapV3Pool(address(token), address(weth), 0);
        collector = new TokenFeeCollector(
            address(token), creator, treasury, address(router), address(weth), POOL_FEE
        );

        vm.prank(migrator);
        token.setAmmPair(address(pool), address(collector));

        // The mock mints WETH without requiring a matching deposit, so back
        // it with enough ETH that `withdraw` can always pay out — including
        // at the extreme swap rates the fuzz explores.
        vm.deal(address(weth), 1e30);

        _setMcapUsd(2_000_000); // strictest tier — everyone above 0.5% is a whale
    }

    function _setMcapUsd(uint256 targetUsd) internal {
        uint256 supplyWhole = TOTAL_SUPPLY / 1e18;
        uint256 priceWei = (targetUsd * 1e18 * 1e8) / (supplyWhole * uint256(ETH_USD));
        pool.setPriceWeiAsToken0(priceWei);
    }

    /// Routes a whale sell through the token so the collector accrues tax
    /// exactly the way it will in production.
    function _accrueTax(uint256 sellAmount) internal returns (uint256 tax) {
        vm.prank(curve);
        token.transfer(whale, TOTAL_SUPPLY / 10);

        uint256 before = token.balanceOf(address(collector));
        vm.prank(whale);
        token.transfer(address(pool), sellAmount);
        tax = token.balanceOf(address(collector)) - before;
        assertGt(tax, 0, "expected tax to accrue");
    }

    // -----------------------------------------------------------

    function test_Constructor_RevertsOnZeroAddresses() public {
        vm.expectRevert(TokenFeeCollector.ZeroAddress.selector);
        new TokenFeeCollector(
            address(0), creator, treasury, address(router), address(weth), POOL_FEE
        );

        vm.expectRevert(TokenFeeCollector.ZeroAddress.selector);
        new TokenFeeCollector(
            address(token), address(0), treasury, address(router), address(weth), POOL_FEE
        );
    }

    function test_RevertWhen_DistributingWithNothingCollected() public {
        vm.expectRevert(TokenFeeCollector.NothingToDistribute.selector);
        vm.prank(creator);
        collector.distribute(0);
    }

    function test_Distribute_SwapsAndSplits85_15() public {
        uint256 tax = _accrueTax(100_000e18);

        uint256 expectedEth = (tax * router.rateWeiPerToken()) / 1e18;
        uint256 expectedCreator = (expectedEth * 8_500) / 10_000;
        uint256 expectedProtocol = expectedEth - expectedCreator;

        vm.prank(creator);
        uint256 received = collector.distribute(0);

        assertEq(received, expectedEth, "eth received");
        assertEq(collector.creatorFeesOwed(), expectedCreator, "creator share");
        assertEq(collector.protocolFeesOwed(), expectedProtocol, "protocol share");
        // Split must be exhaustive — no wei stranded by rounding.
        assertEq(collector.creatorFeesOwed() + collector.protocolFeesOwed(), received);
        assertEq(token.balanceOf(address(collector)), 0, "all tokens swapped");
        assertEq(address(collector).balance, received, "eth held for pull payment");
    }

    /// `distribute` carries a CALLER-SUPPLIED slippage bound, so whoever may
    /// call also decides how much protection the swap gets. Leaving it open
    /// to anyone made that bound unenforceable: an attacker would call
    /// `distribute(0)` inside their own sandwich and take the fees. Only the
    /// two parties the proceeds can ever reach may trigger it, so the one
    /// address able to pass a bad bound is only ever robbing itself.
    function test_RevertWhen_DistributeCalledByStranger() public {
        _accrueTax(100_000e18);

        vm.prank(keeper);
        vm.expectRevert(TokenFeeCollector.NotAuthorized.selector);
        collector.distribute(0);

        // ...and the tax is still sitting there, untouched and claimable.
        assertGt(token.balanceOf(address(collector)), 0, "nothing was swapped");
        assertEq(collector.creatorFeesOwed(), 0, "nothing was credited");
    }

    /// Both permitted callers work, and neither gains anything by calling —
    /// the split is fixed by the contract regardless of who triggers it.
    function test_Distribute_AllowedForCreatorAndTreasury() public {
        _accrueTax(100_000e18);

        vm.prank(creator);
        collector.distribute(0);
        assertGt(collector.creatorFeesOwed(), 0, "creator may trigger");
        assertEq(creator.balance, 0, "caller gains nothing directly");

        // Refill, then prove the treasury is equally able to trigger it.
        _accrueTax(50_000e18);
        uint256 beforeSecond = collector.creatorFeesOwed();

        vm.prank(treasury);
        collector.distribute(0);
        assertGt(collector.creatorFeesOwed(), beforeSecond, "treasury may trigger");
    }

    function test_Distribute_EnforcesSlippageBound() public {
        _accrueTax(100_000e18);
        router.setShouldUnderfill(true);

        uint256 tax = token.balanceOf(address(collector));
        uint256 fullQuote = (tax * router.rateWeiPerToken()) / 1e18;

        vm.expectRevert("Too little received");
        vm.prank(creator);
        collector.distribute(fullQuote);
    }

    function test_Distribute_LeavesNoStandingAllowance() public {
        _accrueTax(100_000e18);
        vm.prank(creator);
        collector.distribute(0);
        assertEq(token.allowance(address(collector), address(router)), 0);
    }

    function test_WithdrawCreatorFees_PaysCreatorInEth() public {
        _accrueTax(100_000e18);
        vm.prank(creator);
        collector.distribute(0);

        uint256 owed = collector.creatorFeesOwed();
        uint256 before = creator.balance;

        collector.withdrawCreatorFees();

        assertEq(creator.balance - before, owed, "creator paid in ETH");
        assertEq(collector.creatorFeesOwed(), 0, "balance cleared");
    }

    function test_WithdrawProtocolFees_PaysTreasuryInEth() public {
        _accrueTax(100_000e18);
        vm.prank(creator);
        collector.distribute(0);

        uint256 owed = collector.protocolFeesOwed();
        uint256 before = treasury.balance;

        collector.withdrawProtocolFees();

        assertEq(treasury.balance - before, owed);
        assertEq(collector.protocolFeesOwed(), 0);
    }

    function test_RevertWhen_WithdrawingWithNothingOwed() public {
        vm.expectRevert(TokenFeeCollector.NothingOwed.selector);
        collector.withdrawCreatorFees();

        vm.expectRevert(TokenFeeCollector.NothingOwed.selector);
        collector.withdrawProtocolFees();
    }

    /// Withdrawing must not let either party drain the other's balance —
    /// the failure mode that bit GraduationMigrator's fee accounting.
    function test_WithdrawalsAreIndependent() public {
        _accrueTax(100_000e18);
        vm.prank(creator);
        collector.distribute(0);

        uint256 protocolOwed = collector.protocolFeesOwed();
        collector.withdrawCreatorFees();

        assertEq(collector.protocolFeesOwed(), protocolOwed, "protocol untouched");
        assertGe(address(collector).balance, protocolOwed, "still solvent for protocol");

        collector.withdrawProtocolFees();
        assertEq(address(collector).balance, 0, "fully drained, nothing stranded");
    }

    function test_MultipleDistributionsAccumulate() public {
        _accrueTax(50_000e18);
        vm.prank(creator);
        collector.distribute(0);
        uint256 afterFirst = collector.creatorFeesOwed();

        vm.prank(whale);
        token.transfer(address(pool), 50_000e18);
        vm.prank(creator);
        collector.distribute(0);

        assertGt(collector.creatorFeesOwed(), afterFirst, "second round adds");
    }

    // -----------------------------------------------------------

    function testFuzz_SplitIsExhaustiveAndSolvent(uint256 sellAmount, uint256 rate) public {
        sellAmount = bound(sellAmount, 1e18, TOTAL_SUPPLY / 20);
        rate = bound(rate, 1, 1e18);
        router.setRate(rate);

        uint256 tax = _accrueTax(sellAmount);
        vm.assume(tax > 0);

        vm.prank(creator);
        uint256 received = collector.distribute(0);

        assertEq(
            collector.creatorFeesOwed() + collector.protocolFeesOwed(),
            received,
            "split loses no wei"
        );
        assertGe(
            address(collector).balance,
            collector.creatorFeesOwed() + collector.protocolFeesOwed(),
            "always solvent for what it owes"
        );
    }
}
