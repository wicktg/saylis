// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {ProtocolTreasury} from "../src/ProtocolTreasury.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";

/// @dev Reenters `sell` from inside its ETH payout callback. Wrapped in
/// try/catch so the OUTER legitimate `sell` can still be observed
/// completing — the assertion that matters is that the INNER reentrant
/// call reverted.
contract ReentrantSellAttacker {
    BondingCurve public immutable curve;
    IERC20 public immutable token;
    bool public reentryBlocked;
    bool public receivedEth;

    constructor(BondingCurve curve_, IERC20 token_) {
        curve = curve_;
        token = token_;
    }

    receive() external payable {
        receivedEth = true;
        try curve.sell(1, 0) {
            // If this ever succeeds, reentrancy protection failed.
        } catch {
            reentryBlocked = true;
        }
    }
}

/// @dev Used as `creator` (or `protocolTreasury`) on a dedicated curve to
/// prove `withdrawCreatorFees` / `withdrawProtocolFees` can't be reentered
/// from inside the recipient's own receive callback.
contract ReentrantFeeRecipient {
    bool public reentryBlocked;
    bool public receivedEth;
    bool public attackCreator;
    BondingCurve public curve;

    function arm(BondingCurve curve_, bool attackCreator_) external {
        curve = curve_;
        attackCreator = attackCreator_;
    }

    receive() external payable {
        receivedEth = true;
        if (attackCreator) {
            try curve.withdrawCreatorFees() {
                // success would mean the guard failed
            } catch {
                reentryBlocked = true;
            }
        } else {
            try curve.withdrawProtocolFees() {
                // success would mean the guard failed
            } catch {
                reentryBlocked = true;
            }
        }
    }
}

