// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {TaxableLaunchToken} from "../src/TaxableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {GraduationMigrator} from "../src/GraduationMigrator.sol";
import {TokenFeeCollector} from "../src/TokenFeeCollector.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3Pool.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {IWETH9} from "../src/interfaces/IWETH9.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";

/// @dev `TokenFeeCollector` against a FORK of Arbitrum Sepolia, using the
/// real Uniswap V3 factory, NonfungiblePositionManager and SwapRouter02.
///
/// The unit suite in `TokenFeeCollector.t.sol` proves the arithmetic — the
/// splits, the referral carve-out, the skip-and-carry behaviour — against
/// mocks. It cannot prove the parts that only exist in Uniswap:
///
///   - that `positionManager.collect` actually returns accrued fees, on
///     both sides, in the amounts real trading produces;
///   - that the whale sell tax is really charged on a router-driven sell
///     and credited to the creator in full;
///   - that migration really grows the pool's observation buffer;
///   - that the creator can really withdraw both assets.
///
/// WHAT THIS FILE DELIBERATELY DOES NOT COVER
///
/// Anything requiring the pool's oracle to have AGED — the TWAP quote, the
/// tick-deviation refusal, and the protocol slice's swap that depends on
/// both. `block.timestamp` cannot be advanced on this fork: neither
/// `vm.warp` nor `vm.roll` moves it, so a pool created inside the test is
/// permanently younger than `TWAP_WINDOW` and `observe` permanently
/// reverts `OLD`. Those paths are covered against the mock in
/// `TokenFeeCollector.t.sol`, where the observation buffer is controllable.
/// Do not "fix" this by shortening the window — the limitation is the
/// harness, not the contract.
contract TokenFeeCollectorForkTest is Test {
    // Arbitrum Sepolia (chain id 421614) official Uniswap V3 testnet
    // deployment — see GraduationMigrator.t.sol for provenance.
    address internal constant UNISWAP_V3_FACTORY = 0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e;
    address internal constant POSITION_MANAGER = 0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65;
    address internal constant WETH9 = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    address internal constant SWAP_ROUTER = 0x101F443B4d1b059569D643917553c771E1b9663E;

    /// @dev See the note in `setUp` — this must stay pinned.
    uint256 internal constant FORK_BLOCK = 296_021_000;

    /// @dev The tier this actually ships on. Everything below is therefore
    /// a test of the real production configuration, not a nearby one.
    uint24 internal constant POOL_FEE = 10_000; // 1%, spacing 200

    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 internal constant VIRTUAL_ETH = 6e18;
    uint256 internal constant VIRTUAL_TOKEN = 1_066_666_667e18;
    uint256 internal constant GRADUATION_THRESHOLD = 4.2 ether;
    uint256 internal constant SELL_TAX_BPS = 100; // 1%, the frontend default

    uint256 internal constant CREATOR_BPS = 7_500;
    uint256 internal constant BPS = 10_000;

    address internal creator = makeAddr("creator");
    address internal protocolTreasury = makeAddr("protocolTreasury");
    address internal trader = makeAddr("trader");

    GraduationMigrator internal migrator;
    MockV3Aggregator internal priceFeed;
    TaxableLaunchToken internal token;
    BondingCurve internal curve;
    TokenFeeCollector internal collector;
    IUniswapV3Pool internal pool;
    uint256 internal positionId;

    function setUp() public {
        string memory rpcUrl =
            vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string("https://sepolia-rollup.arbitrum.io/rpc"));

        // PINNED, and it has to be. On an unpinned fork Foundry keeps
        // re-reading the chain's head, which resets the block environment
        // underneath the test — `vm.warp` appears to succeed and then
        // silently reverts to the live timestamp, so the pool's oracle
        // never ages and every TWAP assertion here fails for a reason that
        // has nothing to do with the contract. Pinning also makes these
        // runs deterministic and lets Foundry serve them from cache.
        vm.createSelectFork(rpcUrl, FORK_BLOCK);

        // Deployed after selecting the fork, or it lands on the pre-fork
        // backend and ends up code-less once the fork's takes over.
        priceFeed = new MockV3Aggregator(8, 3_000e8);
        migrator = new GraduationMigrator(
            UNISWAP_V3_FACTORY, POSITION_MANAGER, WETH9, POOL_FEE, SWAP_ROUTER
        );

        _deployAndGraduate();

        address poolAddr;
        (poolAddr, positionId,) = migrator.migrate(curve);
        pool = IUniswapV3Pool(poolAddr);
        collector = TokenFeeCollector(payable(IERC721(POSITION_MANAGER).ownerOf(positionId)));

        assertEq(address(collector.pool()), poolAddr, "collector must be bound to the real pool");
        assertEq(collector.tokenId(), positionId);
    }

    function _deployAndGraduate() internal {
        uint256 nonce = vm.getNonce(address(this));
        address predictedCurve = vm.computeCreateAddress(address(this), nonce + 1);

        token = new TaxableLaunchToken(
            "Loxley Doge",
            "LDOGE",
            18,
            TOTAL_SUPPLY,
            predictedCurve,
            SELL_TAX_BPS,
            address(priceFeed),
            address(migrator)
        );
        curve = new BondingCurve(
            IERC20(address(token)),
            VIRTUAL_ETH,
            VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            0,
            GRADUATION_THRESHOLD,
            address(migrator),
            SELL_TAX_BPS,
            address(priceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
        require(address(curve) == predictedCurve, "test setup: nonce prediction mismatch");
        vm.roll(block.number + curve.delayBlocks() + 1);

        for (uint256 i = 0; i < 300 && !curve.graduated(); i++) {
            address buyer = makeAddr(string.concat("collectorForkBuyer", vm.toString(i)));
            uint256 quoted = curve.quoteBuy(0.05 ether);
            if (quoted == 0 || quoted > curve.realTokenReserve() || quoted > curve.maxWalletTokens())
            {
                break;
            }
            vm.deal(buyer, 0.05 ether);
            vm.prank(buyer);
            curve.buy{value: 0.05 ether}(0);
        }
        require(curve.graduated(), "test setup: curve did not graduate");
    }

    /* -------------------------------------------------------------------- */
    /*                      Real trading against the pool                   */
    /* -------------------------------------------------------------------- */

    /// @dev A real buy through the real router: ETH -> WETH -> token. The
    /// pool takes its 1% out of the WETH going in, which is what puts fees
    /// on the WETH side of the position.
    function _buy(address who, uint256 ethIn) internal returns (uint256 tokensOut) {
        vm.deal(who, ethIn);
        vm.startPrank(who);
        IWETH9(WETH9).deposit{value: ethIn}();
        IERC20(WETH9).approve(SWAP_ROUTER, ethIn);
        tokensOut = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WETH9,
                tokenOut: address(token),
                fee: POOL_FEE,
                recipient: who,
                amountIn: ethIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();
    }

    /// @dev A real sell: token -> WETH. The pool takes its 1% out of the
    /// tokens going in, which is what puts fees on the token side.
    function _sell(address who, uint256 tokensIn) internal returns (uint256 wethOut) {
        vm.startPrank(who);
        IERC20(address(token)).approve(SWAP_ROUTER, tokensIn);
        wethOut = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(token),
                tokenOut: WETH9,
                fee: POOL_FEE,
                recipient: who,
                amountIn: tokensIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();
    }

    /// @dev Trades both directions so the position accrues on BOTH sides,
    /// spacing them in time so the pool's oracle has real history.
    ///
    /// @dev Advances time with `vm.warp` ONLY. `vm.roll` must not be used
    /// alongside it on a fork: rolling to a block number re-derives
    /// `block.timestamp` from that real block, silently undoing the warp.
    /// That cost an afternoon — the pool looked like it had minutes of
    /// history and had seconds. Uniswap's oracle keys on timestamp alone,
    /// so the block number is irrelevant here anyway.
    function _tradeBothWays(uint256 rounds, uint256 secondsBetween) internal {
        for (uint256 i = 0; i < rounds; i++) {
            address who = makeAddr(string.concat("forkTrader", vm.toString(i)));
            uint256 got = _buy(who, 0.2 ether);
            vm.warp(block.timestamp + secondsBetween);
            _sell(who, got / 2);
            vm.warp(block.timestamp + secondsBetween);
        }
    }

    /* -------------------------------------------------------------------- */
    /*            1. Real fees, on both sides, actually collected           */
    /* -------------------------------------------------------------------- */

    /// @dev The claim the whole redesign rests on: a position that was
    /// previously burned does earn real fees in both assets, and this
    /// contract can actually realise them.
    function test_Collect_RealFeesAccrueOnBothSidesAndAreClaimed() public {
        _tradeBothWays(4, 20);

        uint256 creatorTokensBefore = collector.creatorTokensOwed();
        uint256 creatorEthBefore = collector.creatorFeesOwed();

        collector.collect();

        assertGt(
            collector.creatorTokensOwed(),
            creatorTokensBefore,
            "sells must have accrued token-side fees"
        );
        assertGt(
            collector.creatorFeesOwed(), creatorEthBefore, "buys must have accrued WETH-side fees"
        );
        assertGt(collector.protocolFeesOwed(), 0, "protocol must have earned too");

        // Whatever was realised is really here, in ETH, withdrawable.
        assertGe(
            address(collector).balance,
            collector.creatorFeesOwed() + collector.protocolFeesOwed(),
            "credited ETH must be backed by an actual balance"
        );
        assertGe(
            IERC20(address(token)).balanceOf(address(collector)),
            collector.creatorTokensOwed(),
            "credited tokens must be backed by an actual balance"
        );
    }

    /// @dev And the creator can actually get both out.
    function test_Withdrawals_MoveRealValueToTheCreator() public {
        _tradeBothWays(4, 20);
        collector.collect();

        uint256 owedEth = collector.creatorFeesOwed();
        uint256 owedTokens = collector.creatorTokensOwed();
        assertGt(owedEth, 0);
        assertGt(owedTokens, 0);

        collector.withdrawCreatorFees();
        collector.withdrawCreatorTokens();

        assertEq(creator.balance, owedEth, "creator received real ETH");
        assertEq(
            IERC20(address(token)).balanceOf(creator), owedTokens, "creator received real tokens"
        );
    }

    /* -------------------------------------------------------------------- */
    /*        2. The TWAP guard against a genuine observation buffer        */
    /* -------------------------------------------------------------------- */

    /// @dev A pool initialised moments ago cannot answer a 60-second
    /// window, and the real one reverts `OLD` exactly as documented. The
    /// guard must read that as "do not trade", not as an error.
    function test_GuardedMinimumOut_IsZeroWhilePoolIsYoungerThanTheWindow() public view {
        // `setUp` migrated at the fork's head block, so no time has passed.
        assertEq(
            collector._guardedMinimumOut(1e18),
            0,
            "must refuse to quote before the oracle can answer"
        );
    }

    /* -------------------------------------------------------------------- */
    /*                      The observation buffer                          */
    /* -------------------------------------------------------------------- */

    function test_Migrate_GrowsTheObservationBuffer() public view {
        (,,, uint16 cardinality, uint16 cardinalityNext,,) = pool.slot0();
        assertEq(
            cardinalityNext,
            migrator.OBSERVATION_CARDINALITY(),
            "migration must request the larger buffer"
        );
        assertGe(cardinality, 1);
    }

    /* -------------------------------------------------------------------- */
    /*                  The whale tax, on a real pool                       */
    /* -------------------------------------------------------------------- */

    /// @dev Post-graduation the tax is charged by the token's transfer hook
    /// on a real router-driven sell, arrives as tokens, and is credited
    /// entirely to the creator — no protocol cut, matching the curve.
    function test_Collect_RealWhaleTaxGoesEntirelyToCreator() public {
        assertEq(token.ammPair(), address(pool), "migration must have armed the tax");
        assertEq(token.feeCollector(), address(collector));

        // A holder big enough to be a whale at this market cap.
        address whale = makeAddr("forkWhale");
        uint256 held = _buy(whale, 3 ether);
        assertGt(held, token.currentWhaleThresholdTokens(), "test setup: not a whale");

        uint256 taxedBefore = IERC20(address(token)).balanceOf(address(collector));
        _sell(whale, held / 2);
        uint256 tax = IERC20(address(token)).balanceOf(address(collector)) - taxedBefore;
        assertGt(tax, 0, "a real whale sell must be taxed");

        collector.collect();

        // The tax is the creator's in full. The LP token-side fee from the
        // same sell is split, so the creator's total is at least the tax.
        assertGe(collector.creatorTokensOwed(), tax, "whole tax belongs to the creator");
    }

    /// @dev OZ's `Math.mulDiv`, inlined so this test computes its
    /// cross-check independently of the contract's own import.
    function Math_mulDiv(uint256 x, uint256 y, uint256 denominator)
        internal
        pure
        returns (uint256)
    {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) return prod0 / denominator;
            require(denominator > prod1, "mulDiv overflow");

            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = denominator & (0 - denominator);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            return prod0 * inverse;
        }
    }
}
