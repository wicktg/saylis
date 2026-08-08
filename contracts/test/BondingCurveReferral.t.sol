// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {ReferralVault} from "../src/ReferralVault.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";

/// @notice Integration tests for BondingCurve's referral fee-split cut —
/// see BondingCurve.sol's "REFERRALS" NatSpec. ReferralVault's own
/// standalone behavior (registration, accrual, withdrawal) is covered in
/// ReferralVault.t.sol; this file is specifically about the 5% carve-out
/// happening correctly, on both `buy` and `sell`, at the right size, from
/// the right pool, and never touching `protocolFeesOwed`.
contract BondingCurveReferralTest is Test {
    string internal constant NAME = "Referral Test Token";
    string internal constant SYMBOL = "RTT";
    uint8 internal constant DECIMALS = 18;
    uint256 internal constant DEFAULT_SUPPLY = 1_000_000_000e18;
    uint256 internal constant DEFAULT_VIRTUAL_ETH = 2_000e18;
    uint256 internal constant DEFAULT_VIRTUAL_TOKEN = 1_073_000_000e18;
    uint256 internal constant DEFAULT_DELAY_BLOCKS = 1;
    uint256 internal constant UNREACHABLE_GRADUATION_THRESHOLD = type(uint128).max;

    uint256 internal constant FEE_BPS = 100; // 1%
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant CREATOR_SHARE_BPS = 7_500; // flat, all volumes
    uint256 internal constant REFERRAL_BPS = 500; // 5%

    address internal protocolTreasury = makeAddr("protocolTreasury");
    address internal migrator = makeAddr("migrator");
    address internal buyer = makeAddr("buyer");

    ReferralVault internal vault;
    MockV3Aggregator internal ethUsdPriceFeed;

    function setUp() public {
        vault = new ReferralVault();
        ethUsdPriceFeed = new MockV3Aggregator(8, 3_000e8);
    }

    /// @dev Deploys a token+curve pair for `creator_`, wired to `vault`.
    /// `referralVault_` lets tests exercise the address(0) opt-out path too.
    function _deployPair(address creator_, address referralVault_)
        internal
        returns (ImmutableLaunchToken t, BondingCurve c)
    {
        address deployerAddr = address(this);
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);

        t = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, DEFAULT_SUPPLY, predictedCurve);
        c = new BondingCurve(
            IERC20(address(t)),
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator_,
            protocolTreasury,
            DEFAULT_DELAY_BLOCKS,
            UNREACHABLE_GRADUATION_THRESHOLD,
            migrator,
            0,
            address(ethUsdPriceFeed),
            address(0),
            0,
            address(0),
            referralVault_
        );
        require(address(c) == predictedCurve, "test setup: nonce prediction mismatch");
        vm.roll(block.number + c.delayBlocks() + 1);
    }

    function _feeOf(uint256 grossEthAmount) internal pure returns (uint256) {
        return (grossEthAmount * FEE_BPS) / BPS_DENOMINATOR;
    }

    /* -------------------------------------------------------------------- */
    /*                          No-referrer baseline                        */
    /* -------------------------------------------------------------------- */

    function test_NoReferrer_VaultSetButNoneRegistered_BehavesUnchanged() public {
        address creator = makeAddr("creatorNoRef");
        (, BondingCurve c) = _deployPair(creator, address(vault));
        assertEq(c.referrer(), address(0), "no registration ever happened for this creator");

        vm.deal(buyer, 10 ether);
        vm.prank(buyer);
        c.buy{value: 5 ether}(0);

        uint256 feeAmount = _feeOf(5 ether);
        uint256 expectedCreatorFee = (feeAmount * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;

        assertEq(c.creatorFeesOwed(), expectedCreatorFee, "full creator fee, no cut taken");
        assertEq(vault.referralFeesOwed(creator), 0);
        assertEq(address(vault).balance, 0, "nothing should have moved to the vault at all");
    }

    function test_NoReferralVault_OptedOut_BehavesUnchanged() public {
        address creator = makeAddr("creatorOptedOut");
        (, BondingCurve c) = _deployPair(creator, address(0));
        assertEq(c.referralVault(), address(0));
        assertEq(c.referrer(), address(0));

        vm.deal(buyer, 10 ether);
        vm.prank(buyer);
        c.buy{value: 5 ether}(0);

        uint256 feeAmount = _feeOf(5 ether);
        uint256 expectedCreatorFee = (feeAmount * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        assertEq(c.creatorFeesOwed(), expectedCreatorFee);
    }

    /* -------------------------------------------------------------------- */
    /*                        5% accuracy — buy and sell                    */
    /* -------------------------------------------------------------------- */

    function test_Buy_RoutesExactly5PercentOfCreatorFeeToReferrer() public {
        address referrer = makeAddr("referrer1");
        address creator = makeAddr("creatorReferred1");
        vm.prank(creator);
        vault.registerReferral(referrer);

        (, BondingCurve c) = _deployPair(creator, address(vault));
        assertEq(c.referrer(), referrer, "resolved once at construction from the vault");

        vm.deal(buyer, 10 ether);
        vm.prank(buyer);
        c.buy{value: 5 ether}(0);

        uint256 feeAmount = _feeOf(5 ether);
        uint256 creatorFee = (feeAmount * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 protocolFee = feeAmount - creatorFee;
        uint256 expectedReferralCut = (creatorFee * REFERRAL_BPS) / BPS_DENOMINATOR;

        assertEq(vault.referralFeesOwed(referrer), expectedReferralCut, "referrer gets exactly 5%");
        assertEq(
            c.creatorFeesOwed(),
            creatorFee - expectedReferralCut,
            "creator keeps the remaining 95% of their own fee share"
        );
        assertEq(c.protocolFeesOwed(), protocolFee, "protocol fee is untouched by the referral cut");
    }

    function test_Sell_RoutesExactly5PercentOfCreatorFeeToReferrer() public {
        address referrer = makeAddr("referrer2");
        address creator = makeAddr("creatorReferred2");
        vm.prank(creator);
        vault.registerReferral(referrer);

        (ImmutableLaunchToken t, BondingCurve c) = _deployPair(creator, address(vault));

        vm.deal(buyer, 10 ether);
        vm.startPrank(buyer);
        c.buy{value: 5 ether}(0);

        uint256 tokenBal = t.balanceOf(buyer);
        t.approve(address(c), tokenBal);

        // Reset accounting reference point: measure only what THIS sell
        // contributes, since the prior buy already credited some referral
        // cut and creator fee.
        uint256 referralBefore = vault.referralFeesOwed(referrer);
        uint256 creatorFeesBefore = c.creatorFeesOwed();
        uint256 protocolFeesBefore = c.protocolFeesOwed();

        uint256 grossEthOut = c.quoteSellGross(tokenBal);
        // Derive the expected split from the contract's own view rather
        // than restating the constant, so this stays honest if the rate
        // ever moves.
        uint256 creatorBps = c.currentCreatorFeeShareBps();
        c.sell(tokenBal, 0);
        vm.stopPrank();

        uint256 feeAmount = _feeOf(grossEthOut);
        uint256 creatorFee = (feeAmount * creatorBps) / BPS_DENOMINATOR;
        uint256 protocolFee = feeAmount - creatorFee;
        uint256 expectedReferralCut = (creatorFee * REFERRAL_BPS) / BPS_DENOMINATOR;

        assertEq(
            vault.referralFeesOwed(referrer) - referralBefore,
            expectedReferralCut,
            "sell's referral cut is exactly 5% of ITS creatorFee"
        );
        assertEq(c.creatorFeesOwed() - creatorFeesBefore, creatorFee - expectedReferralCut);
        assertEq(
            c.protocolFeesOwed() - protocolFeesBefore,
            protocolFee,
            "protocol fee from the sell is untouched"
        );
    }

    function test_SellTax_NeverSubjectToReferralCut() public {
        address referrer = makeAddr("referrer3");
        address creator = makeAddr("creatorReferred3");
        vm.prank(creator);
        vault.registerReferral(referrer);

        // Deploy directly with a non-zero sellTaxBps, bypassing _deployPair
        // (which hardcodes sellTaxBps to 0), to exercise the sell-tax path.
        address deployerAddr = address(this);
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);
        ImmutableLaunchToken t =
            new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, DEFAULT_SUPPLY, predictedCurve);
        BondingCurve c = new BondingCurve(
            IERC20(address(t)),
            DEFAULT_VIRTUAL_ETH,
            DEFAULT_VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            DEFAULT_DELAY_BLOCKS,
            UNREACHABLE_GRADUATION_THRESHOLD,
            migrator,
            300, // 3% whale sell tax, well above any live threshold at this mcap
            address(ethUsdPriceFeed),
            address(0),
            0,
            address(0),
            address(vault)
        );
        vm.roll(block.number + c.delayBlocks() + 1);

        vm.deal(buyer, 10 ether);
        vm.startPrank(buyer);
        // Large buy so `buyer` clears the whale threshold on the sell below.
        c.buy{value: 5 ether}(0);
        uint256 tokenBal = t.balanceOf(buyer);
        t.approve(address(c), tokenBal);

        uint256 referralBefore = vault.referralFeesOwed(referrer);
        uint256 grossEthOut = c.quoteSellGross(tokenBal);
        uint256 creatorBps = c.currentCreatorFeeShareBps();
        c.sell(tokenBal, 0);
        vm.stopPrank();

        uint256 feeAmount = _feeOf(grossEthOut);
        uint256 creatorFee = (feeAmount * creatorBps) / BPS_DENOMINATOR;
        uint256 expectedReferralCut = (creatorFee * REFERRAL_BPS) / BPS_DENOMINATOR;

        // If the sell tax had been included, this delta would be larger
        // than 5% of creatorFee alone.
        assertEq(
            vault.referralFeesOwed(referrer) - referralBefore,
            expectedReferralCut,
            "referral cut ignores the whale sell tax entirely"
        );
    }

    /* -------------------------------------------------------------------- */
    /*                    Multi-token lifetime accrual                      */
    /* -------------------------------------------------------------------- */

    function test_MultiCurve_SameReferrer_AccruesAcrossBothTokens() public {
        address referrer = makeAddr("sharedReferrer");
        address creatorA = makeAddr("creatorA");
        address creatorB = makeAddr("creatorB");
        vm.prank(creatorA);
        vault.registerReferral(referrer);
        vm.prank(creatorB);
        vault.registerReferral(referrer);

        (, BondingCurve curveA) = _deployPair(creatorA, address(vault));
        (, BondingCurve curveB) = _deployPair(creatorB, address(vault));

        vm.deal(buyer, 20 ether);
        vm.startPrank(buyer);
        curveA.buy{value: 5 ether}(0);
        curveB.buy{value: 3 ether}(0);
        vm.stopPrank();

        uint256 feeA = _feeOf(5 ether);
        uint256 creatorFeeA = (feeA * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 cutA = (creatorFeeA * REFERRAL_BPS) / BPS_DENOMINATOR;

        uint256 feeB = _feeOf(3 ether);
        uint256 creatorFeeB = (feeB * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 cutB = (creatorFeeB * REFERRAL_BPS) / BPS_DENOMINATOR;

        assertEq(
            vault.referralFeesOwed(referrer),
            cutA + cutB,
            "one unified balance, summed across two entirely different creators' curves"
        );

        uint256 before = referrer.balance;
        vm.prank(referrer);
        uint256 withdrawn = vault.withdrawReferralFees();
        assertEq(withdrawn, cutA + cutB, "a single withdrawal claims the full lifetime total");
        assertEq(referrer.balance, before + cutA + cutB);
    }

    /* -------------------------------------------------------------------- */
    /*                        Immutability of resolution                    */
    /* -------------------------------------------------------------------- */

    function test_ReferrerResolvedOnceAtConstruction_LaterRegistrationIgnored() public {
        address creator = makeAddr("creatorLateReg");
        // No referrer registered yet at deploy time.
        (, BondingCurve c) = _deployPair(creator, address(vault));
        assertEq(c.referrer(), address(0));

        // Register AFTER the curve already exists — the curve must never
        // pick this up; `referrer` was cached once, permanently.
        address referrer = makeAddr("tooLateReferrer");
        vm.prank(creator);
        vault.registerReferral(referrer);

        vm.deal(buyer, 5 ether);
        vm.prank(buyer);
        c.buy{value: 5 ether}(0);

        assertEq(vault.referralFeesOwed(referrer), 0, "late registration has zero effect on this curve");
        uint256 feeAmount = _feeOf(5 ether);
        uint256 expectedCreatorFee = (feeAmount * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        assertEq(c.creatorFeesOwed(), expectedCreatorFee, "creator keeps the full fee share");
    }
}
