// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {InfoFiCampaign} from "../src/InfoFiCampaign.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";
import {MockUniswapV3Pool} from "./mocks/MockUniswapV3Pool.sol";
import {MockUniswapV3FactoryStub} from "./mocks/MockUniswapV3FactoryStub.sol";

/// @dev Full suite for the InfoFi campaign layer.
///
/// The properties that actually matter here are custodial rather than
/// arithmetic: a creator locking up to 5% of supply needs to know the pool
/// cannot be taken, cannot be opened on a whim, and cannot be left in limbo.
/// So alongside the carve-out maths, these tests pin down the state machine
/// — every illegal transition, the one-way open, and the fact that the only
/// two exits are "a winner claims" and "it burns".
contract InfoFiCampaignTest is Test {
    string internal constant NAME = "Loxley Doge";
    string internal constant SYMBOL = "LDOGE";
    uint8 internal constant DECIMALS = 18;

    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint256 internal constant VIRTUAL_ETH = 6e18;
    uint256 internal constant GRADUATION_THRESHOLD = 4.2 ether;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant LIQUIDITY_RESERVE_BPS = 2_000;

    uint256 internal constant MCAP_THRESHOLD = 120_000e18; // $120k
    uint64 internal constant SUSTAINED = 24 hours;
    uint24 internal constant POOL_FEE = 3000;

    address internal team = makeAddr("team");
    address internal creator = makeAddr("creator");
    address internal protocolTreasury = makeAddr("protocolTreasury");
    address internal migrator = makeAddr("migrator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    InfoFiCampaign internal campaign;
    MockV3Aggregator internal ethUsdFeed;
    MockUniswapV3FactoryStub internal factory;
    address internal weth9 = makeAddr("weth9");

    function setUp() public {
        // Start well past the epoch: several tests rewind by ABANDON_PERIOD
        // or compare against `block.timestamp - x`, which underflows at 0.
        vm.warp(1_000 days);

        ethUsdFeed = new MockV3Aggregator(8, 3_000e8);
        factory = new MockUniswapV3FactoryStub();
        campaign = new InfoFiCampaign(
            team, MCAP_THRESHOLD, SUSTAINED, address(factory), weth9, POOL_FEE, address(ethUsdFeed), false
        );
    }

    /* ------------------------------------------------------------------ */
    /*                              Helpers                               */
    /* ------------------------------------------------------------------ */

    /// @dev Deploys a token+curve with `infoFiBps` carved out. The curve
    ///      registers its pool with `campaign` from its own constructor.
    function _deploy(uint256 infoFiBps)
        internal
        returns (ImmutableLaunchToken t, BondingCurve c)
    {
        return _deployWith(infoFiBps, address(0), _virtualTokenFor(infoFiBps));
    }

    function _deployWith(uint256 infoFiBps, address feeRecipient, uint256 virtualToken)
        internal
        returns (ImmutableLaunchToken t, BondingCurve c)
    {
        uint256 nonce = vm.getNonce(address(this));
        address predicted = vm.computeCreateAddress(address(this), nonce + 1);

        t = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, SUPPLY, predicted);
        c = new BondingCurve(
            IERC20(address(t)),
            VIRTUAL_ETH,
            virtualToken,
            creator,
            protocolTreasury,
            0,
            GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdFeed),
            feeRecipient,
            infoFiBps,
            infoFiBps == 0 ? address(0) : address(campaign),
            address(0)
        );
        require(address(c) == predicted, "test setup: nonce mismatch");
        vm.roll(block.number + c.delayBlocks() + 1);
    }

    /// @dev Keeps `virtualTokenReserve` at 4/3 of the SELLABLE supply, which
    ///      is what holds graduation at a constant ~96% of sellable no matter
    ///      how much is carved out. See `test_Graduation_ReachableAtEvery...`.
    function _virtualTokenFor(uint256 infoFiBps) internal pure returns (uint256) {
        uint256 sellable = (SUPPLY * (BPS - LIQUIDITY_RESERVE_BPS - infoFiBps)) / BPS;
        return (sellable * 4) / 3;
    }

    /// @dev Drives the curve's market cap by moving the ETH/USD feed, which
    ///      is a linear multiplier on `currentMarketCapUsd()`. Far more
    ///      stable than trying to buy an exact market cap onto the curve.
    ///
    ///      Rounds the new answer UP, so the resulting market cap always
    ///      lands at or above `targetUsd18` rather than a wei short — which
    ///      matters for the tests that sit exactly ON the threshold, since
    ///      the contract's comparison is `>=`. Tests that need to be BELOW
    ///      the threshold should ask for a clearly-lower figure rather than
    ///      `threshold - 1`.
    function _setMcap(BondingCurve c, uint256 targetUsd18) internal {
        // Re-stamp the feed first: a preceding `vm.warp` may have pushed it
        // past PRICE_STALENESS_THRESHOLD, which makes the read below return
        // (0, false) and has nothing to do with the actual price.
        (, int256 answer,,,) = ethUsdFeed.latestRoundData();
        ethUsdFeed.updateAnswer(answer);

        (uint256 mcapNow, bool ok) = c.currentMarketCapUsd();
        require(ok && mcapNow > 0, "test: curve has no mcap yet (buy first)");

        uint256 numerator = uint256(answer) * targetUsd18;
        uint256 newAnswer = (numerator + mcapNow - 1) / mcapNow; // ceil
        require(newAnswer > 0, "test: target too small to represent");
        ethUsdFeed.updateAnswer(int256(newAnswer));
    }

    /// @dev A single buy so the curve has a non-zero price to scale from.
    ///
    ///      Deliberately small: on these production-shaped virtual reserves
    ///      a 0.5 ETH buy mints ~133M tokens against a 25M max-wallet cap.
    ///
    ///      Deliberately NOT `alice` or `bob` either — they are campaign
    ///      claimants, and seeding with them would fold a curve purchase
    ///      into the balance assertions that are supposed to measure only
    ///      what the campaign paid out.
    function _seed(BondingCurve c) internal {
        address seeder = makeAddr("curveSeeder");
        vm.deal(seeder, 1 ether);
        vm.prank(seeder);
        c.buy{value: 0.05 ether}(0);
    }

    /// @dev Pushes the curve above the threshold and holds it there long
    ///      enough to qualify, leaving the campaign in `Eligible`.
    function _makeEligible(ImmutableLaunchToken t, BondingCurve c) internal {
        _seed(c);
        _setMcap(c, MCAP_THRESHOLD * 2);
        campaign.recordMarketCap(address(t));
        vm.warp(block.timestamp + SUSTAINED + 1);
        // The feed's own staleness check is independent of our warp.
        ethUsdFeed.updateAnswer(_currentAnswer());
        campaign.recordMarketCap(address(t));
    }

    function _currentAnswer() internal view returns (int256 answer) {
        (, answer,,,) = ethUsdFeed.latestRoundData();
    }

    /// @dev Two-leaf merkle tree over (account, amount), matching the
    ///      contract's double-hashed leaf encoding.
    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /* ------------------------------------------------------------------ */
    /*                       Allocation carve-out                         */
    /* ------------------------------------------------------------------ */

    function test_CarveOut_ExcludedFromSellableSupplyAndHeldByCampaign() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(500); // 5%

        uint256 expectedInfoFi = (SUPPLY * 500) / BPS;
        uint256 expectedLiquidity = (SUPPLY * LIQUIDITY_RESERVE_BPS) / BPS;

        assertEq(c.infoFiReserveTokens(), expectedInfoFi, "infofi reserve wrong");
        assertEq(c.liquidityReserveTokens(), expectedLiquidity, "liquidity reserve wrong");
        assertEq(
            c.realTokenReserve(),
            SUPPLY - expectedLiquidity - expectedInfoFi,
            "sellable supply must exclude BOTH reserves"
        );

        // The pool physically left the curve at construction.
        assertEq(t.balanceOf(address(campaign)), expectedInfoFi, "campaign should hold the pool");
        assertEq(
            t.balanceOf(address(c)),
            SUPPLY - expectedInfoFi,
            "curve keeps only sellable + liquidity reserve"
        );
    }

    function test_CarveOut_ZeroBpsIsAFullOptOut() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(0);

        assertEq(c.infoFiReserveTokens(), 0);
        assertEq(c.infoFiBps(), 0);
        assertEq(c.infoFiCampaign(), address(0), "no campaign wired when opted out");
        assertEq(t.balanceOf(address(campaign)), 0, "campaign must hold nothing");
        assertEq(
            c.realTokenReserve(),
            SUPPLY - (SUPPLY * LIQUIDITY_RESERVE_BPS) / BPS,
            "sellable supply unchanged from the pre-InfoFi behaviour"
        );

        // Nothing was ever registered, so the campaign has no record at all.
        assertEq(uint8(_state(address(t))), uint8(InfoFiCampaign.State.None));
    }

    /// @dev Every legal allocation registers exactly what it carved out.
    function test_CarveOut_ExactAtEveryWholePercent() public {
        for (uint256 pct = 0; pct <= 5; pct++) {
            (ImmutableLaunchToken t, BondingCurve c) = _deploy(pct * 100);
            uint256 expected = (SUPPLY * pct * 100) / BPS;

            assertEq(c.infoFiReserveTokens(), expected, "carve-out wrong");
            assertEq(t.balanceOf(address(campaign)), expected, "campaign balance wrong");

            (, uint256 allocation,) = _campaignCore(address(t));
            assertEq(allocation, expected, "registered allocation wrong");
        }
    }

    function test_RevertWhen_AllocationAboveMax() public {
        uint256 nonce = vm.getNonce(address(this));
        address predicted = vm.computeCreateAddress(address(this), nonce + 1);
        ImmutableLaunchToken t =
            new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, SUPPLY, predicted);

        vm.expectRevert(bytes("BondingCurve: infofi allocation too high"));
        new BondingCurve(
            IERC20(address(t)),
            VIRTUAL_ETH,
            _virtualTokenFor(500),
            creator,
            protocolTreasury,
            0,
            GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdFeed),
            address(0),
            501, // one bp over MAX_INFOFI_BPS
            address(campaign),
            address(0)
        );
    }

    function test_RevertWhen_AllocationSetButCampaignIsZero() public {
        uint256 nonce = vm.getNonce(address(this));
        address predicted = vm.computeCreateAddress(address(this), nonce + 1);
        ImmutableLaunchToken t =
            new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, SUPPLY, predicted);

        vm.expectRevert(bytes("BondingCurve: infofi campaign is zero address"));
        new BondingCurve(
            IERC20(address(t)),
            VIRTUAL_ETH,
            _virtualTokenFor(300),
            creator,
            protocolTreasury,
            0,
            GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdFeed),
            address(0),
            300,
            address(0),
            address(0)
        );
    }

    /// @dev The reason `_virtualTokenFor` exists. With a FIXED virtual token
    /// reserve a 5% carve-out leaves only ~0.27% headroom between the tokens
    /// graduation needs and the tokens that exist to sell — scaling it holds
    /// that margin constant instead.
    function test_Graduation_ReachableAtEveryAllocation() public {
        for (uint256 pct = 0; pct <= 5; pct++) {
            (, BondingCurve c) = _deploy(pct * 100);

            uint256 sellable = c.realTokenReserve();
            for (uint256 i = 0; i < 400 && !c.graduated(); i++) {
                address buyer = makeAddr(
                    string.concat("gradBuyer", vm.toString(pct), "_", vm.toString(i))
                );
                uint256 quoted = c.quoteBuy(0.05 ether);
                if (quoted == 0 || quoted > c.realTokenReserve() || quoted > c.maxWalletTokens()) {
                    break;
                }
                vm.deal(buyer, 0.05 ether);
                vm.prank(buyer);
                c.buy{value: 0.05 ether}(0);
            }

            assertTrue(
                c.graduated(),
                string.concat("must graduate at ", vm.toString(pct), "% infofi allocation")
            );
            assertGt(c.realTokenReserve(), 0, "must retain sellable headroom at graduation");
            // Headroom stays proportional rather than collapsing.
            assertGt(
                (c.realTokenReserve() * 1000) / sellable,
                20,
                "headroom should stay above 2% of sellable"
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*                       Creator fee redirection                      */
    /* ------------------------------------------------------------------ */

    function test_CreatorFees_DefaultToCreatorWhenRecipientBlank() public {
        (, BondingCurve c) = _deploy(0);
        assertEq(c.creatorFeeRecipient(), creator, "blank must default to creator");

        _seed(c);
        uint256 owed = c.creatorFeesOwed();
        assertGt(owed, 0);

        uint256 before = creator.balance;
        c.withdrawCreatorFees();
        assertEq(creator.balance - before, owed, "creator should be paid");
    }

    function test_CreatorFees_RouteToRedirectAddressWhenSet() public {
        address treasury = makeAddr("creatorTreasury");
        (, BondingCurve c) = _deployWith(0, treasury, _virtualTokenFor(0));

        assertEq(c.creatorFeeRecipient(), treasury);
        assertEq(c.creator(), creator, "creator identity must be unchanged");

        _seed(c);
        uint256 owed = c.creatorFeesOwed();
        assertGt(owed, 0);

        uint256 creatorBefore = creator.balance;
        uint256 treasuryBefore = treasury.balance;
        c.withdrawCreatorFees();

        assertEq(treasury.balance - treasuryBefore, owed, "redirect target should be paid");
        assertEq(creator.balance, creatorBefore, "creator wallet must NOT be paid");
    }

    /* ------------------------------------------------------------------ */
    /*                       Eligibility boundaries                       */
    /* ------------------------------------------------------------------ */

    function test_Eligibility_NotTriggeredBelowThreshold() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _seed(c);
        // Comfortably below rather than `threshold - 1`: `_setMcap` rounds
        // up, so a one-wei gap is not reliably representable.
        _setMcap(c, MCAP_THRESHOLD / 2);

        campaign.recordMarketCap(address(t));
        assertEq(uint8(_state(address(t))), uint8(InfoFiCampaign.State.Registered));
        assertEq(campaign.qualifiesAt(address(t)), 0, "timer must not start below threshold");
    }

    /// @dev Exactly ON the threshold counts — the check is `>=`.
    function test_Eligibility_StartsTimerExactlyAtThreshold() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _seed(c);
        _setMcap(c, MCAP_THRESHOLD);

        campaign.recordMarketCap(address(t));
        assertEq(
            campaign.qualifiesAt(address(t)),
            uint64(block.timestamp) + SUSTAINED,
            "timer should start when mcap equals the threshold"
        );
    }

    /// @dev One second short of the duration must NOT qualify; one second
    /// later it must. This is the boundary the whole gate turns on.
    function test_Eligibility_BoundaryOneSecondEitherSide() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _seed(c);
        _setMcap(c, MCAP_THRESHOLD * 2);
        campaign.recordMarketCap(address(t));

        vm.warp(block.timestamp + SUSTAINED - 1);
        ethUsdFeed.updateAnswer(_currentAnswer());
        campaign.recordMarketCap(address(t));
        assertEq(
            uint8(_state(address(t))),
            uint8(InfoFiCampaign.State.Registered),
            "must NOT qualify one second early"
        );

        vm.warp(block.timestamp + 1);
        ethUsdFeed.updateAnswer(_currentAnswer());
        campaign.recordMarketCap(address(t));
        assertEq(
            uint8(_state(address(t))),
            uint8(InfoFiCampaign.State.Eligible),
            "must qualify exactly on the boundary"
        );
    }

    /// @dev A dip resets the streak — the window is continuous, not cumulative.
    function test_Eligibility_DipBelowThresholdResetsTheStreak() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _seed(c);
        _setMcap(c, MCAP_THRESHOLD * 2);
        campaign.recordMarketCap(address(t));

        // 23 hours in — nearly there.
        vm.warp(block.timestamp + 23 hours);
        _setMcap(c, MCAP_THRESHOLD / 2); // dip
        campaign.recordMarketCap(address(t));
        assertEq(campaign.qualifiesAt(address(t)), 0, "dip must clear the timer");

        // Back above, but the clock restarts from here.
        _setMcap(c, MCAP_THRESHOLD * 2);
        campaign.recordMarketCap(address(t));
        assertEq(
            campaign.qualifiesAt(address(t)),
            uint64(block.timestamp) + SUSTAINED,
            "streak must restart, not resume"
        );

        // The originally-remaining hour is no longer enough.
        vm.warp(block.timestamp + 1 hours + 1);
        ethUsdFeed.updateAnswer(_currentAnswer());
        campaign.recordMarketCap(address(t));
        assertEq(
            uint8(_state(address(t))),
            uint8(InfoFiCampaign.State.Registered),
            "must not qualify on a reset streak"
        );
    }

    function test_Eligibility_EmitsEventForTeamReviewButDoesNotAutoOpen() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);

        assertEq(
            uint8(_state(address(t))),
            uint8(InfoFiCampaign.State.Eligible),
            "eligible, and no further"
        );
        (,,,,,, uint64 windowEnds,,) = _unpack(address(t));
        assertEq(windowEnds, 0, "no window may start without a team call");
    }

    function test_RevertWhen_RecordMarketCapOnStalePriceFeed() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _seed(c);
        _setMcap(c, MCAP_THRESHOLD * 2);

        vm.warp(block.timestamp + 2 hours); // beyond PRICE_STALENESS_THRESHOLD

        vm.expectRevert(
            abi.encodeWithSelector(InfoFiCampaign.PriceUnavailable.selector, address(t))
        );
        campaign.recordMarketCap(address(t));
    }

    /* ------------------------------------------------------------------ */
    /*                      One-way campaign opening                      */
    /* ------------------------------------------------------------------ */

    function test_OpenCampaign_StartsSevenDayWindowAndLocksPool() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);

        uint256 pool = c.infoFiReserveTokens();
        vm.prank(team);
        campaign.openCampaign(address(t));

        (,, uint256 allocation,,,, uint64 windowEnds,,) = _unpack(address(t));
        assertEq(uint8(_state(address(t))), uint8(InfoFiCampaign.State.Open));
        assertEq(allocation, pool, "allocation must not move on open");
        assertEq(windowEnds, uint64(block.timestamp) + 7 days, "7-day window");
    }

    function test_RevertWhen_NonTeamOpensCampaign() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);

        vm.prank(alice);
        vm.expectRevert(InfoFiCampaign.NotTeam.selector);
        campaign.openCampaign(address(t));
    }

    function test_RevertWhen_OpeningBeforeEligible() public {
        (ImmutableLaunchToken t,) = _deploy(300);

        vm.prank(team);
        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.WrongState.selector,
                address(t),
                InfoFiCampaign.State.Eligible,
                InfoFiCampaign.State.Registered
            )
        );
        campaign.openCampaign(address(t));
    }

    /// @dev The one-way guarantee: no second open, ever.
    function test_RevertWhen_OpeningTwice() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);

        vm.prank(team);
        campaign.openCampaign(address(t));

        vm.prank(team);
        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.WrongState.selector,
                address(t),
                InfoFiCampaign.State.Eligible,
                InfoFiCampaign.State.Open
            )
        );
        campaign.openCampaign(address(t));
    }

    /// @dev A collapsing market cap after opening changes nothing. This is
    /// the "no cancellation regardless of subsequent mcap movement" rule.
    function test_OpenCampaign_SurvivesMarketCapCollapse() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);

        vm.prank(team);
        campaign.openCampaign(address(t));

        _setMcap(c, 1e18); // $1 market cap

        // The price is no longer even readable through the campaign path.
        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.WrongState.selector,
                address(t),
                InfoFiCampaign.State.Registered,
                InfoFiCampaign.State.Open
            )
        );
        campaign.recordMarketCap(address(t));

        assertEq(
            uint8(_state(address(t))),
            uint8(InfoFiCampaign.State.Open),
            "campaign must remain open"
        );
    }

    /* ------------------------------------------------------------------ */
    /*                        Results and claiming                        */
    /* ------------------------------------------------------------------ */

    /// @dev Builds a 2-leaf tree paying alice and bob, publishes it, and
    ///      lets both claim.
    function test_Claim_PaysWinnersAgainstPublishedRoot() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);
        vm.prank(team);
        campaign.openCampaign(address(t));

        uint256 pool = c.infoFiReserveTokens();
        uint256 aliceAmt = (pool * 60) / 100;
        uint256 bobAmt = (pool * 40) / 100;

        bytes32 la = _leaf(alice, aliceAmt);
        bytes32 lb = _leaf(bob, bobAmt);
        bytes32 root = _pair(la, lb);

        vm.warp(block.timestamp + 7 days);
        vm.prank(team);
        campaign.publishResults(address(t), root);

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = lb;
        vm.prank(alice);
        campaign.claim(address(t), aliceAmt, proofA);

        bytes32[] memory proofB = new bytes32[](1);
        proofB[0] = la;
        vm.prank(bob);
        campaign.claim(address(t), bobAmt, proofB);

        assertEq(t.balanceOf(alice), aliceAmt, "alice paid");
        assertEq(t.balanceOf(bob), bobAmt, "bob paid");
        assertEq(campaign.remaining(address(t)), 0, "pool fully distributed");
    }

    function test_RevertWhen_PublishingBeforeWindowCloses() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);
        vm.prank(team);
        campaign.openCampaign(address(t));

        (,,,,,, uint64 windowEnds,,) = _unpack(address(t));

        vm.warp(block.timestamp + 6 days);
        vm.prank(team);
        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.CampaignWindowStillOpen.selector, address(t), windowEnds
            )
        );
        campaign.publishResults(address(t), keccak256("root"));
    }

    function test_RevertWhen_ClaimingTwice() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        (uint256 amt, bytes32[] memory proof) = _settleSingleWinner(t, c, alice);

        vm.prank(alice);
        campaign.claim(address(t), amt, proof);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(InfoFiCampaign.AlreadyClaimed.selector, address(t), alice)
        );
        campaign.claim(address(t), amt, proof);
    }

    function test_RevertWhen_ClaimingWithForgedProof() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        (uint256 amt,) = _settleSingleWinner(t, c, alice);

        bytes32[] memory empty = new bytes32[](0);
        vm.prank(carol); // not in the tree
        vm.expectRevert(InfoFiCampaign.InvalidProof.selector);
        campaign.claim(address(t), amt, empty);
    }

    function test_RevertWhen_ClaimingAfterDeadline() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        (uint256 amt, bytes32[] memory proof) = _settleSingleWinner(t, c, alice);

        (,,,,,,, uint64 deadline,) = _unpack(address(t));
        vm.warp(uint256(deadline) + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.ClaimWindowClosed.selector, address(t), deadline
            )
        );
        campaign.claim(address(t), amt, proof);
    }

    /// @dev A malformed root that over-allocates cannot drain more than the
    /// pool — the contract caps against its own accounting, not the root's.
    function test_Claim_CannotExceedPoolEvenWithAnOverAllocatingRoot() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);
        vm.prank(team);
        campaign.openCampaign(address(t));

        uint256 pool = c.infoFiReserveTokens();
        uint256 tooMuch = pool + 1e18;

        bytes32 la = _leaf(alice, tooMuch);
        bytes32 lb = _leaf(bob, 1e18);
        bytes32 root = _pair(la, lb);

        vm.warp(block.timestamp + 7 days);
        vm.prank(team);
        campaign.publishResults(address(t), root);

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = lb;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(InfoFiCampaign.ClaimExceedsPool.selector, tooMuch, pool)
        );
        campaign.claim(address(t), tooMuch, proofA);
    }

    /* ------------------------------------------------------------------ */
    /*                        Burn on unclaimed / expiry                  */
    /* ------------------------------------------------------------------ */

    function test_Burn_UnclaimedRemainderAfterClaimWindow() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);
        vm.prank(team);
        campaign.openCampaign(address(t));

        uint256 pool = c.infoFiReserveTokens();
        uint256 aliceAmt = pool / 4;
        bytes32 la = _leaf(alice, aliceAmt);
        bytes32 lb = _leaf(bob, pool / 4);
        bytes32 root = _pair(la, lb);

        vm.warp(block.timestamp + 7 days);
        vm.prank(team);
        campaign.publishResults(address(t), root);

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = lb;
        vm.prank(alice);
        campaign.claim(address(t), aliceAmt, proofA);

        (,,,,,,, uint64 deadline,) = _unpack(address(t));
        vm.warp(uint256(deadline) + 1);

        uint256 expectedBurn = pool - aliceAmt;
        campaign.burnUnclaimed(address(t)); // permissionless
        assertEq(
            t.balanceOf(campaign.BURN_ADDRESS()), expectedBurn, "remainder must burn"
        );
        assertEq(t.balanceOf(address(campaign)), 0, "campaign must hold nothing after burn");
        assertEq(uint8(_state(address(t))), uint8(InfoFiCampaign.State.Burned));
    }

    function test_Burn_NeverOpenedAfterAbandonPeriod() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        uint256 pool = c.infoFiReserveTokens();

        vm.warp(block.timestamp + 365 days + 1);
        campaign.burnUnclaimed(address(t));

        assertEq(t.balanceOf(campaign.BURN_ADDRESS()), pool, "whole pool must burn");
        assertEq(uint8(_state(address(t))), uint8(InfoFiCampaign.State.Burned));
    }

    function test_RevertWhen_BurningBeforeAbandonPeriod() public {
        (ImmutableLaunchToken t,) = _deploy(300);
        (,,, , uint64 registeredAt,,,,) = _unpack(address(t));
        uint64 burnableAt = registeredAt + 365 days;

        vm.warp(uint256(burnableAt));
        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.NotAbandonedYet.selector, address(t), burnableAt
            )
        );
        campaign.burnUnclaimed(address(t));
    }

    function test_RevertWhen_BurningWhileClaimWindowStillOpen() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _settleSingleWinner(t, c, alice);
        (,,,,,,, uint64 deadline,) = _unpack(address(t));

        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.ClaimWindowStillOpen.selector, address(t), deadline
            )
        );
        campaign.burnUnclaimed(address(t));
    }

    function test_Burn_OpenedButNeverSettledEventuallyBurns() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        _makeEligible(t, c);
        vm.prank(team);
        campaign.openCampaign(address(t));

        uint256 pool = c.infoFiReserveTokens();
        (,,,,,, uint64 windowEnds,,) = _unpack(address(t));

        vm.warp(uint256(windowEnds) + 30 days + 1);
        campaign.burnUnclaimed(address(t));

        assertEq(t.balanceOf(campaign.BURN_ADDRESS()), pool, "abandoned campaign must burn");
    }

    function test_RevertWhen_BurningTwice() public {
        (ImmutableLaunchToken t,) = _deploy(300);
        vm.warp(block.timestamp + 365 days + 1);
        campaign.burnUnclaimed(address(t));

        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.WrongState.selector,
                address(t),
                InfoFiCampaign.State.Registered,
                InfoFiCampaign.State.Burned
            )
        );
        campaign.burnUnclaimed(address(t));
    }

    /// @dev The custody guarantee, asserted structurally: there is no
    /// function on this contract that sends a pool anywhere the team picks.
    function test_NoOwnerSweepPathExists() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deploy(300);
        uint256 pool = c.infoFiReserveTokens();
        assertEq(t.balanceOf(address(campaign)), pool);

        // The only team-callable entry points are openCampaign and
        // publishResults; neither moves tokens. Everything that CAN move
        // tokens (claim, burnUnclaimed) has a fixed destination.
        vm.startPrank(team);
        vm.expectRevert(); // not eligible yet
        campaign.openCampaign(address(t));
        vm.stopPrank();

        assertEq(
            t.balanceOf(address(campaign)), pool, "no team action may reduce the pool"
        );
        assertEq(t.balanceOf(team), 0, "team must never hold pool tokens");
    }

    /* ------------------------------------------------------------------ */
    /*                            Registration                            */
    /* ------------------------------------------------------------------ */

    function test_RevertWhen_RegisteringTwiceForSameToken() public {
        (ImmutableLaunchToken t,) = _deploy(300);

        vm.expectRevert(
            abi.encodeWithSelector(InfoFiCampaign.AlreadyRegistered.selector, address(t))
        );
        // The curve is the legitimate registrar; a second attempt from
        // anywhere must still fail.
        vm.prank(address(this));
        campaign.registerAllocation(address(t), 1e18);
    }

    function test_RevertWhen_RegisteringWithoutSendingTokens() public {
        (ImmutableLaunchToken t,) = _deploy(0); // opted out, so nothing registered

        // `address(this)` has no `token()`, so the curve-identity check is
        // what rejects this first.
        vm.expectRevert();
        campaign.registerAllocation(address(t), 1e18);
    }

    /* ------------------------------------------------------------------ */
    /*                                Fuzz                                */
    /* ------------------------------------------------------------------ */

    /// @dev For ANY legal allocation the three buckets must exactly
    /// reconstitute total supply, with no rounding leak in either direction.
    function testFuzz_CarveOutAccountingIsExact(uint256 infoFiBps) public {
        infoFiBps = bound(infoFiBps, 0, 500);

        (ImmutableLaunchToken t, BondingCurve c) = _deploy(infoFiBps);

        uint256 infoFi = c.infoFiReserveTokens();
        uint256 liquidity = c.liquidityReserveTokens();
        uint256 sellable = c.realTokenReserve();

        assertEq(infoFi + liquidity + sellable, SUPPLY, "buckets must sum to total supply");
        assertEq(infoFi, (SUPPLY * infoFiBps) / BPS, "infofi bucket exact");
        assertEq(t.balanceOf(address(campaign)), infoFi, "campaign holds exactly the carve-out");
        assertEq(
            t.balanceOf(address(c)), liquidity + sellable, "curve holds exactly the rest"
        );
    }

    /// @dev Whatever the allocation and however long the sustained window,
    /// eligibility flips exactly at `aboveSince + duration` and never before.
    function testFuzz_EligibilityBoundaryHoldsForAnyDuration(
        uint256 infoFiBps,
        uint64 duration,
        uint256 overshoot
    ) public {
        infoFiBps = bound(infoFiBps, 1, 500);
        duration = uint64(bound(duration, 1 minutes, 30 days));
        overshoot = bound(overshoot, 1, 10_000);

        InfoFiCampaign fresh = new InfoFiCampaign(
            team, MCAP_THRESHOLD, duration, address(factory), weth9, POOL_FEE, address(ethUsdFeed), false
        );

        uint256 nonce = vm.getNonce(address(this));
        address predicted = vm.computeCreateAddress(address(this), nonce + 1);
        ImmutableLaunchToken t =
            new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, SUPPLY, predicted);
        BondingCurve c = new BondingCurve(
            IERC20(address(t)),
            VIRTUAL_ETH,
            _virtualTokenFor(infoFiBps),
            creator,
            protocolTreasury,
            0,
            GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdFeed),
            address(0),
            infoFiBps,
            address(fresh),
            address(0)
        );
        vm.roll(block.number + c.delayBlocks() + 1);

        _seed(c);
        _setMcap(c, MCAP_THRESHOLD * (1 + overshoot / 1000));
        fresh.recordMarketCap(address(t));

        // One second short: still not eligible.
        vm.warp(block.timestamp + duration - 1);
        ethUsdFeed.updateAnswer(_currentAnswer());
        fresh.recordMarketCap(address(t));
        (uint8 stateEarly,,) = _campaignCoreOf(fresh, address(t));
        assertEq(stateEarly, uint8(InfoFiCampaign.State.Registered), "early qualification");

        // Exactly on the boundary: eligible.
        vm.warp(block.timestamp + 1);
        ethUsdFeed.updateAnswer(_currentAnswer());
        fresh.recordMarketCap(address(t));
        (uint8 stateOn,,) = _campaignCoreOf(fresh, address(t));
        assertEq(stateOn, uint8(InfoFiCampaign.State.Eligible), "boundary qualification");
    }

    /// @dev No sequence of claims can ever remove more than the pool.
    function testFuzz_ClaimsNeverExceedPool(uint256 infoFiBps, uint256 splitPct) public {
        infoFiBps = bound(infoFiBps, 1, 500);
        splitPct = bound(splitPct, 1, 99);

        (ImmutableLaunchToken t, BondingCurve c) = _deploy(infoFiBps);
        _makeEligible(t, c);
        vm.prank(team);
        campaign.openCampaign(address(t));

        uint256 pool = c.infoFiReserveTokens();
        uint256 aliceAmt = (pool * splitPct) / 100;
        uint256 bobAmt = pool - aliceAmt;

        bytes32 la = _leaf(alice, aliceAmt);
        bytes32 lb = _leaf(bob, bobAmt);
        bytes32 root = _pair(la, lb);

        vm.warp(block.timestamp + 7 days);
        vm.prank(team);
        campaign.publishResults(address(t), root);

        bytes32[] memory pa = new bytes32[](1);
        pa[0] = lb;
        if (aliceAmt > 0) {
            vm.prank(alice);
            campaign.claim(address(t), aliceAmt, pa);
        }

        bytes32[] memory pb = new bytes32[](1);
        pb[0] = la;
        if (bobAmt > 0) {
            vm.prank(bob);
            campaign.claim(address(t), bobAmt, pb);
        }

        assertLe(
            t.balanceOf(alice) + t.balanceOf(bob), pool, "claims must never exceed the pool"
        );
        assertEq(campaign.remaining(address(t)), 0);
    }

    /* ------------------------------------------------------------------ */
    /*                          Struct unpacking                          */
    /* ------------------------------------------------------------------ */

    function _state(address token) internal view returns (InfoFiCampaign.State) {
        (InfoFiCampaign.State s,,,,,,,,) = _unpack(token);
        return s;
    }

    function _unpack(address token)
        internal
        view
        returns (
            InfoFiCampaign.State state,
            address curve,
            uint256 allocation,
            uint256 claimed,
            uint64 registeredAt,
            uint64 aboveSince,
            uint64 windowEnds,
            uint64 claimDeadline,
            bytes32 merkleRoot
        )
    {
        InfoFiCampaign.Campaign memory cm = campaign.getCampaign(token);
        return (
            cm.state,
            cm.curve,
            cm.allocation,
            cm.claimed,
            cm.registeredAt,
            cm.aboveSince,
            cm.windowEnds,
            cm.claimDeadline,
            cm.merkleRoot
        );
    }

    function _campaignCore(address token)
        internal
        view
        returns (uint8 state, uint256 allocation, uint256 claimed)
    {
        return _campaignCoreOf(campaign, token);
    }

    function _campaignCoreOf(InfoFiCampaign c, address token)
        internal
        view
        returns (uint8 state, uint256 allocation, uint256 claimed)
    {
        InfoFiCampaign.Campaign memory cm = c.getCampaign(token);
        return (uint8(cm.state), cm.allocation, cm.claimed);
    }

    /// @dev Opens, closes and settles a campaign with `winner` as the sole
    ///      real recipient, returning their amount and proof.
    function _settleSingleWinner(ImmutableLaunchToken t, BondingCurve c, address winner)
        internal
        returns (uint256 amount, bytes32[] memory proof)
    {
        _makeEligible(t, c);
        vm.prank(team);
        campaign.openCampaign(address(t));

        amount = c.infoFiReserveTokens() / 2;
        bytes32 lw = _leaf(winner, amount);
        bytes32 lother = _leaf(bob == winner ? carol : bob, amount);
        bytes32 root = _pair(lw, lother);

        vm.warp(block.timestamp + 7 days);
        vm.prank(team);
        campaign.publishResults(address(t), root);

        proof = new bytes32[](1);
        proof[0] = lother;
    }
}
