// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {InfoFiCampaign} from "../src/InfoFiCampaign.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";
import {MockUniswapV3FactoryStub} from "./mocks/MockUniswapV3FactoryStub.sol";

/// @dev The two routes a campaign can reach the Campaigns page by.
///
/// **Curve-backed** — the token launched here with an InfoFi allocation. Its
/// eligibility is earned from on-chain state (in testing mode: graduation),
/// and the team opens it.
///
/// **External** — the token launched somewhere else and the project funded a
/// pool directly. There is no curve, so there is no market to measure and
/// eligibility is a team decision; the project then opens its own window.
///
/// The sharpest thing these tests pin down is that the second case never
/// touches the first case's price path. An external pool stores no curve, and
/// a curve read on a zero/EOA address would revert rather than return — so
/// "returns (0, false)" instead of "reverts" is the property under test.
contract InfoFiCampaignPathsTest is Test {
    string internal constant NAME = "Loxley Doge";
    string internal constant SYMBOL = "LDOGE";
    uint8 internal constant DECIMALS = 18;

    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint256 internal constant VIRTUAL_ETH = 6e18;
    uint256 internal constant ETH_USD_PRICE = 3_000e18;
    uint256 internal constant GRADUATION_THRESHOLD = 4.2 ether;
    uint24 internal constant POOL_FEE = 3000;

    address internal team = makeAddr("team");
    address internal creator = makeAddr("creator");
    address internal protocolTreasury = makeAddr("protocolTreasury");
    address internal migrator = makeAddr("migrator");
    address internal projectDev = makeAddr("projectDev");
    address internal stranger = makeAddr("stranger");

    InfoFiCampaign internal campaign;
    MockV3Aggregator internal ethUsdFeed;
    MockUniswapV3FactoryStub internal factory;
    address internal weth9 = makeAddr("weth9");

    function setUp() public {
        vm.warp(1_000 days);
        ethUsdFeed = new MockV3Aggregator(8, 3_000e8);
        factory = new MockUniswapV3FactoryStub();
        // graduationOnly = true: the configuration under test here.
        campaign = new InfoFiCampaign(
            team,
            120_000e18,
            24 hours,
            address(factory),
            weth9,
            POOL_FEE,
            address(ethUsdFeed),
            true
        );
    }

    function _deployWithInfoFi(uint256 bps)
        internal
        returns (ImmutableLaunchToken t, BondingCurve c)
    {
        uint256 sellable = (SUPPLY * (10_000 - 2_000 - bps)) / 10_000;
        uint256 nonce = vm.getNonce(address(this));
        address predicted = vm.computeCreateAddress(address(this), nonce + 1);

        t = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, SUPPLY, predicted);
        c = new BondingCurve(
            IERC20(address(t)),
            VIRTUAL_ETH,
            (sellable * 4) / 3,
            creator,
            protocolTreasury,
            ETH_USD_PRICE,
            0,
            GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdFeed),
            address(0),
            bps,
            address(campaign),
            address(0)
        );
        require(address(c) == predicted, "test setup: nonce mismatch");
        vm.roll(block.number + c.delayBlocks() + 1);
    }

    function _graduate(BondingCurve c) internal {
        for (uint256 i = 0; i < 400 && !c.graduated(); i++) {
            address buyer = address(uint160(5_000 + i));
            uint256 quoted = c.quoteBuy(0.05 ether);
            if (quoted == 0 || quoted > c.realTokenReserve() || quoted > c.maxWalletTokens()) {
                break;
            }
            vm.deal(buyer, 0.05 ether);
            vm.prank(buyer);
            c.buy{value: 0.05 ether}(0);
        }
        require(c.graduated(), "test setup: did not graduate");
    }

    /// @dev A token that launched elsewhere: the whole supply is the
    ///      project's, and they send a slice here to fund the pool.
    function _externalToken(uint256 poolAmount) internal returns (ImmutableLaunchToken t) {
        t = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, SUPPLY, projectDev);
        vm.prank(projectDev);
        t.transfer(address(campaign), poolAmount);
    }

    /* ------------------------------------------------------------------ */
    /*                   Curve-backed: graduation-only                     */
    /* ------------------------------------------------------------------ */

    function test_GraduationOnly_NotEligibleBeforeGraduation() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployWithInfoFi(300);
        vm.deal(address(this), 1 ether);
        c.buy{value: 0.05 ether}(0);

        assertFalse(
            campaign.recordMarketCap(address(t)), "must not qualify before graduation"
        );
        assertEq(
            uint8(campaign.getCampaign(address(t)).state),
            uint8(InfoFiCampaign.State.Registered)
        );
    }

    /// @dev The point of testing mode: graduation alone qualifies, with no
    /// market cap and no sustained window involved.
    function test_GraduationOnly_EligibleImmediatelyOnGraduation() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployWithInfoFi(300);
        _graduate(c);

        assertTrue(campaign.recordMarketCap(address(t)), "graduation alone should qualify");
        assertEq(
            uint8(campaign.getCampaign(address(t)).state),
            uint8(InfoFiCampaign.State.Eligible)
        );
    }

    /// @dev And without consulting the oracle, so a stale feed cannot block a
    /// token that has plainly graduated.
    function test_GraduationOnly_IgnoresStalePriceFeed() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployWithInfoFi(300);
        _graduate(c);
        vm.warp(block.timestamp + 30 days);

        assertTrue(campaign.recordMarketCap(address(t)), "stale feed must not matter");
    }

    function test_GraduationOnly_OnlyTeamOpensCurveBackedCampaign() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployWithInfoFi(300);
        _graduate(c);
        campaign.recordMarketCap(address(t));

        // Even the token's own creator may not open a curve-backed campaign.
        vm.prank(creator);
        vm.expectRevert(InfoFiCampaign.NotTeam.selector);
        campaign.openCampaign(address(t));

        vm.prank(team);
        campaign.openCampaign(address(t));
        assertEq(
            uint8(campaign.getCampaign(address(t)).state), uint8(InfoFiCampaign.State.Open)
        );
    }

    /* ------------------------------------------------------------------ */
    /*                          External pools                            */
    /* ------------------------------------------------------------------ */

    /// @dev A true external (no curve) still needs `markEligible`, and even
    /// once cleared, only the TEAM may open it — every path funnels through
    /// the same admin review now.
    function test_ExternalPool_MarkEligibleThenOnlyTeamOpens() public {
        uint256 pool = 50_000_000e18;
        ImmutableLaunchToken t = _externalToken(pool);

        vm.prank(projectDev);
        campaign.registerExternalPool(address(t), pool, address(0));

        InfoFiCampaign.Campaign memory cm = campaign.getCampaign(address(t));
        assertEq(uint8(cm.state), uint8(InfoFiCampaign.State.Registered));
        assertTrue(cm.isExternal, "should be flagged external");
        assertEq(cm.curve, address(0), "true external pool must record no curve");
        assertEq(cm.owner, projectDev);
        assertEq(cm.allocation, pool);

        // Not eligible yet, so nobody may open it.
        vm.prank(team);
        vm.expectRevert();
        campaign.openCampaign(address(t));

        vm.prank(team);
        campaign.markEligible(address(t));

        // Cleared, but the OWNER still cannot open it themselves.
        vm.prank(projectDev);
        vm.expectRevert(InfoFiCampaign.NotTeam.selector);
        campaign.openCampaign(address(t));

        vm.prank(team);
        campaign.openCampaign(address(t));

        cm = campaign.getCampaign(address(t));
        assertEq(uint8(cm.state), uint8(InfoFiCampaign.State.Open));
        assertEq(cm.windowEnds, uint64(block.timestamp) + 7 days);
    }

    function test_RevertWhen_NonTeamMarksEligible() public {
        uint256 pool = 10_000e18;
        ImmutableLaunchToken t = _externalToken(pool);
        vm.prank(projectDev);
        campaign.registerExternalPool(address(t), pool, address(0));

        vm.prank(projectDev);
        vm.expectRevert(InfoFiCampaign.NotTeam.selector);
        campaign.markEligible(address(t));
    }

    /* ------------------------------------------------------------------ */
    /*         Path B: post-launch buy+lock of an existing loxley token    */
    /* ------------------------------------------------------------------ */

    /// @dev The whole point of the `curve` param: a creator who launched
    /// with infoFiBps=0 can still buy supply back off the curve and lock it
    /// for a campaign later, verified against the REAL deployed curve, and
    /// from then on it behaves exactly like a mint-time allocation —
    /// including qualifying on graduation with no team grant required.
    function test_PathB_LockedPoolVerifiesCurveAndEarnsEligibilityLikeMintTime() public {
        // infoFiBps = 0: nothing reserved at mint.
        (ImmutableLaunchToken t, BondingCurve c) = _deployWithInfoFi(0);
        assertEq(c.infoFiReserveTokens(), 0, "test setup: no mint-time allocation");

        // Creator buys supply on the open curve...
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        uint256 bought = c.buy{value: 0.01 ether}(0);
        assertGt(bought, 0);

        // ...and locks it for a campaign, naming the real curve.
        vm.prank(creator);
        t.transfer(address(campaign), bought);
        vm.prank(creator);
        campaign.registerExternalPool(address(t), bought, address(c));

        InfoFiCampaign.Campaign memory cm = campaign.getCampaign(address(t));
        assertEq(uint8(cm.state), uint8(InfoFiCampaign.State.Registered));
        assertFalse(cm.isExternal, "a verified curve must not be flagged external");
        assertEq(cm.curve, address(c), "curve must be recorded for a verified Path B pool");
        assertEq(cm.owner, creator);

        // markEligible must refuse it while still Registered: it is not a
        // true external, so the team cannot grant eligibility by hand.
        vm.prank(team);
        vm.expectRevert(
            abi.encodeWithSelector(InfoFiCampaign.NotExternalPool.selector, address(t))
        );
        campaign.markEligible(address(t));

        // Not eligible until the curve actually graduates.
        assertFalse(campaign.recordMarketCap(address(t)));

        _graduate(c);
        assertTrue(
            campaign.recordMarketCap(address(t)), "must earn eligibility exactly like Path A"
        );

        // Team opens it, same as Path A.
        vm.prank(team);
        campaign.openCampaign(address(t));
        assertEq(
            uint8(campaign.getCampaign(address(t)).state), uint8(InfoFiCampaign.State.Open)
        );
    }

    function test_RevertWhen_PathBCurveDoesNotMatchToken() public {
        (ImmutableLaunchToken t, BondingCurve c) = _deployWithInfoFi(0);
        // A different token's real curve — wrong pairing.
        (, BondingCurve otherCurve) = _deployWithInfoFi(0);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        uint256 bought = c.buy{value: 0.01 ether}(0);
        vm.prank(creator);
        t.transfer(address(campaign), bought);

        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.CurveTokenMismatch.selector, address(t), address(otherCurve.token())
            )
        );
        campaign.registerExternalPool(address(t), bought, address(otherCurve));
    }

    /// @dev A curve-backed launch must EARN eligibility from on-chain state;
    /// the team cannot simply grant it.
    function test_RevertWhen_MarkEligibleOnCurveBackedLaunch() public {
        (ImmutableLaunchToken t,) = _deployWithInfoFi(300);

        vm.prank(team);
        vm.expectRevert(
            abi.encodeWithSelector(InfoFiCampaign.NotExternalPool.selector, address(t))
        );
        campaign.markEligible(address(t));
    }

    /// @dev THE reason the two paths are separated. An external pool has no
    /// curve; a price read must return "cannot tell" rather than calling
    /// `graduated()` on a non-contract and reverting the whole transaction.
    function test_ExternalPool_PriceReadsAreSafeAndPokingIsRefused() public {
        uint256 pool = 10_000e18;
        ImmutableLaunchToken t = _externalToken(pool);
        vm.prank(projectDev);
        campaign.registerExternalPool(address(t), pool, address(0));

        (uint256 mcap, bool valid) = campaign.marketCapUsd(address(t));
        assertEq(mcap, 0);
        assertFalse(valid, "external pool has no readable market cap");

        vm.expectRevert(
            abi.encodeWithSelector(
                InfoFiCampaign.ExternalPoolNotPokeable.selector, address(t)
            )
        );
        campaign.recordMarketCap(address(t));
    }

    function test_RevertWhen_ExternalPoolRegisteredWithoutFunding() public {
        ImmutableLaunchToken t =
            new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, SUPPLY, projectDev);

        vm.prank(projectDev);
        vm.expectRevert();
        campaign.registerExternalPool(address(t), 1_000e18, address(0));
    }

    function test_RevertWhen_ExternalPoolRegisteredTwice() public {
        uint256 pool = 10_000e18;
        ImmutableLaunchToken t = _externalToken(pool);
        vm.prank(projectDev);
        campaign.registerExternalPool(address(t), pool, address(0));

        vm.prank(projectDev);
        vm.expectRevert(
            abi.encodeWithSelector(InfoFiCampaign.AlreadyRegistered.selector, address(t))
        );
        campaign.registerExternalPool(address(t), pool, address(0));
    }

    /// @dev An external pool that is funded but never cleared still burns,
    /// exactly like a curve-backed one. There is no sweep for either.
    function test_ExternalPool_BurnsIfNeverOpened() public {
        uint256 pool = 10_000e18;
        ImmutableLaunchToken t = _externalToken(pool);
        vm.prank(projectDev);
        campaign.registerExternalPool(address(t), pool, address(0));

        vm.warp(block.timestamp + 365 days + 1);
        campaign.burnUnclaimed(address(t));

        assertEq(t.balanceOf(campaign.BURN_ADDRESS()), pool, "abandoned pool must burn");
        assertEq(t.balanceOf(address(campaign)), 0);
    }
}
