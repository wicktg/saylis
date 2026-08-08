// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TokenFeeCollector} from "../src/TokenFeeCollector.sol";
import {TaxableLaunchToken} from "../src/TaxableLaunchToken.sol";
import {ReferralVault} from "../src/ReferralVault.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";
import {MockUniswapV3Pool} from "./mocks/MockUniswapV3Pool.sol";
import {MockPositionManager} from "./mocks/MockPositionManager.sol";
import {MockSwapRouter02} from "./mocks/MockSwapRouter02.sol";
import {MockWETH9} from "./mocks/MockWETH9.sol";

contract TokenFeeCollectorTest is Test {
    uint256 constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 constant SELL_TAX_BPS = 300;
    uint24 constant POOL_FEE = 10_000;
    int256 constant ETH_USD = 3_000e8;

    uint256 constant CREATOR_BPS = 7_500;
    uint256 constant REFERRAL_BPS = 500;
    uint256 constant BPS = 10_000;

    address curve = makeAddr("curve");
    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");
    address migrator = makeAddr("migrator");
    address whale = makeAddr("whale");
    address stranger = makeAddr("stranger");

    TaxableLaunchToken token;
    TokenFeeCollector collector;
    MockV3Aggregator feed;
    MockUniswapV3Pool pool;
    MockSwapRouter02 router;
    MockPositionManager pm;
    MockWETH9 weth;
    uint256 tokenId;

    function setUp() public {
        feed = new MockV3Aggregator(8, ETH_USD);
        weth = new MockWETH9();
        router = new MockSwapRouter02(weth);
        pm = new MockPositionManager();

        token = new TaxableLaunchToken(
            "Loxley Test", "LOX", 18, TOTAL_SUPPLY, curve, SELL_TAX_BPS, address(feed), migrator
        );
        pool = new MockUniswapV3Pool(address(token), address(weth), 0);

        collector = _deployCollector(address(0));

        vm.prank(migrator);
        token.setAmmPair(address(pool), address(collector));

        // The mocks pay fees out of their own balances; fund them. The
        // token has no mint — its whole supply went to the curve at
        // construction — so the position manager is stocked from there.
        vm.prank(curve);
        token.transfer(address(pm), TOTAL_SUPPLY / 4);
        weth.mintTo(address(pm), 1e30);
        vm.deal(address(weth), 1e30);

        _setMcapUsd(2_000_000); // strictest tier — everyone above 0.5% is a whale
        _alignPoolWithRouter();
    }

    /// @dev Mints a fresh position and binds a collector to it, optionally
    /// wired to a referral vault.
    function _deployCollector(address referralVault) internal returns (TokenFeeCollector c) {
        (address t0, address t1) = address(token) < address(weth)
            ? (address(token), address(weth))
            : (address(weth), address(token));
        tokenId = pm.mintTo(address(this), t0, t1);

        c = new TokenFeeCollector(
            address(token),
            creator,
            treasury,
            address(router),
            address(weth),
            POOL_FEE,
            address(pm),
            tokenId,
            address(pool),
            referralVault
        );
        pm.safeTransferFrom(address(this), address(c), tokenId);
    }

    function _setMcapUsd(uint256 targetUsd) internal {
        uint256 supplyWhole = TOTAL_SUPPLY / 1e18;
        uint256 priceWei = (targetUsd * 1e18 * 1e8) / (supplyWhole * uint256(ETH_USD));
        pool.setPriceWeiAsToken0(priceWei);
    }

    /// @dev Points the pool's spot price at exactly the rate the mock router
    /// will pay, so a swap's real output lands just above the collector's
    /// on-chain minimum instead of tripping it.
    function _alignPoolWithRouter() internal {
        uint256 rate = router.rateWeiPerToken();
        // `setPriceWeiAsToken0` sets the raw token1/token0 ratio to
        // priceWei/1e18. We want WETH-per-token to equal `rate`.
        pool.setPriceWeiAsToken0(address(token) < address(weth) ? rate : (1e36 / rate));
        pool.setSpotTick(0);
        pool.setTwapTick(0);
    }

    /// @dev Credits fees to the position on the correct sides for the
    /// current token/WETH ordering.
    function _setFees(uint256 tokenAmount, uint256 wethAmount) internal {
        (uint256 a0, uint256 a1) = address(token) < address(weth)
            ? (tokenAmount, wethAmount)
            : (wethAmount, tokenAmount);
        pm.setOwed(tokenId, a0, a1);
    }

    /// @dev Routes a whale sell through the token so tax accrues exactly the
    /// way it will in production.
    function _accrueSellTax(uint256 sellAmount) internal returns (uint256 tax) {
        vm.prank(curve);
        token.transfer(whale, TOTAL_SUPPLY / 10);

        uint256 before = token.balanceOf(address(collector));
        vm.prank(whale);
        token.transfer(address(pool), sellAmount);
        tax = token.balanceOf(address(collector)) - before;
        assertGt(tax, 0, "expected tax to accrue");
    }

    /* -------------------------------------------------------------------- */
    /*                            The lock itself                           */
    /* -------------------------------------------------------------------- */

    function test_CollectorHoldsThePosition() public view {
        assertEq(pm.ownerOf(tokenId), address(collector));
        assertEq(collector.tokenId(), tokenId);
    }

    /// @dev The whole safety claim in one assertion: nothing on this
    /// contract can move the NFT or pull liquidity. If such a function were
    /// ever added, one of these selectors would start resolving.
    function test_NoWithdrawalSurfaceExists() public view {
        string[5] memory forbidden = [
            "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
            "transferPosition(address)",
            "withdrawPosition(address)",
            "setOwner(address)",
            "rescue(address,uint256)"
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(collector).staticcall(abi.encodeWithSignature(forbidden[i]));
            assertFalse(ok, forbidden[i]);
        }
    }

    function test_RevertWhen_ForeignPositionIsSentHere() public {
        uint256 other = pm.mintTo(address(this), address(token), address(weth));
        vm.expectRevert(TokenFeeCollector.UnexpectedPosition.selector);
        pm.safeTransferFrom(address(this), address(collector), other);
    }

    /* -------------------------------------------------------------------- */
    /*                      LP fees — the two-asset split                   */
    /* -------------------------------------------------------------------- */

    /// @dev The case burning the position could never reach. The creator
    /// takes 75% of each side; their token share is paid IN KIND rather
    /// than sold, so collecting fees never sells into the token's own pool.
    function test_Collect_SplitsBothSides_CreatorPaidInKind() public {
        uint256 lpTokens = 100_000e18;
        uint256 lpWeth = 4 ether;
        _setFees(lpTokens, lpWeth);

        uint256 expectedCreatorTokens = (lpTokens * CREATOR_BPS) / BPS;
        uint256 protocolTokens = lpTokens - expectedCreatorTokens;
        uint256 swapped = (protocolTokens * router.rateWeiPerToken()) / 1e18;

        vm.prank(stranger); // permissionless
        collector.collect();

        assertEq(collector.creatorTokensOwed(), expectedCreatorTokens, "creator tokens, unsold");
        assertEq(collector.protocolTokensPending(), 0, "protocol slice must have been sold");
        assertEq(collector.creatorFeesOwed(), (lpWeth * CREATOR_BPS) / BPS, "creator eth");
        assertEq(
            collector.protocolFeesOwed(),
            lpWeth - (lpWeth * CREATOR_BPS) / BPS + swapped,
            "protocol eth = its weth share + proceeds of its token slice"
        );
    }

    /// @dev Only the protocol's quarter is ever sold — the creator's 75%
    /// stays as tokens, which is the entire point of the design.
    function test_Collect_SellsOnlyTheProtocolSlice() public {
        uint256 lpTokens = 100_000e18;
        _setFees(lpTokens, 0);

        uint256 routerBefore = token.balanceOf(address(router));
        collector.collect();
        uint256 sold = token.balanceOf(address(router)) - routerBefore;

        assertEq(sold, lpTokens - (lpTokens * CREATOR_BPS) / BPS, "only 25% may be sold");
        assertEq(sold * 4, lpTokens, "sanity: that is exactly a quarter");
    }

    function test_Collect_WethSideOnly() public {
        _setFees(0, 4 ether);
        collector.collect();
        assertEq(collector.creatorFeesOwed(), 3 ether);
        assertEq(collector.protocolFeesOwed(), 1 ether);
        assertEq(collector.creatorTokensOwed(), 0);
    }

    function test_RevertWhen_NothingToCollect() public {
        vm.expectRevert(TokenFeeCollector.NothingCollected.selector);
        collector.collect();
    }

    /* -------------------------------------------------------------------- */
    /*                     Whale sell tax — 100% creator                    */
    /* -------------------------------------------------------------------- */

    /// @dev Post-graduation the tax arrives in tokens and goes entirely to
    /// the creator, exactly as `BondingCurve` treats it pre-graduation. The
    /// protocol takes no cut of it on either side of graduation.
    function test_Collect_SellTaxGoesEntirelyToCreator() public {
        uint256 tax = _accrueSellTax(1_000_000e18);

        collector.collect();

        assertEq(collector.creatorTokensOwed(), tax, "creator takes all of it");
        assertEq(collector.protocolTokensPending(), 0, "protocol takes none of it");
        assertEq(collector.protocolFeesOwed(), 0, "and nothing was sold on its behalf");
    }

    /// @dev Tax and LP fees share one token balance, so the split must not
    /// leak across them: 100% of the tax and 75% of the LP side.
    function test_Collect_SellTaxAndLpFeesAccountedSeparately() public {
        uint256 tax = _accrueSellTax(1_000_000e18);
        uint256 lpTokens = 40_000e18;
        _setFees(lpTokens, 0);

        collector.collect();

        uint256 lpCreatorShare = (lpTokens * CREATOR_BPS) / BPS;
        assertEq(collector.creatorTokensOwed(), tax + lpCreatorShare);
        assertEq(collector.protocolTokensPending(), 0);
    }

    /* -------------------------------------------------------------------- */
    /*                    The on-chain slippage bound                       */
    /* -------------------------------------------------------------------- */

    /// @dev `collect` is permissionless precisely because the bound is not
    /// a caller argument. When the pool's own oracle cannot answer, the
    /// protocol's slice is carried rather than sold blind.
    function test_Collect_SkipsSwapWhenOracleUnavailable() public {
        pool.setObserveReverts(true);
        uint256 lpTokens = 100_000e18;
        _setFees(lpTokens, 0);

        collector.collect();

        uint256 protocolTokens = lpTokens - (lpTokens * CREATOR_BPS) / BPS;
        assertEq(collector.protocolTokensPending(), protocolTokens, "carried, not sold");
        assertEq(collector.protocolFeesOwed(), 0);
        // The creator is unaffected — a bad moment for the protocol's slice
        // must never hold the creator's share hostage.
        assertEq(collector.creatorTokensOwed(), (lpTokens * CREATOR_BPS) / BPS);
    }

    /// @dev Spot far from the TWAP is the signature of a pool being pushed
    /// around, which is exactly when selling into it is worst.
    function test_Collect_SkipsSwapWhenSpotDivergesFromTwap() public {
        pool.setSpotTick(5_000); // well past the 2000-tick tolerance
        pool.setTwapTick(0);
        _setFees(100_000e18, 0);

        collector.collect();

        assertGt(collector.protocolTokensPending(), 0, "must refuse to trade");
        assertEq(collector.protocolFeesOwed(), 0);
    }

    function test_GuardedMinimumOut_IsZeroWhenDeviationExceedsTolerance() public {
        assertGt(collector._guardedMinimumOut(1e18), 0, "baseline should quote");
        pool.setSpotTick(collector.MAX_TICK_DEVIATION() + 1);
        assertEq(collector._guardedMinimumOut(1e18), 0);
    }

    function test_GuardedMinimumOut_SitsBelowSpotByTheSlippageAllowance() public view {
        uint256 amountIn = 1_000e18;
        uint256 spotOut = (amountIn * router.rateWeiPerToken()) / 1e18;
        uint256 minOut = collector._guardedMinimumOut(amountIn);

        assertLt(minOut, spotOut, "must leave room for the sale's own impact");
        assertApproxEqRel(
            minOut,
            (spotOut * (BPS - collector.SWAP_SLIPPAGE_BPS())) / BPS,
            0.01e18,
            "and exactly that much room"
        );
    }

    /// @dev A carried slice is not lost — the next call sells it once the
    /// pool is answerable again.
    function test_Collect_CarriedSliceIsSoldOnceConditionsRecover() public {
        pool.setObserveReverts(true);
        _setFees(100_000e18, 0);
        collector.collect();
        uint256 carried = collector.protocolTokensPending();
        assertGt(carried, 0);

        pool.setObserveReverts(false);
        _setFees(0, 1 ether); // something to make the second collect non-empty
        collector.collect();

        assertEq(collector.protocolTokensPending(), 0, "carried slice cleared");
        uint256 expectedSwap = (carried * router.rateWeiPerToken()) / 1e18;
        assertEq(collector.protocolFeesOwed(), 0.25 ether + expectedSwap);
    }

    /// @dev A failing router must not strand an allowance or lose the
    /// tokens; they go back on the books for next time.
    function test_Collect_SwapFailureCarriesSliceAndLeavesNoAllowance() public {
        router.setShouldUnderfill(true);
        uint256 lpTokens = 100_000e18;
        _setFees(lpTokens, 0);

        collector.collect();

        assertEq(
            collector.protocolTokensPending(),
            lpTokens - (lpTokens * CREATOR_BPS) / BPS,
            "slice returned to the books"
        );
        assertEq(token.allowance(address(collector), address(router)), 0);
    }

    function test_Collect_LeavesNoRouterAllowanceOnSuccess() public {
        _setFees(100_000e18, 0);
        collector.collect();
        assertEq(token.allowance(address(collector), address(router)), 0);
    }

    /* -------------------------------------------------------------------- */
    /*                              Referrals                               */
    /* -------------------------------------------------------------------- */

    /// @dev The 5% override survives graduation, carved out of the
    /// creator's ETH share and never the protocol's.
    function test_Collect_ReferralCutTakenFromCreatorEthOnly() public {
        ReferralVault vault = new ReferralVault();
        address referrer = makeAddr("referrer");
        vm.prank(creator);
        vault.registerReferral(referrer);

        TokenFeeCollector c = _deployCollector(address(vault));
        assertEq(c.referrer(), referrer, "referrer resolved at construction");

        uint256 lpWeth = 4 ether;
        _setFees(0, lpWeth);
        c.collect();

        uint256 creatorFee = (lpWeth * CREATOR_BPS) / BPS;
        uint256 cut = (creatorFee * REFERRAL_BPS) / BPS;

        assertEq(vault.referralFeesOwed(referrer), cut, "referrer paid");
        assertEq(c.creatorFeesOwed(), creatorFee - cut, "out of the creator's share");
        assertEq(c.protocolFeesOwed(), lpWeth - creatorFee, "protocol untouched");
    }

    /// @dev Tokens cannot reach the vault, so a referred creator keeps
    /// their whole token share — documented behaviour, asserted here so it
    /// cannot drift silently.
    function test_Collect_ReferralNeverTouchesTheTokenSide() public {
        ReferralVault vault = new ReferralVault();
        address referrer = makeAddr("referrer");
        vm.prank(creator);
        vault.registerReferral(referrer);

        TokenFeeCollector c = _deployCollector(address(vault));
        vm.prank(migrator);

        uint256 lpTokens = 100_000e18;
        _setFees(lpTokens, 0);
        c.collect();

        assertEq(c.creatorTokensOwed(), (lpTokens * CREATOR_BPS) / BPS, "no token-side cut");
    }

    function test_Collect_NoReferrerMeansNoCut() public {
        _setFees(0, 4 ether);
        collector.collect();
        assertEq(collector.creatorFeesOwed(), 3 ether, "full 75%");
    }

    /* -------------------------------------------------------------------- */
    /*                             Withdrawals                              */
    /* -------------------------------------------------------------------- */

    function test_WithdrawCreatorTokens_SendsTokensToCreator() public {
        uint256 tax = _accrueSellTax(1_000_000e18);
        collector.collect();

        vm.prank(stranger); // permissionless, fixed destination
        collector.withdrawCreatorTokens();

        assertEq(token.balanceOf(creator), tax);
        assertEq(collector.creatorTokensOwed(), 0);
    }

    function test_WithdrawCreatorFees_SendsEthToCreator() public {
        _setFees(0, 4 ether);
        collector.collect();

        vm.prank(stranger);
        collector.withdrawCreatorFees();

        assertEq(creator.balance, 3 ether);
        assertEq(collector.creatorFeesOwed(), 0);
    }

    function test_WithdrawProtocolFees_SendsEthToTreasury() public {
        _setFees(0, 4 ether);
        collector.collect();

        collector.withdrawProtocolFees();

        assertEq(treasury.balance, 1 ether);
        assertEq(collector.protocolFeesOwed(), 0);
    }

    /// @dev There is deliberately no protocol token withdrawal — the
    /// treasury cannot hold ERC-20s, so sending it any would strand them.
    function test_NoProtocolTokenWithdrawalExists() public {
        (bool ok,) = address(collector).call(
            abi.encodeWithSignature("withdrawProtocolTokens()")
        );
        assertFalse(ok);
    }

    function test_RevertWhen_WithdrawingNothing() public {
        vm.expectRevert(TokenFeeCollector.NothingOwed.selector);
        collector.withdrawCreatorFees();
        vm.expectRevert(TokenFeeCollector.NothingOwed.selector);
        collector.withdrawProtocolFees();
        vm.expectRevert(TokenFeeCollector.NothingOwed.selector);
        collector.withdrawCreatorTokens();
    }

    /* -------------------------------------------------------------------- */
    /*                                Fuzz                                  */
    /* -------------------------------------------------------------------- */

    /// @dev However the two sides fall, the ETH split is exhaustive and the
    /// creator's token share is never sold out from under them.
    function testFuzz_SplitsAreExhaustive(uint256 lpTokens, uint256 lpWeth) public {
        lpTokens = bound(lpTokens, 0, 1e24);
        lpWeth = bound(lpWeth, 0, 1e21);
        vm.assume(lpTokens > 0 || lpWeth > 0);

        _setFees(lpTokens, lpWeth);
        collector.collect();

        uint256 creatorTokens = (lpTokens * CREATOR_BPS) / BPS;
        assertEq(collector.creatorTokensOwed(), creatorTokens);

        // The WETH side always splits exactly; the swapped slice lands on
        // top of the protocol's own share, so its total is never smaller.
        uint256 creatorEth = (lpWeth * CREATOR_BPS) / BPS;
        assertEq(collector.creatorFeesOwed(), creatorEth);
        assertGe(collector.protocolFeesOwed(), lpWeth - creatorEth);
    }
}