contract BondingCurveTest is Test {
    using stdStorage for StdStorage;

    string internal constant NAME = "Loxley Doge";
    string internal constant SYMBOL = "LDOGE";
    uint8 internal constant DECIMALS = 18;

    uint256 internal constant DEFAULT_SUPPLY = 1_000_000_000e18;
    // 80% of DEFAULT_SUPPLY: the curve's LIQUIDITY_RESERVE_BPS (20%) is held
    // back, untouched, from every deploy — this is what `realTokenReserve`
    // actually starts at.
    uint256 internal constant DEFAULT_SELLABLE_SUPPLY = 800_000_000e18;
    // Large relative to the buy sizes (up to ~20 ETH) used throughout this
    // suite, so that no single buy on the default curve represents more
    // than a small fraction of `tokenReserve` — keeping the pre-existing
    // pricing/liquidity tests compatible with the max-wallet cap added
    // alongside anti-snipe (see the "Max-wallet cap" section below for
    // the dedicated boundary tests that DO need to land exactly on 2.5%).
    uint256 internal constant DEFAULT_VIRTUAL_ETH = 2_000e18;
    uint256 internal constant DEFAULT_VIRTUAL_TOKEN = 1_073_000_000e18;
    // $3,000 / ETH, 18-decimal fixed point.
    uint256 internal constant DEFAULT_ETH_USD_PRICE = 3_000e18;
    uint256 internal constant DEFAULT_DELAY_BLOCKS = 1;

    uint256 internal constant FEE_BPS = 100; // 1%
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MIN_CREATOR_BPS = 7_500;
    uint256 internal constant MAX_CREATOR_BPS = 8_500;
    uint256 internal constant MAX_WALLET_BPS = 250; // 2.5%

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal creator = makeAddr("creator");
    address internal protocolTreasury = makeAddr("protocolTreasury");
    address internal migrator = makeAddr("migrator");

    ImmutableLaunchToken internal token;
    BondingCurve internal curve;
    MockV3Aggregator internal ethUsdPriceFeed;

    function setUp() public {
        ethUsdPriceFeed = new MockV3Aggregator(8, 3_000e8);
        (token, curve) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            DEFAULT_DELAY_BLOCKS
        );
        _rollPastLaunchDelay(curve);
    }

    /// @dev An effectively-unreachable graduation threshold, used by the
    /// plain `_deployPair` overload so the large pre-existing (pre-
    /// graduation-feature) test suite below doesn't need to reason about
    /// graduation at all. Dedicated graduation tests use
    /// `_deployPairWithGraduation` instead, with a realistic threshold.
    uint256 internal constant UNREACHABLE_GRADUATION_THRESHOLD = type(uint128).max;

    /// @dev Predicts the curve's CREATE address one deployer-nonce ahead of
    /// the token's, so the token can mint its entire supply straight to it.
    /// Deliberately does NOT roll blocks forward — callers that intend to
    /// `buy` immediately should follow up with `_rollPastLaunchDelay`;
    /// callers specifically testing the anti-snipe window should not.
    function _deployPair(
        uint256 totalSupply_,
        uint256 virtualEth_,
        uint256 virtualToken_,
        address creator_,
        address protocolTreasury_,
        uint256 ethUsdPrice_,
        uint256 delayBlocks_
    ) internal returns (ImmutableLaunchToken t, BondingCurve c) {
        return _deployPairWithGraduation(
            totalSupply_,
            virtualEth_,
            virtualToken_,
            creator_,
            protocolTreasury_,
            ethUsdPrice_,
            delayBlocks_,
            UNREACHABLE_GRADUATION_THRESHOLD
        );
    }

    function _deployPairWithGraduation(
        uint256 totalSupply_,
        uint256 virtualEth_,
        uint256 virtualToken_,
        address creator_,
        address protocolTreasury_,
        uint256 ethUsdPrice_,
        uint256 delayBlocks_,
        uint256 graduationThreshold_
    ) internal returns (ImmutableLaunchToken t, BondingCurve c) {
        address deployerAddr = address(this);
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);

        t = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, totalSupply_, predictedCurve);
        if (address(ethUsdPriceFeed) == address(0)) {
            ethUsdPriceFeed = new MockV3Aggregator(8, 3_000e8);
        }
        c = new BondingCurve(
            IERC20(address(t)),
            virtualEth_,
            virtualToken_,
            creator_,
            protocolTreasury_,
            ethUsdPrice_,
            delayBlocks_,
            graduationThreshold_,
            migrator,
            0,
            address(ethUsdPriceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );

        require(address(c) == predictedCurve, "test setup: nonce prediction mismatch");
    }

    /// @dev Advances `block.number` just past `c`'s anti-snipe window, so
    /// `buy` is immediately callable afterward.
    function _rollPastLaunchDelay(BondingCurve c) internal {
        vm.roll(block.number + c.delayBlocks() + 1);
    }

    function _feeOf(uint256 grossEthAmount) internal pure returns (uint256) {
        return (grossEthAmount * FEE_BPS) / BPS_DENOMINATOR;
    }

    /* -------------------------------------------------------------------- */
    /*                             Construction                             */
    /* -------------------------------------------------------------------- */

    function test_InitialState() public view {
        assertEq(address(curve.token()), address(token));
        assertEq(curve.creator(), creator);
        assertEq(curve.protocolTreasury(), protocolTreasury);
        assertEq(curve.ethUsdPrice(), DEFAULT_ETH_USD_PRICE);
        assertEq(curve.cumulativeVolume(), 0);
        assertEq(curve.creatorFeesOwed(), 0);
        assertEq(curve.protocolFeesOwed(), 0);
        assertEq(curve.currentCreatorFeeShareBps(), MIN_CREATOR_BPS);
        assertEq(curve.delayBlocks(), DEFAULT_DELAY_BLOCKS);
        assertEq(curve.maxWalletTokens(), (DEFAULT_SUPPLY * MAX_WALLET_BPS) / BPS_DENOMINATOR);
        assertEq(
            curve.liquidityReserveTokens(),
            DEFAULT_SUPPLY - DEFAULT_SELLABLE_SUPPLY,
            "20% of total supply must be held back, untouched, for DEX liquidity"
        );
        assertEq(
            curve.realTokenReserve(),
            DEFAULT_SELLABLE_SUPPLY,
            "only the 80% sellable portion should seed realTokenReserve"
        );
        assertEq(
            token.balanceOf(address(curve)),
            DEFAULT_SUPPLY,
            "the reserved 20% still physically sits in the curve's own balance"
        );
    }

    function test_VolumeCapWei_ComputedFromUsdPriceReference() public {
        // ethUsdPrice = $10,000/ETH -> volumeCapWei = $10,000,000 / $10,000 = 1,000 ETH.
        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            10_000e18,
            DEFAULT_DELAY_BLOCKS
        );
        assertEq(c.volumeCapWei(), 1_000e18);
    }

    /// @dev `_deployPair` performs TWO `new` calls (token, then curve);
    /// wrapping the whole helper in `vm.expectRevert` would consume the
    /// cheatcode on the token's (successful) deployment before ever
    /// reaching the curve's constructor. These tests instead deploy the
    /// token directly and wrap ONLY the failing `BondingCurve` constructor
    /// call.
    function _deployTokenOnly(uint256 totalSupply_, address predictedCurve)
        internal
        returns (ImmutableLaunchToken)
    {
        return new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, totalSupply_, predictedCurve);
    }

    function test_RevertWhen_CreatorIsZeroAddress() public {
        address predictedCurve =
            vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        ImmutableLaunchToken t = _deployTokenOnly(DEFAULT_SUPPLY, predictedCurve);

        vm.expectRevert(bytes("BondingCurve: creator is zero address"));
        new BondingCurve(
            IERC20(address(t)),
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            address(0),
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            DEFAULT_DELAY_BLOCKS,
            UNREACHABLE_GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdPriceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
    }

    function test_RevertWhen_ProtocolTreasuryIsZeroAddress() public {
        address predictedCurve =
            vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        ImmutableLaunchToken t = _deployTokenOnly(DEFAULT_SUPPLY, predictedCurve);

        vm.expectRevert(bytes("BondingCurve: protocol treasury is zero address"));
        new BondingCurve(
            IERC20(address(t)),
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            address(0),
            DEFAULT_ETH_USD_PRICE,
            DEFAULT_DELAY_BLOCKS,
            UNREACHABLE_GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdPriceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
    }

    function test_RevertWhen_EthUsdPriceIsZero() public {
        address predictedCurve =
            vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        ImmutableLaunchToken t = _deployTokenOnly(DEFAULT_SUPPLY, predictedCurve);

        vm.expectRevert(bytes("BondingCurve: zero eth/usd price"));
        new BondingCurve(
            IERC20(address(t)),
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            0,
            DEFAULT_DELAY_BLOCKS,
            UNREACHABLE_GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdPriceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
    }

    function test_RevertWhen_GraduationThresholdIsZero() public {
        address predictedCurve =
            vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        ImmutableLaunchToken t = _deployTokenOnly(DEFAULT_SUPPLY, predictedCurve);

        vm.expectRevert(bytes("BondingCurve: zero graduation threshold"));
        new BondingCurve(
            IERC20(address(t)),
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            DEFAULT_DELAY_BLOCKS,
            0,
            migrator,
            0,
            address(ethUsdPriceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
    }

    /* -------------------------------------------------------------------- */
    /*             Pricing formula vs. hand-worked manual calculation       */
    /* -------------------------------------------------------------------- */

    /// @dev Clean numbers chosen so the curve formula, the 1% fee
    /// deduction, AND the 2.5% max-wallet cap all resolve with zero
    /// rounding error, landing the buy EXACTLY on the cap boundary
    /// (chosen deliberately, since `buy`'s cap check is a strict `>`, so
    /// landing exactly on the cap must still succeed).
    ///
    /// `virtualToken_` is passed as 12_000e18 (not a "clean" 10_000e18)
    /// specifically to cancel out the curve's 20% liquidity reserve: with
    /// totalSupply = 10_000e18, only 8_000e18 of it becomes the initial
    /// `realTokenReserve` (the other 2_000e18 is held back, untouched, for
    /// DEX liquidity), so `virtualToken_ + realTokenReserve` still lands on
    /// the same clean 20_000e18 combined reserve the hand-worked numbers
    /// below assume:
    ///
    ///   virtualEth = 7_821e18, virtualToken = 12_000e18,
    ///   totalSupply (real) = 10_000e18, realTokenReserve (initial, 80%) = 8_000e18
    ///   maxWalletTokens = 250e18 (2.5% of totalSupply)
    ///
    ///   msg.value = 100e18
    ///     feeAmount = 100e18 * 1% = 1e18
    ///     netEthIn  = 99e18
    ///
    ///   ethReserve = 7_821e18 + 0 = 7_821e18
    ///   tokenReserve = 12_000e18 + 8_000e18 = 20_000e18
    ///
    ///   tokensOut = tokenReserve * netEthIn / (ethReserve + netEthIn)
    ///             = 20_000e18 * 99e18 / (7_821e18 + 99e18)
    ///             = 1_980_000e36 / 7_920e18
    ///             = 250e18                                     <- exact,
    ///               and exactly == maxWalletTokens
    function test_PricingFormula_BuyMatchesManualCalculation() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployPair(
            10_000e18, 7_821e18, 12_000e18, creator, protocolTreasury, DEFAULT_ETH_USD_PRICE, 0
        );
        _rollPastLaunchDelay(c);

        uint256 quoted = c.quoteBuy(100e18);
        assertEq(quoted, 250e18, "quoteBuy did not match hand-worked expectation");
        assertEq(quoted, c.maxWalletTokens(), "test setup: expected to land exactly on the cap");

        vm.deal(alice, 100e18);
        vm.prank(alice);
        uint256 tokensOut = c.buy{value: 100e18}(0);

        assertEq(tokensOut, 250e18);
        assertEq(t.balanceOf(alice), 250e18);
        assertEq(c.realTokenReserve(), 8_000e18 - 250e18);
        assertEq(c.realEthReserve(), 99e18, "real eth reserve should hold only the NET amount");

        uint256 expectedFee = 1e18;
        assertEq(c.creatorFeesOwed() + c.protocolFeesOwed(), expectedFee, "fee split must sum exactly");
        assertEq(c.cumulativeVolume(), 100e18, "volume must track the GROSS trade amount");
    }

    /// @dev Continues the scenario above: sell the 250e18 tokens back.
    ///
    ///   post-buy state: ethReserve = 7_821e18+99e18   = 7_920e18
    ///                    tokenReserve = 12_000e18+7_750e18 = 19_750e18
    ///
    ///   grossEthOut = ethReserve * tokenIn / (tokenReserve + tokenIn)
    ///               = 7_920e18 * 250e18 / (19_750e18 + 250e18)
    ///               = 1_980_000e36 / 20_000e18
    ///               = 99e18                                      <- exact
    ///     feeAmount = 99e18 * 1% = 0.99e18
    ///     netEthOut = 99e18 - 0.99e18 = 98.01e18
    ///
    /// Sells are never subject to the max-wallet cap, so selling this
    /// entire (exactly-at-cap) balance in one call is expected to succeed
    /// outright.
    function test_PricingFormula_SellMatchesManualCalculation() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployPair(
            10_000e18, 7_821e18, 12_000e18, creator, protocolTreasury, DEFAULT_ETH_USD_PRICE, 0
        );
        _rollPastLaunchDelay(c);

        vm.deal(alice, 100e18);
        vm.startPrank(alice);
        uint256 tokensOut = c.buy{value: 100e18}(0);

        uint256 quotedGross = c.quoteSellGross(tokensOut);
        assertEq(quotedGross, 99e18, "quoteSellGross did not match hand-worked expectation");

        uint256 quotedNet = c.quoteSell(tokensOut);
        assertEq(quotedNet, 98.01e18, "quoteSell (net) did not match hand-worked expectation");

        t.approve(address(c), tokensOut);
        uint256 netEthOut = c.sell(tokensOut, 0);
        vm.stopPrank();

        assertEq(netEthOut, 98.01e18);
        assertEq(
            c.realTokenReserve(), 8_000e18, "tokens should be fully back in the curve's sellable reserve"
        );
        assertEq(c.realEthReserve(), 0, "gross eth should be fully removed from the real reserve");
    }

    /* -------------------------------------------------------------------- */
    /*                Escalating creator fee share — checkpoints            */
    /* -------------------------------------------------------------------- */

    /// @dev Deploys a curve whose volumeCapWei resolves to a clean 1,000
    /// ETH: ethUsdPrice = $10,000/ETH -> $10,000,000 / $10,000 = 1,000 ETH.
    function _deployCleanCapCurve() internal returns (BondingCurve c) {
        (, c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            10_000e18,
            DEFAULT_DELAY_BLOCKS
        );
        assertEq(c.volumeCapWei(), 1_000e18, "test setup: expected a clean 1,000 ETH cap");
        _rollPastLaunchDelay(c);
    }

    function _setCumulativeVolume(BondingCurve c, uint256 volume) internal {
        stdstore.target(address(c)).sig("cumulativeVolume()").checked_write(volume);
    }

    function test_CreatorShare_AtZeroVolume_Is75Percent() public {
        BondingCurve c = _deployCleanCapCurve();
        assertEq(c.currentCreatorFeeShareBps(), 7_500);
    }

    function test_CreatorShare_AtHalfCapVolume_Is80Percent() public {
        BondingCurve c = _deployCleanCapCurve();
        _setCumulativeVolume(c, 500e18); // 50% of the 1,000 ETH cap
        assertEq(c.currentCreatorFeeShareBps(), 8_000);
    }

    function test_CreatorShare_AtExactCapBoundary_Is85Percent() public {
        BondingCurve c = _deployCleanCapCurve();
        _setCumulativeVolume(c, 1_000e18); // exactly at the cap
        assertEq(c.currentCreatorFeeShareBps(), 8_500);
    }

    function test_CreatorShare_BeyondCap_StaysCappedAt85Percent() public {
        BondingCurve c = _deployCleanCapCurve();
        _setCumulativeVolume(c, 2_000e18); // 2x the cap
        assertEq(c.currentCreatorFeeShareBps(), 8_500, "must not exceed the 85% cap");
    }

    function test_CreatorShare_AtQuarterAndThreeQuarterCap() public {
        BondingCurve c = _deployCleanCapCurve();

        _setCumulativeVolume(c, 250e18); // 25% of cap
        assertEq(c.currentCreatorFeeShareBps(), 7_750); // 7500 + 1000*0.25

        _setCumulativeVolume(c, 750e18); // 75% of cap
        assertEq(c.currentCreatorFeeShareBps(), 8_250); // 7500 + 1000*0.75
    }

    /* -------------------------------------------------------------------- */
    /*                      Fee split accuracy, to the wei                  */
    /* -------------------------------------------------------------------- */

    /// @dev At exactly 50% of the cap (creator share = 80%), a fee of 1e18
    /// wei must split into exactly 0.8e18 / 0.2e18 with nothing left over.
    function test_FeeSplit_ExactToTheWei_AtEightyPercentCheckpoint() public {
        BondingCurve c = _deployCleanCapCurve();
        _setCumulativeVolume(c, 500e18);

        // Craft a buy whose fee is exactly 0.1e18: msg.value = 10e18 ->
        // feeAmount = 10e18 * 1% = 0.1e18.
        vm.deal(alice, 10e18);
        vm.prank(alice);
        c.buy{value: 10e18}(0);

        assertEq(c.creatorFeesOwed(), 0.08e18);
        assertEq(c.protocolFeesOwed(), 0.02e18);
        assertEq(c.creatorFeesOwed() + c.protocolFeesOwed(), 0.1e18);
    }

    /// @dev `protocolFee` is defined as the remainder specifically so that
    /// creatorFee + protocolFee always equals feeAmount exactly, even when
    /// creatorBps * feeAmount doesn't divide evenly. Force an odd fee
    /// amount against a non-trivial bps to exercise that rounding path.
    function testFuzz_FeeSplit_AlwaysSumsExactlyToFeeAmount(uint256 volume, uint256 ethIn)
        public
    {
        BondingCurve c = _deployCleanCapCurve();
        volume = bound(volume, 0, 2_000e18);
        _setCumulativeVolume(c, volume);

        ethIn = bound(ethIn, 1, 20 ether);
        uint256 quoted = c.quoteBuy(ethIn);
        vm.assume(quoted > 0 && quoted <= c.realTokenReserve() && quoted <= c.maxWalletTokens());

        uint256 feeAmount = _feeOf(ethIn);
        vm.assume(feeAmount > 0);

        uint256 creatorOwedBefore = c.creatorFeesOwed();
        uint256 protocolOwedBefore = c.protocolFeesOwed();

        vm.deal(alice, ethIn);
        vm.prank(alice);
        c.buy{value: ethIn}(0);

        uint256 creatorDelta = c.creatorFeesOwed() - creatorOwedBefore;
        uint256 protocolDelta = c.protocolFeesOwed() - protocolOwedBefore;

        assertEq(creatorDelta + protocolDelta, feeAmount, "split must sum exactly to feeAmount");
    }

    /* -------------------------------------------------------------------- */
    /*                    Cumulative volume tracking correctness            */
    /* -------------------------------------------------------------------- */

    function test_CumulativeVolume_ZeroBeforeAnyTrade() public view {
        assertEq(curve.cumulativeVolume(), 0);
    }

    /// @dev Runs a sequence of buys and sells (spread across two buyers so
    /// no single wallet approaches the max-wallet cap) and asserts
    /// cumulativeVolume after each trade equals the running sum of each
    /// trade's GROSS ETH value (msg.value for buys, gross pre-fee output
    /// for sells).
    function test_CumulativeVolume_TracksAcrossManyTrades() public {
        uint256 expectedVolume = 0;

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        // Buy #1
        vm.prank(alice);
        curve.buy{value: 1 ether}(0);
        expectedVolume += 1 ether;
        assertEq(curve.cumulativeVolume(), expectedVolume);

        // Buy #2
        vm.prank(bob);
        curve.buy{value: 2 ether}(0);
        expectedVolume += 2 ether;
        assertEq(curve.cumulativeVolume(), expectedVolume);

        // Sell #1 (alice sells everything she holds)
        uint256 aliceBal = token.balanceOf(alice);
        vm.startPrank(alice);
        token.approve(address(curve), aliceBal);
        uint256 grossBeforeSell = curve.quoteSellGross(aliceBal);
        curve.sell(aliceBal, 0);
        vm.stopPrank();
        expectedVolume += grossBeforeSell;
        assertEq(curve.cumulativeVolume(), expectedVolume);

        // Buy #3
        vm.prank(alice);
        curve.buy{value: 3 ether}(0);
        expectedVolume += 3 ether;
        assertEq(curve.cumulativeVolume(), expectedVolume);

        // Sell #2 (bob sells everything he holds)
        uint256 bobBal = token.balanceOf(bob);
        vm.startPrank(bob);
        token.approve(address(curve), bobBal);
        uint256 grossBeforeSell2 = curve.quoteSellGross(bobBal);
        curve.sell(bobBal, 0);
        vm.stopPrank();
        expectedVolume += grossBeforeSell2;
        assertEq(curve.cumulativeVolume(), expectedVolume);
    }

    /// @dev The fee split used for trade N is based on volume accumulated
    /// from trades 1..N-1 only — a trade cannot bump its own rate.
    function test_CumulativeVolume_TradeDoesNotAffectItsOwnFeeSplit() public {
        BondingCurve c = _deployCleanCapCurve();

        // Right at the boundary: one more wei of volume would push bps to
        // 8500, but THIS trade's own volume must not count toward its own
        // split, so it should still be evaluated at cumulativeVolume=999e18.
        _setCumulativeVolume(c, 999e18);
        uint256 bpsBefore = c.currentCreatorFeeShareBps();
        assertLt(bpsBefore, 8_500);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        c.buy{value: 10 ether}(0);

        // Volume now exceeds the cap (999e18 + 10e18 > 1000e18); the fee
        // actually collected on the trade above must have used bpsBefore,
        // not the post-trade (capped) 8500 rate. We can't read the
        // in-flight rate directly, but we can confirm the post-trade rate
        // moved to the capped 8500 while the trade's own recorded fee
        // split (creator/protocol) is internally consistent with
        // `bpsBefore`, not the new rate.
        uint256 feeAmount = _feeOf(10 ether);
        uint256 expectedCreatorFee = (feeAmount * bpsBefore) / BPS_DENOMINATOR;
        assertEq(c.creatorFeesOwed(), expectedCreatorFee);
        assertEq(c.currentCreatorFeeShareBps(), 8_500, "post-trade rate should now read as capped");
    }

    /* -------------------------------------------------------------------- */
    /*                 Pull-payment withdrawal correctness                  */
    /* -------------------------------------------------------------------- */

    function test_WithdrawCreatorFees_SendsToCreatorAndResetsOwed() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        curve.buy{value: 10 ether}(0);

        uint256 owed = curve.creatorFeesOwed();
        assertGt(owed, 0);
        uint256 creatorBalBefore = creator.balance;

        // Permissionless: bob triggers it, funds still go to `creator`.
        vm.prank(bob);
        uint256 withdrawn = curve.withdrawCreatorFees();

        assertEq(withdrawn, owed);
        assertEq(creator.balance, creatorBalBefore + owed);
        assertEq(curve.creatorFeesOwed(), 0);
    }

    function test_WithdrawProtocolFees_SendsToTreasuryAndResetsOwed() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        curve.buy{value: 10 ether}(0);

        uint256 owed = curve.protocolFeesOwed();
        assertGt(owed, 0);
        uint256 treasuryBalBefore = protocolTreasury.balance;

        vm.prank(bob);
        uint256 withdrawn = curve.withdrawProtocolFees();

        assertEq(withdrawn, owed);
        assertEq(protocolTreasury.balance, treasuryBalBefore + owed);
        assertEq(curve.protocolFeesOwed(), 0);
    }

    function test_RevertWhen_WithdrawCreatorFeesWithNothingOwed() public {
        vm.expectRevert(bytes("BondingCurve: no creator fees owed"));
        curve.withdrawCreatorFees();
    }

    function test_RevertWhen_WithdrawProtocolFeesWithNothingOwed() public {
        vm.expectRevert(bytes("BondingCurve: no protocol fees owed"));
        curve.withdrawProtocolFees();
    }

    function test_WithdrawCreatorFees_AccumulatesAcrossMultipleTradesBeforeClaim() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        curve.buy{value: 5 ether}(0);
        uint256 owedAfterFirst = curve.creatorFeesOwed();

        vm.prank(alice);
        curve.buy{value: 5 ether}(0);
        uint256 owedAfterSecond = curve.creatorFeesOwed();

        assertGt(owedAfterSecond, owedAfterFirst, "fees should accumulate, not reset, between trades");

        uint256 creatorBalBefore = creator.balance;
        curve.withdrawCreatorFees();
        assertEq(creator.balance, creatorBalBefore + owedAfterSecond);
        assertEq(curve.creatorFeesOwed(), 0);
    }

    /// @dev End-to-end integration against the real `ProtocolTreasury`
    /// contract (not just a plain EOA stand-in) to prove the whole pipe
    /// works: curve accumulates -> withdrawProtocolFees() pushes into the
    /// treasury's `receive()` -> the multisig owner can then withdraw it
    /// out of the treasury.
    function test_Integration_ProtocolFeesFlowThroughRealTreasury() public {
        address multisig = makeAddr("multisig");
        ProtocolTreasury treasury = new ProtocolTreasury(multisig);

        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            address(treasury),
            DEFAULT_ETH_USD_PRICE,
            DEFAULT_DELAY_BLOCKS
        );
        _rollPastLaunchDelay(c);

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        c.buy{value: 5 ether}(0);

        uint256 owed = c.protocolFeesOwed();
        assertGt(owed, 0);

        c.withdrawProtocolFees();
        assertEq(address(treasury).balance, owed);
        assertEq(c.protocolFeesOwed(), 0);

        address payable recipient = payable(makeAddr("multisigDestination"));
        vm.prank(multisig);
        treasury.withdraw(recipient, owed);

        assertEq(recipient.balance, owed);
        assertEq(address(treasury).balance, 0);
    }

    /* -------------------------------------------------------------------- */
    /*                    Reentrancy safety — trading + withdrawals         */
    /* -------------------------------------------------------------------- */

    function test_Reentrancy_SellCannotReenterSell() public {
        ReentrantSellAttacker attacker = new ReentrantSellAttacker(curve, token);

        vm.deal(address(attacker), 10 ether);
        vm.prank(address(attacker));
        uint256 tokensOut = curve.buy{value: 2 ether}(0);
        assertGt(tokensOut, 1, "attacker needs at least 2 tokens for the reentrant sell(1,...)");

        vm.prank(address(attacker));
        token.approve(address(curve), type(uint256).max);

        vm.prank(address(attacker));
        curve.sell(tokensOut / 2, 0);

        assertTrue(attacker.receivedEth(), "attacker never received its legitimate payout");
        assertTrue(attacker.reentryBlocked(), "reentrant sell() call was not blocked");
    }

    function test_Reentrancy_WithdrawCreatorFeesCannotBeReentered() public {
        ReentrantFeeRecipient attacker = new ReentrantFeeRecipient();
        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            address(attacker),
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            DEFAULT_DELAY_BLOCKS
        );
        _rollPastLaunchDelay(c);
        attacker.arm(c, true);

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        c.buy{value: 5 ether}(0);
        assertGt(c.creatorFeesOwed(), 0);

        c.withdrawCreatorFees();

        assertTrue(attacker.receivedEth());
        assertTrue(attacker.reentryBlocked(), "reentrant withdrawCreatorFees() was not blocked");
        assertEq(c.creatorFeesOwed(), 0, "no double payout occurred");
    }

    function test_Reentrancy_WithdrawProtocolFeesCannotBeReentered() public {
        ReentrantFeeRecipient attacker = new ReentrantFeeRecipient();
        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            address(attacker),
            DEFAULT_ETH_USD_PRICE,
            DEFAULT_DELAY_BLOCKS
        );
        _rollPastLaunchDelay(c);
        attacker.arm(c, false);

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        c.buy{value: 5 ether}(0);
        assertGt(c.protocolFeesOwed(), 0);

        c.withdrawProtocolFees();

        assertTrue(attacker.receivedEth());
        assertTrue(attacker.reentryBlocked(), "reentrant withdrawProtocolFees() was not blocked");
        assertEq(c.protocolFeesOwed(), 0, "no double payout occurred");
    }

    /* -------------------------------------------------------------------- */
    /*                       Standard buy / sell behavior                   */
    /* -------------------------------------------------------------------- */

    function test_Buy_TransfersTokensAndUpdatesReserves() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokensOut = curve.buy{value: 1 ether}(0);

        assertGt(tokensOut, 0);
        assertEq(token.balanceOf(alice), tokensOut);
        assertEq(curve.realEthReserve(), 1 ether - _feeOf(1 ether));
        assertEq(address(curve).balance, 1 ether);
    }

    function test_Sell_TransfersEthAndUpdatesReserves() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        uint256 tokensOut = curve.buy{value: 1 ether}(0);

        token.approve(address(curve), tokensOut);
        uint256 ethBefore = alice.balance;
        uint256 netEthOut = curve.sell(tokensOut, 0);
        vm.stopPrank();

        assertEq(alice.balance, ethBefore + netEthOut);
        assertEq(token.balanceOf(alice), 0);
        assertEq(curve.realTokenReserve(), DEFAULT_SELLABLE_SUPPLY);
    }

    function test_QuoteBuy_MatchesActualExecution() public {
        uint256 quoted = curve.quoteBuy(3 ether);

        vm.deal(alice, 3 ether);
        vm.prank(alice);
        uint256 actual = curve.buy{value: 3 ether}(0);

        assertEq(quoted, actual);
    }

    function test_QuoteSell_MatchesActualExecution() public {
        vm.deal(alice, 3 ether);
        vm.startPrank(alice);
        uint256 tokensOut = curve.buy{value: 3 ether}(0);
        token.approve(address(curve), tokensOut);

        uint256 quoted = curve.quoteSell(tokensOut);
        uint256 actual = curve.sell(tokensOut, 0);
        vm.stopPrank();

        assertEq(quoted, actual);
    }

    function test_GetPrice_IncreasesAfterBuy() public {
        uint256 priceBefore = curve.getPrice();

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        curve.buy{value: 5 ether}(0);

        assertGt(curve.getPrice(), priceBefore);
    }

    function test_GetPrice_DecreasesAfterSell() public {
        vm.deal(alice, 5 ether);
        vm.startPrank(alice);
        uint256 tokensOut = curve.buy{value: 5 ether}(0);
        uint256 priceAfterBuy = curve.getPrice();

        token.approve(address(curve), tokensOut);
        curve.sell(tokensOut, 0);
        vm.stopPrank();

        assertLt(curve.getPrice(), priceAfterBuy);
    }

    /* -------------------------------------------------------------------- */
    /*                            Slippage protection                       */
    /* -------------------------------------------------------------------- */

    function test_RevertWhen_BuySlippageExceeded() public {
        uint256 quoted = curve.quoteBuy(1 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("BondingCurve: slippage"));
        curve.buy{value: 1 ether}(quoted + 1);
    }

    function test_RevertWhen_SellSlippageExceeded() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        uint256 tokensOut = curve.buy{value: 1 ether}(0);
        token.approve(address(curve), tokensOut);

        uint256 quoted = curve.quoteSell(tokensOut);
        vm.expectRevert(bytes("BondingCurve: slippage"));
        curve.sell(tokensOut, quoted + 1);
        vm.stopPrank();
    }

    function test_Buy_SucceedsExactlyAtMinTokensOut() public {
        uint256 quoted = curve.quoteBuy(1 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokensOut = curve.buy{value: 1 ether}(quoted);

        assertEq(tokensOut, quoted);
    }

    /* -------------------------------------------------------------------- */
    /*                                Edge cases                            */
    /* -------------------------------------------------------------------- */

    function test_RevertWhen_BuyWithZeroEth() public {
        vm.prank(alice);
        vm.expectRevert(bytes("BondingCurve: zero eth in"));
        curve.buy{value: 0}(0);
    }

    function test_RevertWhen_SellWithZeroTokens() public {
        vm.prank(alice);
        vm.expectRevert(bytes("BondingCurve: zero tokens in"));
        curve.sell(0, 0);
    }

    /// @dev Dust amounts where 1% rounds down to a zero fee must NOT
    /// revert the trade — fee collection is best-effort, not mandatory.
    function test_DustTrade_FeeRoundsToZero_TradeStillSucceeds() public {
        // 50 wei * 1% = 0 (rounds down); the trade must still go through.
        vm.deal(alice, 50);
        vm.prank(alice);
        uint256 tokensOut = curve.buy{value: 50}(0);

        assertGt(tokensOut, 0, "test setup: dust buy should still yield a nonzero token amount");
        assertEq(curve.creatorFeesOwed(), 0);
        assertEq(curve.protocolFeesOwed(), 0);
    }

    function test_RevertWhen_BuyDustAmountTokensOutRoundsToZero() public {
        (, BondingCurve c) = _deployPair(
            1e18, 1_000e18, 1e18, creator, protocolTreasury, DEFAULT_ETH_USD_PRICE, 0
        );
        _rollPastLaunchDelay(c);

        vm.deal(alice, 1);
        vm.prank(alice);
        vm.expectRevert(bytes("BondingCurve: zero tokens out"));
        c.buy{value: 1}(0);
    }

    function test_RevertWhen_SellDustAmountRoundsToZero() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        curve.buy{value: 1 ether}(0);

        vm.startPrank(alice);
        token.approve(address(curve), 1);
        vm.expectRevert(bytes("BondingCurve: zero eth out"));
        curve.sell(1, 0);
        vm.stopPrank();
    }

    function test_RevertWhen_BuyExceedsRemainingRealTokenReserve_NearEmptyCurve() public {
        // Use a dedicated curve whose max-wallet cap is set high enough
        // (huge total supply relative to what a single "drain the curve"
        // buy would produce) that the liquidity check — not the cap — is
        // what's being exercised here.
        (, BondingCurve c) = _deployPair(
            1_000_000_000_000e18,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            0
        );
        _rollPastLaunchDelay(c);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        c.buy{value: 10 ether}(0);

        uint256 remaining = c.realTokenReserve();
        assertGt(remaining, 0);

        uint256 hugeEthIn = 1_000_000_000 ether;
        uint256 wouldBeQuoted = c.quoteBuy(hugeEthIn);
        assertGt(wouldBeQuoted, remaining, "test setup invalid");

        vm.deal(bob, hugeEthIn);
        vm.prank(bob);
        vm.expectRevert(bytes("BondingCurve: insufficient token liquidity"));
        c.buy{value: hugeEthIn}(0);
    }

    function test_RevertWhen_SellExceedsRealEthReserve_SimulatedDivergence() public {
        vm.deal(alice, 5 ether);
        vm.startPrank(alice);
        uint256 tokensOut = curve.buy{value: 5 ether}(0);
        token.approve(address(curve), tokensOut);
        vm.stopPrank();

        stdstore.target(address(curve)).sig("realEthReserve()").checked_write(uint256(1));

        vm.prank(alice);
        vm.expectRevert(bytes("BondingCurve: insufficient eth liquidity"));
        curve.sell(tokensOut, 0);
    }

    /* -------------------------------------------------------------------- */
    /*                        Anti-snipe block delay — buy-only             */
    /* -------------------------------------------------------------------- */

    function test_RevertWhen_BuyInLaunchBlock() public {
        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            1
        );
        // No roll: still in the deployment's own block.
        assertEq(block.number, c.launchBlock());

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurve.AntiSnipeDelayActive.selector, block.number, c.launchBlock() + 1
            )
        );
        c.buy{value: 1 ether}(0);
    }

    /// @dev Exact boundary: at `block.number == launchBlock + delayBlocks`
    /// the check `block.number <= launchBlock + delayBlocks` is still
    /// true, so `buy` must still revert.
    function test_RevertWhen_BuyExactlyAtUnlockBlock() public {
        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            3
        );
        uint256 unlockBlock = c.launchBlock() + 3;
        vm.roll(unlockBlock);
        assertEq(block.number, unlockBlock);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(BondingCurve.AntiSnipeDelayActive.selector, unlockBlock, unlockBlock)
        );
        c.buy{value: 1 ether}(0);
    }

    /// @dev Exact boundary: at `block.number == launchBlock + delayBlocks +
    /// 1` the buy must succeed — one block past the unlock block.
    function test_Buy_SucceedsOneBlockAfterUnlockBlock() public {
        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            3
        );
        uint256 unlockBlock = c.launchBlock() + 3;
        vm.roll(unlockBlock + 1);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokensOut = c.buy{value: 1 ether}(0);

        assertGt(tokensOut, 0);
    }

    /// @dev `delayBlocks = 0` still blocks a same-block deploy+buy bundle
    /// (block.number cannot be < launchBlock), but succeeds from the very
    /// next block onward.
    function test_DelayBlocksZero_StillBlocksSameBlockSnipeButAllowsNextBlock() public {
        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            0
        );

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurve.AntiSnipeDelayActive.selector, block.number, c.launchBlock()
            )
        );
        c.buy{value: 1 ether}(0);

        vm.roll(block.number + 1);
        vm.prank(alice);
        uint256 tokensOut = c.buy{value: 1 ether}(0);
        assertGt(tokensOut, 0);
    }

    /// @dev `sell` must work identically whether called before, exactly
    /// at, or after the anti-snipe unlock block — the delay is buy-only.
    /// A seller needs tokens to sell, so we grant a starting balance
    /// directly via storage (bypassing `buy`, which we're deliberately
    /// NOT calling here, precisely to isolate `sell` from `buy`'s gate).
    function test_Sell_UnaffectedByLaunchDelay_EvenInLaunchBlock() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            1_000
        );
        assertEq(block.number, c.launchBlock(), "test setup: still in the launch block");

        // Give alice a token balance directly (no buy involved) and seed
        // the curve with some real ETH reserve to sell into, also via
        // direct storage writes, so this test exercises `sell` in
        // complete isolation from `buy`'s anti-snipe gate.
        stdstore.target(address(t)).sig("balanceOf(address)").with_key(alice).checked_write(
            1_000e18
        );
        stdstore.target(address(c)).sig("realTokenReserve()").checked_write(
            DEFAULT_SUPPLY - 1_000e18
        );
        stdstore.target(address(c)).sig("realEthReserve()").checked_write(uint256(10 ether));
        vm.deal(address(c), 10 ether);

        vm.startPrank(alice);
        t.approve(address(c), 1_000e18);
        uint256 ethOut = c.sell(1_000e18, 0);
        vm.stopPrank();

        assertGt(ethOut, 0, "sell should succeed even inside the anti-snipe window");
    }

    function testFuzz_AntiSnipe_BuyGatedExactlyAtBoundary(uint256 delayBlocks, uint256 rollBy)
        public
    {
        delayBlocks = bound(delayBlocks, 0, 1_000);
        rollBy = bound(rollBy, 0, 2_000);

        (, BondingCurve c) = _deployPair(
            DEFAULT_SUPPLY,
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_ETH_USD_PRICE,
            delayBlocks
        );

        uint256 launchBlock = c.launchBlock();
        vm.roll(launchBlock + rollBy);

        vm.deal(alice, 1 ether);
        vm.prank(alice);

        if (block.number <= launchBlock + delayBlocks) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    BondingCurve.AntiSnipeDelayActive.selector, block.number, launchBlock + delayBlocks
                )
            );
            c.buy{value: 1 ether}(0);
        } else {
            uint256 tokensOut = c.buy{value: 1 ether}(0);
            assertGt(tokensOut, 0);
        }
    }

    /* -------------------------------------------------------------------- */
    /*                         Max-wallet cap — buy-only                    */
    /* -------------------------------------------------------------------- */

    /// @dev Reuses the exact same clean-number scenario as
    /// `test_PricingFormula_BuyMatchesManualCalculation` (tokensOut lands
    /// EXACTLY on `maxWalletTokens`), but as a focused cap-boundary check
    /// rather than a pricing hand-calc.
    function test_Buy_SucceedsExactlyAtMaxWalletCap() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployPair(
            10_000e18, 7_821e18, 12_000e18, creator, protocolTreasury, DEFAULT_ETH_USD_PRICE, 0
        );
        _rollPastLaunchDelay(c);

        assertEq(c.maxWalletTokens(), 250e18);
        assertEq(c.quoteBuy(100e18), 250e18, "test setup: buy must land exactly on the cap");

        vm.deal(alice, 100e18);
        vm.prank(alice);
        uint256 tokensOut = c.buy{value: 100e18}(0);

        assertEq(tokensOut, 250e18);
        assertEq(t.balanceOf(alice), c.maxWalletTokens());
    }

    /// @dev Same scenario, but alice starts the trade already holding 1
    /// wei of the token (simulating a prior transfer in from elsewhere —
    /// deliberately not via `buy`, to isolate the cap check from any
    /// other buy-path behavior). The identical 100e18 buy would put her at
    /// exactly `maxWalletTokens + 1`, one wei over — must revert with the
    /// exact `MaxWalletExceeded` values, and must NOT partially fill.
    function test_RevertWhen_BuyExceedsMaxWalletCapByOneWei() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployPair(
            10_000e18, 7_821e18, 12_000e18, creator, protocolTreasury, DEFAULT_ETH_USD_PRICE, 0
        );
        _rollPastLaunchDelay(c);

        stdstore.target(address(t)).sig("balanceOf(address)").with_key(alice).checked_write(
            uint256(1)
        );
        assertEq(t.balanceOf(alice), 1);

        uint256 cap = c.maxWalletTokens();
        uint256 quoted = c.quoteBuy(100e18);
        assertEq(quoted, cap, "test setup: buy amount must still quote exactly the cap");

        vm.deal(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(BondingCurve.MaxWalletExceeded.selector, cap + 1, cap)
        );
        c.buy{value: 100e18}(0);

        // No partial fill: alice's balance is untouched by the reverted
        // attempt, and the curve's reserves didn't move either.
        assertEq(t.balanceOf(alice), 1);
        assertEq(c.realTokenReserve(), 8_000e18, "initial sellable reserve is 80% of totalSupply");
        assertEq(c.realEthReserve(), 0);
    }
}
