// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TaxableLaunchToken} from "../src/TaxableLaunchToken.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";
import {MockUniswapV3Pool} from "./mocks/MockUniswapV3Pool.sol";

contract TaxableLaunchTokenTest is Test {
    uint256 constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 constant SELL_TAX_BPS = 300; // 3%, the maximum
    int256 constant ETH_USD = 3_000e8; // $3000, 8 decimals

    address curve = makeAddr("curve");
    address creator = makeAddr("creator");
    address migrator = makeAddr("migrator");
    address collector = makeAddr("collector");
    address whale = makeAddr("whale");
    address shrimp = makeAddr("shrimp");

    TaxableLaunchToken token;
    MockV3Aggregator feed;
    MockUniswapV3Pool pool;

    function setUp() public {
        feed = new MockV3Aggregator(8, ETH_USD);
        token = new TaxableLaunchToken(
            "Loxley Test", "LOX", 18, TOTAL_SUPPLY, curve, SELL_TAX_BPS, address(feed), migrator
        );
        // Token as token0 keeps the price math in its simplest orientation;
        // the inverted ordering is covered separately below.
        pool = new MockUniswapV3Pool(address(token), makeAddr("weth"), 0);
    }

    // -----------------------------------------------------------
    // helpers
    // -----------------------------------------------------------

    /// @dev Sets pool price so market cap lands at `targetUsd` (whole USD).
    function _setMcapUsd(uint256 targetUsd) internal {
        // mcapUsd = priceWei * supplyWhole * ethUsd / 1e8   (mcap is 18dp)
        // => priceWei = targetUsd * 1e18 * 1e8 / (supplyWhole * ethUsd)
        uint256 supplyWhole = TOTAL_SUPPLY / 1e18;
        uint256 priceWei = (targetUsd * 1e18 * 1e8) / (supplyWhole * uint256(ETH_USD));
        pool.setPriceWeiAsToken0(priceWei);
    }

    function _graduate() internal {
        vm.prank(migrator);
        token.setAmmPair(address(pool), collector);
    }

    function _fund(address who, uint256 amount) internal {
        vm.prank(curve);
        token.transfer(who, amount);
    }

    // -----------------------------------------------------------
    // construction / wiring
    // -----------------------------------------------------------

    function test_Constructor_MintsEntireSupplyToRecipient() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertEq(token.balanceOf(curve), TOTAL_SUPPLY);
        assertEq(token.ammPair(), address(0));
        assertEq(token.sellTaxBps(), SELL_TAX_BPS);
    }

    function test_RevertWhen_SellTaxAboveMax() public {
        vm.expectRevert(TaxableLaunchToken.SellTaxTooHigh.selector);
        new TaxableLaunchToken(
            "x", "x", 18, TOTAL_SUPPLY, curve, 301, address(feed), migrator
        );
    }

    function test_RevertWhen_SetAmmPairCalledByNonSetter() public {
        vm.expectRevert(TaxableLaunchToken.NotPairSetter.selector);
        vm.prank(creator);
        token.setAmmPair(address(pool), collector);
    }

    function test_RevertWhen_SetAmmPairCalledTwice() public {
        _graduate();
        vm.expectRevert(TaxableLaunchToken.PairAlreadySet.selector);
        vm.prank(migrator);
        token.setAmmPair(address(pool), collector);
    }

    /// The pair/collector pair is the ONLY mutable state; once written the
    /// token has no reachable setter at all.
    function test_AmmPairIsWriteOnce() public {
        _graduate();
        assertEq(token.ammPair(), address(pool));
        assertEq(token.feeCollector(), collector);

        address other = makeAddr("otherPool");
        vm.expectRevert(TaxableLaunchToken.PairAlreadySet.selector);
        vm.prank(migrator);
        token.setAmmPair(other, collector);
    }

    // -----------------------------------------------------------
    // pre-graduation: nothing is ever taxed
    // -----------------------------------------------------------

    function test_NoTaxBeforeGraduation_EvenForWhale() public {
        _fund(whale, TOTAL_SUPPLY / 10); // 10% — far above any tier
        uint256 amount = 1_000e18;

        vm.prank(whale);
        token.transfer(address(pool), amount);

        // Pair not set yet, so this is an ordinary transfer.
        assertEq(token.balanceOf(address(pool)), amount);
        assertEq(token.balanceOf(collector), 0);
    }

    function test_WalletToWalletNeverTaxed() public {
        _graduate();
        _setMcapUsd(2_000_000); // strictest tier
        _fund(whale, TOTAL_SUPPLY / 10);

        vm.prank(whale);
        token.transfer(shrimp, 1_000e18);

        assertEq(token.balanceOf(shrimp), 1_000e18);
        assertEq(token.balanceOf(collector), 0);
    }

    function test_BuysAreNotTaxed() public {
        // Stock the pool BEFORE wiring the pair up. Once `ammPair` is set,
        // ANY transfer into it is a taxable sell — including this one —
        // which is exactly why the migrator seeds liquidity first and calls
        // `setAmmPair` afterwards.
        _fund(address(pool), 10_000e18);

        _graduate();
        _setMcapUsd(2_000_000);

        // pool -> buyer is a buy; only `to == ammPair` is taxed.
        vm.prank(address(pool));
        token.transfer(whale, 1_000e18);

        assertEq(token.balanceOf(whale), 1_000e18);
        assertEq(token.balanceOf(collector), 0);
    }

    /// Guards the ordering requirement above: seeding liquidity after the
    /// pair is live would silently skim tax off the migration itself.
    function test_TransferIntoPairAfterWiring_IsTaxed_HenceSeedFirst() public {
        _graduate();
        _setMcapUsd(100_000);

        // curve still holds ~all supply, so it trips the whale threshold.
        uint256 amount = 10_000e18;
        _fund(address(pool), amount);

        assertEq(
            token.balanceOf(collector),
            (amount * SELL_TAX_BPS) / 10_000,
            "post-wiring transfers into the pair are taxed"
        );
    }

    // -----------------------------------------------------------
    // post-graduation taxation
    // -----------------------------------------------------------

    function test_WhaleSellIsTaxed() public {
        _graduate();
        _setMcapUsd(100_000); // tier 1 -> threshold 2% of supply
        _fund(whale, TOTAL_SUPPLY / 20); // 5% — a whale

        uint256 amount = 1_000e18;
        uint256 expectedTax = (amount * SELL_TAX_BPS) / 10_000;

        vm.prank(whale);
        token.transfer(address(pool), amount);

        assertEq(token.balanceOf(collector), expectedTax, "collector got tax");
        assertEq(token.balanceOf(address(pool)), amount - expectedTax, "pool got remainder");
    }

    function test_NonWhaleSellIsNotTaxed() public {
        _graduate();
        _setMcapUsd(100_000); // threshold = 2% of supply
        _fund(shrimp, TOTAL_SUPPLY / 1000); // 0.1% — below threshold

        vm.prank(shrimp);
        token.transfer(address(pool), 1_000e18);

        assertEq(token.balanceOf(collector), 0);
    }

    function test_ZeroSellTaxDisablesTaxEntirely() public {
        TaxableLaunchToken free = new TaxableLaunchToken(
            "free", "FREE", 18, TOTAL_SUPPLY, curve, 0, address(feed), migrator
        );
        MockUniswapV3Pool p = new MockUniswapV3Pool(address(free), makeAddr("weth"), 0);
        vm.prank(migrator);
        free.setAmmPair(address(p), collector);

        vm.prank(curve);
        free.transfer(whale, TOTAL_SUPPLY / 10);

        vm.prank(whale);
        free.transfer(address(p), 1_000e18);

        assertEq(free.balanceOf(collector), 0);
        assertEq(free.balanceOf(address(p)), 1_000e18);
    }

    /// The collector must be able to sell its collected tax without being
    /// taxed again, or fees would compound away on every distribute().
    function test_CollectorSellIsExempt() public {
        _graduate();
        _setMcapUsd(2_000_000);
        _fund(collector, TOTAL_SUPPLY / 10); // deliberately whale-sized

        vm.prank(collector);
        token.transfer(address(pool), 1_000e18);

        assertEq(token.balanceOf(address(pool)), 1_000e18, "no tax skimmed");
    }

    // -----------------------------------------------------------
    // tier boundaries
    // -----------------------------------------------------------

    function test_TierThresholds_AtEachBoundary() public {
        _graduate();

        _setMcapUsd(150_000);
        assertEq(token.currentWhaleThresholdBps(), 200, "tier1 @150k");

        _setMcapUsd(300_000);
        assertEq(token.currentWhaleThresholdBps(), 150, "tier2 @300k");

        _setMcapUsd(500_000);
        assertEq(token.currentWhaleThresholdBps(), 100, "tier3 @500k");

        _setMcapUsd(1_000_000);
        assertEq(token.currentWhaleThresholdBps(), 75, "tier4 @1M");

        _setMcapUsd(5_000_000);
        assertEq(token.currentWhaleThresholdBps(), 50, "tier5 above 1M");
    }

    /// A wallet's whale status must be re-evaluated per sale, not frozen.
    function test_WhaleStatusChangesAsMcapMoves() public {
        _graduate();
        // 1.2% of supply: under tier 1's 2% bar, over tier 3's 1% bar.
        uint256 balance = (TOTAL_SUPPLY * 120) / 10_000;
        _fund(whale, balance);

        _setMcapUsd(100_000); // tier 1 -> 2% -> not a whale
        vm.prank(whale);
        token.transfer(address(pool), 100e18);
        assertEq(token.balanceOf(collector), 0, "untaxed at low mcap");

        _setMcapUsd(400_000); // tier 3 -> 1% -> now a whale
        vm.prank(whale);
        token.transfer(address(pool), 100e18);
        assertGt(token.balanceOf(collector), 0, "taxed once mcap rises");
    }

    // -----------------------------------------------------------
    // oracle / price degradation
    // -----------------------------------------------------------

    function test_PoolRevert_FallsBackToMostLenientTier() public {
        _graduate();
        _setMcapUsd(5_000_000); // would be tier 5
        pool.setShouldRevert(true);

        assertEq(token.currentWhaleThresholdBps(), 200, "falls back to tier 1");
    }

    function test_StaleOracle_FallsBackToMostLenientTier() public {
        _graduate();
        _setMcapUsd(5_000_000);

        vm.warp(block.timestamp + 10 days);
        feed.updateAnswerAt(ETH_USD, block.timestamp - 4 hours); // beyond 3h

        assertEq(token.currentWhaleThresholdBps(), 200);
    }

    function test_NegativeOracleAnswer_FallsBackToMostLenientTier() public {
        _graduate();
        _setMcapUsd(5_000_000);
        feed.updateAnswer(-1);

        assertEq(token.currentWhaleThresholdBps(), 200);
    }

    /// Degradation must never over-tax: an outage during a large sell
    /// should apply the LENIENT threshold, not the strict one.
    function test_OracleOutageDoesNotOverTax() public {
        _graduate();
        // 1.5% of supply — whale under tier 5 (0.5%), not under tier 1 (2%).
        _fund(whale, (TOTAL_SUPPLY * 150) / 10_000);
        _setMcapUsd(5_000_000);
        pool.setShouldRevert(true);

        vm.prank(whale);
        token.transfer(address(pool), 1_000e18);

        assertEq(token.balanceOf(collector), 0, "outage must not create a whale");
    }

    // -----------------------------------------------------------
    // token ordering
    // -----------------------------------------------------------

    /// Price math must hold when the token sorts as token1 rather than
    /// token0, which depends purely on address ordering in production.
    function test_PriceMath_WhenTokenIsToken1() public {
        MockUniswapV3Pool inverted =
            new MockUniswapV3Pool(makeAddr("weth"), address(token), 0);

        vm.prank(migrator);
        token.setAmmPair(address(inverted), collector);

        // token0-per-token1 = 1/price. Set raw ratio for price 1e-6 ETH.
        uint256 priceWei = 1e12; // 0.000001 ETH per token
        // As token1, the pool's raw price is token1/token0 = 1/priceWei_ratio
        inverted.setPriceWeiAsToken0((1e18 * 1e18) / priceWei);

        (uint256 got, bool valid) = token.currentPriceWei();
        assertTrue(valid);
        // Allow rounding slack from the two sqrt/mulDiv round-trips.
        assertApproxEqRel(got, priceWei, 1e15); // 0.1%
    }

    // -----------------------------------------------------------
    // fuzz
    // -----------------------------------------------------------

    function testFuzz_TaxNeverExceedsConfiguredRate(uint256 balance, uint256 amount, uint256 mcap)
        public
    {
        balance = bound(balance, 1e18, TOTAL_SUPPLY / 2);
        amount = bound(amount, 1, balance);
        mcap = bound(mcap, 1_000, 50_000_000);

        _graduate();
        _setMcapUsd(mcap);
        _fund(whale, balance);

        uint256 before = token.balanceOf(collector);
        vm.prank(whale);
        token.transfer(address(pool), amount);
        uint256 tax = token.balanceOf(collector) - before;

        assertLe(tax, (amount * SELL_TAX_BPS) / 10_000, "never above configured rate");
        // Conservation: seller's outflow always lands entirely in pool+collector.
        assertEq(token.balanceOf(address(pool)) + tax, amount);
    }

    function testFuzz_QuoteMatchesActualTax(uint256 balance, uint256 amount) public {
        balance = bound(balance, 1e18, TOTAL_SUPPLY / 2);
        amount = bound(amount, 1, balance);

        _graduate();
        _setMcapUsd(400_000);
        _fund(whale, balance);

        uint256 quoted = token.quoteSellTax(whale, amount);

        uint256 before = token.balanceOf(collector);
        vm.prank(whale);
        token.transfer(address(pool), amount);
        uint256 actual = token.balanceOf(collector) - before;

        assertEq(actual, quoted, "quote must match what _update charges");
    }
}
