// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";

/// @dev Dedicated suite for the market-cap-tiered whale sell tax:
/// threshold selection at each tier boundary, market-cap calculation
/// accuracy against a mock Chainlink feed, tier-crossing behavior
/// mid-token-life, stale-oracle fallback, 100%-to-creator routing, buy-side
/// non-interference, and fuzzing across mcap/balance/tax-rate combinations.
///
/// TEST SEQUENCING — WHY LIQUIDITY IS SEEDED BEFORE PRICE IS TARGETED
/// -----------------------------------------------------------------------
/// `sell` requires `realEthReserve` to actually cover the trade, but
/// `realEthReserve` is also part of `getPrice()`'s own denominator — so
/// seeding it changes the curve's live price (and therefore its live
/// market cap) as a side effect. Every test below calls `_seedLiquidity`
/// EXACTLY ONCE, before computing any Chainlink `answer` target, so
/// `_answerForTargetMcapUsd18` (which reads `getPrice()` fresh) always
/// computes against curve's FINAL, stable price — never a value that a
/// later balance-seeding step would silently invalidate.
contract BondingCurveWhaleTaxTest is Test {
    using stdStorage for StdStorage;

    string internal constant NAME = "Loxley Doge";
    string internal constant SYMBOL = "LDOGE";
    uint8 internal constant DECIMALS = 18;

    uint256 internal constant TOTAL_SUPPLY = 1_000_000e18;
    uint256 internal constant VIRTUAL_ETH = 1 ether;
    // Chosen so virtualTokenReserve + initial realTokenReserve (80% of
    // TOTAL_SUPPLY, per the standard 80/20 split) == TOTAL_SUPPLY exactly.
    uint256 internal constant VIRTUAL_TOKEN = 200_000e18;
    uint256 internal constant ETH_USD_PRICE = 3_000e18; // unrelated volumeCapWei knob
    uint256 internal constant UNREACHABLE_GRADUATION_THRESHOLD = type(uint128).max;
    uint8 internal constant FEED_DECIMALS = 8;
    uint256 internal constant SEED_ETH = 100 ether;

    address internal creator = makeAddr("creator");
    address internal protocolTreasury = makeAddr("protocolTreasury");
    address internal migrator = makeAddr("migrator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    ImmutableLaunchToken internal token;
    BondingCurve internal curve;
    MockV3Aggregator internal feed;

    function setUp() public {
        feed = new MockV3Aggregator(FEED_DECIMALS, 0); // price set per-test
        (token, curve) = _deployCurve(300); // 3% sell tax by default
        vm.roll(block.number + 1); // past the anti-snipe window (delayBlocks = 0)
        _seedLiquidity(curve);
    }

    function _deployCurve(uint256 sellTaxBps) internal returns (ImmutableLaunchToken t, BondingCurve c) {
        address deployerAddr = address(this);
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);

        t = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, TOTAL_SUPPLY, predictedCurve);
        c = new BondingCurve(
            IERC20(address(t)),
            VIRTUAL_ETH,
            VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            ETH_USD_PRICE,
            0,
            UNREACHABLE_GRADUATION_THRESHOLD,
            migrator,
            sellTaxBps,
            address(feed),
            address(0),
            0,
            address(0),
            address(0)
        );
        require(address(c) == predictedCurve, "test setup: nonce prediction mismatch");
    }

    /// @dev Bumps `realEthReserve` (and the curve's actual native balance
    /// to match) ONCE so `sell` has liquidity to pay out against, for
    /// every sell size this suite exercises. Must be called before any
    /// `_answerForTargetMcapUsd18` call — see the contract-level NatSpec.
    function _seedLiquidity(BondingCurve c) internal {
        stdstore.target(address(c)).sig("realEthReserve()").checked_write(SEED_ETH);
        vm.deal(address(c), SEED_ETH);
    }

    /// @dev Directly sets `seller`'s balance via storage (bypassing `buy`,
    /// whose max-wallet cap would otherwise make large whale balances
    /// impossible to set up honestly) — same pattern BondingCurveTest
    /// already uses for above-cap sell scenarios. Does NOT touch the
    /// curve's reserves/price — safe to call anytime after `_seedLiquidity`.
    function _setBalance(ImmutableLaunchToken t, address seller, uint256 balance) internal {
        stdstore.target(address(t)).sig("balanceOf(address)").with_key(seller).checked_write(balance);
    }

    /// @dev Computes the Chainlink `answer` that makes `c`'s CURRENT
    /// (live) `getPrice()` imply exactly `targetUsd18` market cap. Call
    /// only AFTER `_seedLiquidity(c)` — see the contract-level NatSpec.
    function _answerForTargetMcapUsd18(BondingCurve c, uint256 targetUsd18) internal view returns (int256) {
        uint256 totalSupplyWhole = TOTAL_SUPPLY / 1e18;
        uint256 mcapWei = c.getPrice() * totalSupplyWhole;
        return int256((targetUsd18 * (10 ** uint256(FEED_DECIMALS))) / mcapWei);
    }

    /* -------------------------------------------------------------------- */
    /*                    Tier selection at each boundary                   */
    /* -------------------------------------------------------------------- */

    function test_WhaleTier_AtOrBelow150k_Is2Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 150_000e18));
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_1_BPS());

        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 1)); // near-zero mcap
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_1_BPS());
    }

    function test_WhaleTier_JustAbove150k_Is1Point5Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 150_000e18) + 1);
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_2_BPS());
    }

    function test_WhaleTier_AtOrBelow300k_Is1Point5Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 300_000e18));
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_2_BPS());
    }

    function test_WhaleTier_JustAbove300k_Is1Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 300_000e18) + 1);
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_3_BPS());
    }

    function test_WhaleTier_AtOrBelow500k_Is1Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 500_000e18));
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_3_BPS());
    }

    function test_WhaleTier_JustAbove500k_IsPoint75Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 500_000e18) + 1);
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_4_BPS());
    }

    function test_WhaleTier_AtOrBelow1M_IsPoint75Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 1_000_000e18));
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_4_BPS());
    }

    function test_WhaleTier_Above1M_IsPoint5Percent() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 1_000_000e18) + 1);
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_5_BPS());

        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 50_000_000e18)); // deep into tier 5
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_5_BPS());
    }

    /* -------------------------------------------------------------------- */
    /*                  Market-cap calculation accuracy                     */
    /* -------------------------------------------------------------------- */

    function test_MarketCap_MatchesHandCalculation_AtCleanPrice() public {
        // With SEED_ETH = 100 ether seeded in setUp(), ethReserve() ==
        // VIRTUAL_ETH + SEED_ETH == 101 ether, and tokenReserve() ==
        // TOTAL_SUPPLY (by this suite's construction). getPrice() ==
        // 101e18 * 1e18 / 1_000_000e18 == 101e12 wei/whole-token, so
        // mcapWei == 101e12 * 1_000_000 == 101e18 (101 ETH). At
        // $3,000/ETH that's an exact, hand-checkable $303,000.
        feed.updateAnswer(3_000e8);
        (uint256 mcapUsd18, bool valid) = curve.currentMarketCapUsd();
        assertTrue(valid);
        assertEq(curve.getPrice(), 101e12);
        assertEq(mcapUsd18, 303_000e18);
    }

    function test_MarketCap_ScalesLinearlyWithPrice() public {
        feed.updateAnswer(1_000e8);
        (uint256 mcapAt1000,) = curve.currentMarketCapUsd();
        feed.updateAnswer(2_000e8);
        (uint256 mcapAt2000,) = curve.currentMarketCapUsd();

        assertEq(mcapAt2000, mcapAt1000 * 2, "doubling ETH/USD price must exactly double mcap");
    }

    function test_MarketCap_InvalidWhenAnswerIsZeroOrNegative() public {
        feed.updateAnswer(0);
        (, bool validAtZero) = curve.currentMarketCapUsd();
        assertFalse(validAtZero);

        feed.updateAnswer(-1);
        (, bool validAtNegative) = curve.currentMarketCapUsd();
        assertFalse(validAtNegative);
    }

    /* -------------------------------------------------------------------- */
    /*                 Whale tax gating — the core behavior                 */
    /* -------------------------------------------------------------------- */

    function test_SellTax_NotAppliedWhenBalanceAtOrBelowThreshold() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 150_000e18)); // tier 1: 2% threshold
        uint256 thresholdTokens = curve.currentWhaleThresholdTokens();
        assertEq(thresholdTokens, (TOTAL_SUPPLY * 200) / 10_000);

        _setBalance(token, alice, thresholdTokens); // exactly AT threshold, not above
        uint256 sellAmount = 1_000e18;

        vm.startPrank(alice);
        token.approve(address(curve), sellAmount);
        uint256 quotedNet = curve.quoteSell(sellAmount);
        uint256 quotedGross = curve.quoteSellGross(sellAmount);
        uint256 actualNet = curve.sell(sellAmount, 0);
        vm.stopPrank();

        uint256 expectedFeeOnly = quotedGross - (quotedGross * curve.FEE_BPS()) / curve.BPS_DENOMINATOR();
        assertEq(actualNet, quotedNet);
        assertEq(actualNet, expectedFeeOnly, "at-threshold balance must not be taxed (strictly greater-than)");
    }

    function test_SellTax_AppliedWhenBalanceExceedsThreshold() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 150_000e18)); // tier 1: 2% threshold
        uint256 thresholdTokens = curve.currentWhaleThresholdTokens();
        _setBalance(token, alice, thresholdTokens + 1); // one wei over

        uint256 sellAmount = 1_000e18;
        vm.startPrank(alice);
        token.approve(address(curve), sellAmount);
        uint256 quotedGross = curve.quoteSellGross(sellAmount);
        uint256 quotedNet = curve.quoteSell(sellAmount);
        uint256 actualNet = curve.sell(sellAmount, 0);
        vm.stopPrank();

        uint256 feeAmount = (quotedGross * curve.FEE_BPS()) / curve.BPS_DENOMINATOR();
        uint256 expectedTax = (quotedGross * curve.sellTaxBps()) / curve.BPS_DENOMINATOR();
        assertGt(expectedTax, 0, "test setup: sell tax must be nonzero for this assertion to mean anything");
        assertEq(actualNet, quotedNet);
        assertEq(actualNet, quotedGross - feeAmount - expectedTax, "one-wei-over-threshold balance must be taxed");
    }

    function test_SellTax_100PercentToCreator_ProtocolFeeUnaffected() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 1)); // tier 1, easiest to exceed
        uint256 thresholdTokens = curve.currentWhaleThresholdTokens();
        _setBalance(token, alice, thresholdTokens * 2);

        uint256 sellAmount = 5_000e18;
        vm.startPrank(alice);
        token.approve(address(curve), sellAmount);
        uint256 quotedGross = curve.quoteSellGross(sellAmount);
        curve.sell(sellAmount, 0);
        vm.stopPrank();

        uint256 feeAmount = (quotedGross * curve.FEE_BPS()) / curve.BPS_DENOMINATOR();
        uint256 expectedTax = (quotedGross * curve.sellTaxBps()) / curve.BPS_DENOMINATOR();
        // At zero cumulative volume the creator's ordinary fee share is
        // MIN_CREATOR_SHARE_BPS (75%) of `feeAmount` — the tax is on top
        // of that, not blended into the fee-split percentage.
        uint256 expectedOrdinaryCreatorFee = (feeAmount * 7_500) / 10_000;
        uint256 expectedProtocolFee = feeAmount - expectedOrdinaryCreatorFee;

        assertEq(curve.protocolFeesOwed(), expectedProtocolFee, "protocol fee must be completely untouched by tax");
        assertEq(
            curve.creatorFeesOwed(),
            expectedOrdinaryCreatorFee + expectedTax,
            "creator must receive their ordinary fee share PLUS the full tax"
        );
    }

    function test_SellTaxCollectedEvent_EmitsOnlyWhenTaxIsNonzero() public {
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 1));
        uint256 thresholdTokens = curve.currentWhaleThresholdTokens();

        // Non-whale: no SellTaxCollected event.
        _setBalance(token, bob, thresholdTokens);
        vm.startPrank(bob);
        token.approve(address(curve), 100e18);
        vm.recordLogs();
        curve.sell(100e18, 0);
        vm.stopPrank();
        _assertNoSellTaxCollectedEvent();

        // Whale: SellTaxCollected fires with the exact tax amount.
        _setBalance(token, alice, thresholdTokens + 1);
        vm.startPrank(alice);
        token.approve(address(curve), 1_000e18);
        uint256 quotedGross = curve.quoteSellGross(1_000e18);
        uint256 expectedTax = (quotedGross * curve.sellTaxBps()) / curve.BPS_DENOMINATOR();
        vm.expectEmit(true, false, false, true, address(curve));
        emit BondingCurve.SellTaxCollected(alice, expectedTax);
        curve.sell(1_000e18, 0);
        vm.stopPrank();
    }

    function _assertNoSellTaxCollectedEvent() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sellTaxTopic = keccak256("SellTaxCollected(address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 0) continue;
            assertTrue(logs[i].topics[0] != sellTaxTopic, "SellTaxCollected must not fire for a non-whale sell");
        }
    }

    /* -------------------------------------------------------------------- */
    /*                 Whale status shifts mid-token-life                   */
    /* -------------------------------------------------------------------- */

    /// @notice The same wallet, same balance: untaxed while mcap is low
    /// (threshold is lenient), taxed once mcap rises (threshold tightens)
    /// — confirms the threshold is re-evaluated live, not fixed at launch.
    function test_WhaleStatus_ShiftsAsMarketCapMoves() public {
        // A balance that clears tier 5's tight 0.5% threshold but NOT
        // tier 1's lenient 2% threshold.
        uint256 balance = (TOTAL_SUPPLY * 100) / 10_000; // 1.0% of supply
        _setBalance(token, alice, balance);

        // Low mcap -> tier 1 (2% threshold) -> 1.0% balance is NOT a whale.
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 1));
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_1_BPS());
        assertLe(balance, curve.currentWhaleThresholdTokens());

        vm.startPrank(alice);
        token.approve(address(curve), type(uint256).max);
        uint256 grossFirst = curve.quoteSellGross(1_000e18);
        uint256 netFirst = curve.sell(1_000e18, 0);
        vm.stopPrank();
        uint256 feeFirst = (grossFirst * curve.FEE_BPS()) / curve.BPS_DENOMINATOR();
        assertEq(netFirst, grossFirst - feeFirst, "low-mcap sell must be untaxed");

        // High mcap -> tier 5 (0.5% threshold) -> the SAME remaining
        // balance now clears it -> now a whale. (Selling doesn't change
        // the curve's virtual/real ETH reserve enough at this scale to
        // meaningfully move price itself; re-targeting the answer against
        // the curve's current price keeps this exact regardless.)
        feed.updateAnswer(_answerForTargetMcapUsd18(curve, 2_000_000e18));
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_5_BPS());
        assertGt(token.balanceOf(alice), curve.currentWhaleThresholdTokens());

        vm.startPrank(alice);
        uint256 grossSecond = curve.quoteSellGross(1_000e18);
        uint256 netSecond = curve.sell(1_000e18, 0);
        vm.stopPrank();
        uint256 feeSecond = (grossSecond * curve.FEE_BPS()) / curve.BPS_DENOMINATOR();
        uint256 taxSecond = (grossSecond * curve.sellTaxBps()) / curve.BPS_DENOMINATOR();
        assertGt(taxSecond, 0);
        assertEq(netSecond, grossSecond - feeSecond - taxSecond, "high-mcap sell of the same wallet must be taxed");
    }

    /* -------------------------------------------------------------------- */
    /*                    Stale / invalid oracle fallback                   */
    /* -------------------------------------------------------------------- */

    function test_StaleOracle_FallsBackToTier1_DoesNotRevertSell() public {
        // Fresh, high price first (would otherwise be deep in tier 5)...
        feed.updateAnswerAt(_answerForTargetMcapUsd18(curve, 2_000_000e18), block.timestamp);
        // ...then age it past PRICE_STALENESS_THRESHOLD.
        vm.warp(block.timestamp + curve.PRICE_STALENESS_THRESHOLD() + 1);

        (, bool valid) = curve.currentMarketCapUsd();
        assertFalse(valid, "test setup: feed must read as stale");
        assertEq(curve.currentWhaleThresholdBps(), curve.WHALE_TIER_1_BPS(), "stale feed must fall back to tier 1");

        // A balance that would be a whale under tier 5 but NOT under the
        // tier-1 fallback — sell must succeed, untaxed, and MUST NOT revert
        // just because the oracle is unavailable.
        uint256 balance = (TOTAL_SUPPLY * 100) / 10_000; // 1.0% of supply
        _setBalance(token, alice, balance);

        vm.startPrank(alice);
        token.approve(address(curve), 1_000e18);
        uint256 gross = curve.quoteSellGross(1_000e18);
        uint256 net = curve.sell(1_000e18, 0);
        vm.stopPrank();

        uint256 fee = (gross * curve.FEE_BPS()) / curve.BPS_DENOMINATOR();
        assertEq(net, gross - fee, "stale-oracle fallback must not tax a sub-tier-1-threshold balance");
    }

    /* -------------------------------------------------------------------- */
    /*                       Zero-tax curves never tax                      */
    /* -------------------------------------------------------------------- */

    function test_ZeroSellTaxCurve_NeverTaxesRegardlessOfBalance() public {
        (ImmutableLaunchToken t2, BondingCurve c2) = _deployCurve(0);
        vm.roll(block.number + 1);
        _seedLiquidity(c2);

        feed.updateAnswer(_answerForTargetMcapUsd18(c2, 1)); // deepest tier 1, most easily exceeded
        _setBalance(t2, alice, TOTAL_SUPPLY); // maximal possible balance

        vm.startPrank(alice);
        t2.approve(address(c2), 1_000e18);
        uint256 gross = c2.quoteSellGross(1_000e18);
        uint256 net = c2.sell(1_000e18, 0);
        vm.stopPrank();

        uint256 fee = (gross * c2.FEE_BPS()) / c2.BPS_DENOMINATOR();
        assertEq(net, gross - fee, "sellTaxBps == 0 must never tax, no matter the balance");
    }

    /* -------------------------------------------------------------------- */
    /*                       Buys are never affected                        */
    /* -------------------------------------------------------------------- */

    function test_Buy_IdenticalRegardlessOfSellTaxOrWhaleStatus() public {
        (ImmutableLaunchToken tTaxed, BondingCurve cTaxed) = _deployCurve(300);
        (ImmutableLaunchToken tUntaxed, BondingCurve cUntaxed) = _deployCurve(0);
        vm.roll(block.number + 1);

        feed.updateAnswer(_answerForTargetMcapUsd18(cTaxed, 2_000_000e18)); // deep whale territory

        // A small buy, safely under the 2.5% max-wallet cap on this
        // suite's deliberately-small TOTAL_SUPPLY test token.
        uint256 buyAmount = 0.0001 ether;

        uint256 quotedTaxed = cTaxed.quoteBuy(buyAmount);
        uint256 quotedUntaxed = cUntaxed.quoteBuy(buyAmount);
        assertEq(quotedTaxed, quotedUntaxed, "buy-side quotes must be identical regardless of sell-tax config");

        vm.deal(bob, buyAmount);
        vm.prank(bob);
        uint256 outTaxed = cTaxed.buy{value: buyAmount}(0);

        vm.deal(alice, buyAmount);
        vm.prank(alice);
        uint256 outUntaxed = cUntaxed.buy{value: buyAmount}(0);

        assertEq(outTaxed, outUntaxed, "actual buy output must be identical regardless of sell-tax config");
        assertEq(tTaxed.balanceOf(bob), tUntaxed.balanceOf(alice));
    }

    /* -------------------------------------------------------------------- */
    /*                                 Fuzzing                               */
    /* -------------------------------------------------------------------- */

    /// @notice Fuzzes the sell-tax rate, the live mcap (spanning all five
    /// tiers), and the seller's balance relative to whatever threshold
    /// that mcap implies — confirming the tax is applied if and only if
    /// the balance exceeds the threshold, for the exact expected amount,
    /// 100% credited to the creator, across the full combination space.
    function testFuzz_WhaleTax_AcrossMcapBalanceAndTaxRate(
        uint256 sellTaxBps,
        uint256 mcapUsd18,
        uint256 balanceBps,
        bool aboveThreshold
    ) public {
        sellTaxBps = bound(sellTaxBps, 0, 300);
        mcapUsd18 = bound(mcapUsd18, 1, 5_000_000e18);
        // A balance offset in bps of total supply, used to land just
        // above or below the tier's own threshold bps.
        balanceBps = bound(balanceBps, 1, 50);

        (ImmutableLaunchToken t, BondingCurve c) = _deployCurve(sellTaxBps);
        vm.roll(block.number + 1);
        _seedLiquidity(c);

        feed.updateAnswer(_answerForTargetMcapUsd18(c, mcapUsd18));
        uint256 thresholdBps = c.currentWhaleThresholdBps();
        uint256 thresholdTokens = c.currentWhaleThresholdTokens();

        uint256 balance;
        if (aboveThreshold) {
            uint256 extraBps = balanceBps; // > threshold by at least a nonzero amount
            uint256 candidate = (TOTAL_SUPPLY * (thresholdBps + extraBps)) / 10_000;
            balance = candidate > TOTAL_SUPPLY ? TOTAL_SUPPLY : candidate;
            vm.assume(balance > thresholdTokens);
        } else {
            balance = thresholdBps > balanceBps ? (TOTAL_SUPPLY * (thresholdBps - balanceBps)) / 10_000 : 0;
            vm.assume(balance <= thresholdTokens);
        }
        vm.assume(balance > 0);

        _setBalance(t, alice, balance);

        uint256 sellAmount = balance / 10 > 0 ? balance / 10 : balance;
        vm.assume(sellAmount > 0);

        vm.startPrank(alice);
        t.approve(address(c), sellAmount);
        uint256 gross = c.quoteSellGross(sellAmount);
        vm.assume(gross > 0);
        uint256 creatorOwedBefore = c.creatorFeesOwed();
        uint256 protocolOwedBefore = c.protocolFeesOwed();
        uint256 net = c.sell(sellAmount, 0);
        vm.stopPrank();

        uint256 fee = (gross * c.FEE_BPS()) / c.BPS_DENOMINATOR();
        uint256 expectedTax = balance > thresholdTokens ? (gross * sellTaxBps) / c.BPS_DENOMINATOR() : 0;

        assertEq(net, gross - fee - expectedTax, "net payout must reflect fee + conditional tax exactly");
        assertEq(
            c.creatorFeesOwed() - creatorOwedBefore + (c.protocolFeesOwed() - protocolOwedBefore),
            fee + expectedTax,
            "total owed must equal fee + tax exactly, no dust lost or invented"
        );
        assertGe(
            c.creatorFeesOwed() - creatorOwedBefore,
            expectedTax,
            "creator's share must include at least the full tax amount"
        );
    }
}
