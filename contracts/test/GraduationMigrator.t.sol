// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {GraduationMigrator} from "../src/GraduationMigrator.sol";
import {INonfungiblePositionManager} from "../src/interfaces/INonfungiblePositionManager.sol";
import {MockV3Aggregator} from "./mocks/MockV3Aggregator.sol";

/// @dev Full Foundry suite for `GraduationMigrator`, run against a FORK of
/// Arbitrum Sepolia — the same chain the rest of this repo's contracts
/// actually target — so `migrate` exercises Uniswap's REAL, officially
/// deployed testnet Uniswap V3 factory + NonfungiblePositionManager, not a
/// mock. These testnet addresses are NOT the same as Uniswap's
/// cross-chain-canonical mainnet addresses (verified against
/// developers.uniswap.org's Arbitrum deployments page) — the migrator
/// contract itself is chain-agnostic; only the constructor addresses
/// change per deployment/chain.
contract GraduationMigratorTest is Test {
    // Arbitrum Sepolia (chain id 421614) official Uniswap V3 testnet
    // deployment addresses — per developers.uniswap.org/contracts/v3/reference/deployments/arbitrum-deployments.
    // VERIFY against that page before relying on these for a real
    // deployment; see DeployGraduationMigrator.s.sol's own warning.
    address internal constant UNISWAP_V3_FACTORY = 0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e;
    address internal constant POSITION_MANAGER = 0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65;
    address internal constant WETH9 = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    /// SwapRouter02 on Arbitrum Sepolia — handed to each TokenFeeCollector
    /// so it can convert collected sell tax into ETH.
    address internal constant SWAP_ROUTER = 0x101F443B4d1b059569D643917553c771E1b9663E;
    uint24 internal constant POOL_FEE = 3000; // 0.3%, spacing 60
    address internal constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    string internal constant NAME = "Loxley Doge";
    string internal constant SYMBOL = "LDOGE";
    uint8 internal constant DECIMALS = 18;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;

    // Same production defaults verified elsewhere (BondingCurve.t.sol) to
    // reach graduation with real headroom, not exhaust the sellable pool.
    uint256 internal constant VIRTUAL_ETH = 6e18;
    uint256 internal constant VIRTUAL_TOKEN = 1_066_666_667e18;
    uint256 internal constant ETH_USD_PRICE = 3_000e18;
    uint256 internal constant GRADUATION_THRESHOLD = 4.2 ether;

    address internal creator = makeAddr("creator");
    address internal protocolTreasury = makeAddr("protocolTreasury");

    GraduationMigrator internal migrator;
    // sellTaxBps is 0 throughout this suite (migration mechanics are
    // orthogonal to the whale tax), so this feed is never actually read —
    // still required non-zero by the constructor regardless of tax rate.
    MockV3Aggregator internal priceFeed;

    function setUp() public {
        string memory rpcUrl =
            vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string("https://sepolia-rollup.arbitrum.io/rpc"));
        vm.createSelectFork(rpcUrl);

        // Deployed AFTER selecting the fork — a state-variable initializer
        // would deploy this to the default pre-fork backend instead,
        // leaving it with no code once the fork's own backend takes over.
        priceFeed = new MockV3Aggregator(8, 3_000e8);

        migrator =
            new GraduationMigrator(UNISWAP_V3_FACTORY, POSITION_MANAGER, WETH9, POOL_FEE, SWAP_ROUTER);
    }

    /// @dev Deploys a fresh token+curve pair pointed at `migrator` and
    /// pushes it to graduation via many independent 0.05 ETH buyers —
    /// mirrors BondingCurveTest's own production-defaults graduation test.
    function _deployGraduatedCurve(uint256 perBuyEth)
        internal
        returns (ImmutableLaunchToken token, BondingCurve curve)
    {
        address deployerAddr = address(this);
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);

        token = new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, TOTAL_SUPPLY, predictedCurve);
        curve = new BondingCurve(
            IERC20(address(token)),
            VIRTUAL_ETH,
            VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            ETH_USD_PRICE,
            0,
            GRADUATION_THRESHOLD,
            address(migrator),
            0,
            address(priceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
        require(address(curve) == predictedCurve, "test setup: nonce prediction mismatch");
        vm.roll(block.number + curve.delayBlocks() + 1); // past the anti-snipe window

        for (uint256 i = 0; i < 300 && !curve.graduated(); i++) {
            address buyer = makeAddr(string.concat("migratorTestBuyer", vm.toString(i)));
            uint256 quoted = curve.quoteBuy(perBuyEth);
            if (quoted == 0 || quoted > curve.realTokenReserve() || quoted > curve.maxWalletTokens()) break;
            vm.deal(buyer, perBuyEth);
            vm.prank(buyer);
            curve.buy{value: perBuyEth}(0);
        }
        require(curve.graduated(), "test setup: curve did not graduate");
    }

    /* -------------------------------------------------------------------- */
    /*                       Successful end-to-end migration                */
    /* -------------------------------------------------------------------- */

    function test_Migrate_EndToEnd_CreatesPoolMintsAndBurnsLp() public {
        (ImmutableLaunchToken token, BondingCurve curve) = _deployGraduatedCurve(0.05 ether);

        uint256 expectedEth = curve.realEthReserve();
        uint256 expectedTokens = curve.liquidityReserveTokens();
        assertGt(expectedEth, 0, "test setup: curve should hold real eth reserve");
        assertGt(expectedTokens, 0, "test setup: curve should hold reserved tokens");
        assertFalse(migrator.migrated(address(curve)));

        (address pool, uint256 tokenId, uint128 liquidity) = migrator.migrate(curve);

        assertTrue(pool != address(0), "pool should be created");
        assertGt(liquidity, 0, "liquidity should be minted");
        assertTrue(migrator.migrated(address(curve)), "migrated flag should be set");

        // Curve's real ETH reserve is fully drained and one-way latched.
        // Its native balance can still hold accumulated, unclaimed
        // creator/protocol trade fees — those are a separate pull-payment
        // pot (see `withdrawCreatorFees`/`withdrawProtocolFees`)
        // completely untouched by migration, by design.
        assertEq(curve.realEthReserve(), 0, "curve real eth reserve should be fully withdrawn");
        assertEq(
            address(curve).balance,
            curve.creatorFeesOwed() + curve.protocolFeesOwed(),
            "curve should hold only unclaimed fee dust, not the migrated reserve"
        );
        assertTrue(curve.migrationExecuted(), "curve migration latch should be set");

        // LP NFT confirmed burned, not sitting in the migrator.
        assertEq(IERC721(POSITION_MANAGER).ownerOf(tokenId), BURN_ADDRESS, "LP NFT should be burned");
        assertEq(
            IERC721(POSITION_MANAGER).balanceOf(address(migrator)), 0, "migrator should hold no leftover LP NFTs"
        );

        // The migrator retains at most negligible wei-level dust of the
        // launched token — Uniswap's mint() can leave a tiny unused
        // remainder when converting desired amounts to actual liquidity
        // at specific ticks; it refunds that dust to the caller
        // (this contract) rather than consuming 100.000% exactly.
        assertLt(
            token.balanceOf(address(migrator)),
            1e12, // << 1 wei of a whole token (1e18); purely rounding dust
            "migrator should not retain any meaningful amount of the launched token"
        );
    }

    function test_Migrate_TickBounds_AreFullRangeForFeeTier() public view {
        // 887272 / 60 = 14787 (truncated), * 60 = 887220 — the standard
        // full-range ticks for Uniswap V3's 0.3% (spacing-60) tier.
        assertEq(migrator.tickLower(), -887220);
        assertEq(migrator.tickUpper(), 887220);
    }

    /* -------------------------------------------------------------------- */
    /*                            Revert conditions                         */
    /* -------------------------------------------------------------------- */

    function test_RevertWhen_MigratingBeforeGraduation() public {
        address deployerAddr = address(this);
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);
        ImmutableLaunchToken token =
            new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, TOTAL_SUPPLY, predictedCurve);
        BondingCurve curve = new BondingCurve(
            IERC20(address(token)),
            VIRTUAL_ETH,
            VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            ETH_USD_PRICE,
            0,
            GRADUATION_THRESHOLD,
            address(migrator),
            0,
            address(priceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
        assertFalse(curve.graduated());

        vm.expectRevert(GraduationMigrator.NotGraduated.selector);
        migrator.migrate(curve);
    }

    function test_RevertWhen_MigratingTwice() public {
        (, BondingCurve curve) = _deployGraduatedCurve(0.05 ether);
        migrator.migrate(curve);

        vm.expectRevert(GraduationMigrator.AlreadyMigrated.selector);
        migrator.migrate(curve);
    }

    function test_RevertWhen_WithdrawForMigrationCalledDirectlyByNonMigrator() public {
        (, BondingCurve curve) = _deployGraduatedCurve(0.05 ether);

        // The curve only trusts the exact `migrator` address configured
        // at its own construction — calling it directly (bypassing
        // `GraduationMigrator.migrate`) must revert regardless of caller.
        vm.expectRevert(bytes("BondingCurve: not migrator"));
        curve.withdrawForMigration();
    }

    /// @notice Revert-safety: if Uniswap's `mint` reverts for any reason,
    /// the ENTIRE migration — including the curve's own
    /// `withdrawForMigration` state changes that already ran earlier in
    /// this same call — unwinds atomically. Confirmed by mocking `mint`
    /// to always revert and asserting the curve is left exactly as if
    /// `migrate` had never been called.
    function test_RevertWhen_MintFails_EntireMigrationAtomicallyReverts() public {
        (, BondingCurve curve) = _deployGraduatedCurve(0.05 ether);

        uint256 ethBefore = curve.realEthReserve();
        uint256 curveBalanceBefore = address(curve).balance;
        bool executedBefore = curve.migrationExecuted();
        assertFalse(executedBefore);

        vm.mockCallRevert(
            POSITION_MANAGER,
            abi.encodeWithSelector(INonfungiblePositionManager.mint.selector),
            bytes("mock: mint reverted")
        );

        vm.expectRevert(bytes("mock: mint reverted"));
        migrator.migrate(curve);

        assertEq(curve.realEthReserve(), ethBefore, "curve eth reserve must be unchanged after revert");
        assertEq(address(curve).balance, curveBalanceBefore, "curve native balance must be unchanged");
        assertFalse(curve.migrationExecuted(), "curve migration latch must not be set");
        assertFalse(migrator.migrated(address(curve)), "migrator latch must not be set");
    }

    /// @notice Same atomicity guarantee, exercised via pool
    /// creation/initialization failing instead of minting.
    function test_RevertWhen_PoolCreationFails_EntireMigrationAtomicallyReverts() public {
        (, BondingCurve curve) = _deployGraduatedCurve(0.05 ether);
        uint256 ethBefore = curve.realEthReserve();

        vm.mockCallRevert(
            POSITION_MANAGER,
            abi.encodeWithSelector(INonfungiblePositionManager.createAndInitializePoolIfNecessary.selector),
            bytes("mock: pool creation reverted")
        );

        vm.expectRevert(bytes("mock: pool creation reverted"));
        migrator.migrate(curve);

        assertEq(curve.realEthReserve(), ethBefore);
        assertFalse(curve.migrationExecuted());
        assertFalse(migrator.migrated(address(curve)));
    }

    function test_RevertWhen_ConstructedWithUnknownFeeTier() public {
        vm.expectRevert(bytes("GraduationMigrator: unknown fee tier"));
        new GraduationMigrator(UNISWAP_V3_FACTORY, POSITION_MANAGER, WETH9, 1234, SWAP_ROUTER);
    }

    function test_RevertWhen_ConstructedWithZeroAddresses() public {
        vm.expectRevert(bytes("GraduationMigrator: zero factory"));
        new GraduationMigrator(address(0), POSITION_MANAGER, WETH9, POOL_FEE, SWAP_ROUTER);

        vm.expectRevert(bytes("GraduationMigrator: zero position manager"));
        new GraduationMigrator(UNISWAP_V3_FACTORY, address(0), WETH9, POOL_FEE, SWAP_ROUTER);

        vm.expectRevert(bytes("GraduationMigrator: zero weth9"));
        new GraduationMigrator(UNISWAP_V3_FACTORY, POSITION_MANAGER, address(0), POOL_FEE, SWAP_ROUTER);

        vm.expectRevert(bytes("GraduationMigrator: zero swap router"));
        new GraduationMigrator(UNISWAP_V3_FACTORY, POSITION_MANAGER, WETH9, POOL_FEE, address(0));
    }

    /* -------------------------------------------------------------------- */
    /*                                 Fuzzing                               */
    /* -------------------------------------------------------------------- */

    /// @notice Fuzzes the per-buy size that pushes a fresh curve to
    /// graduation, so the curve's actual `realEthReserve` at graduation
    /// (and therefore the exact reserves seeded into the pool) varies
    /// meaningfully run-to-run — confirming migration succeeds across a
    /// realistic range of graduation-time reserve sizes, not just one.
    function testFuzz_Migrate_AcrossReserveSizes(uint256 perBuyEth) public {
        perBuyEth = bound(perBuyEth, 0.01 ether, 0.5 ether);

        address deployerAddr = address(this);
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);
        ImmutableLaunchToken token =
            new ImmutableLaunchToken(NAME, SYMBOL, DECIMALS, TOTAL_SUPPLY, predictedCurve);
        BondingCurve curve = new BondingCurve(
            IERC20(address(token)),
            VIRTUAL_ETH,
            VIRTUAL_TOKEN,
            creator,
            protocolTreasury,
            ETH_USD_PRICE,
            0,
            GRADUATION_THRESHOLD,
            address(migrator),
            0,
            address(priceFeed),
            address(0),
            0,
            address(0),
            address(0)
        );
        vm.roll(block.number + curve.delayBlocks() + 1); // past the anti-snipe window

        for (uint256 i = 0; i < 500 && !curve.graduated(); i++) {
            address buyer = makeAddr(string.concat("fuzzMigratorBuyer", vm.toString(i), vm.toString(perBuyEth)));
            uint256 quoted = curve.quoteBuy(perBuyEth);
            if (quoted == 0 || quoted > curve.realTokenReserve() || quoted > curve.maxWalletTokens()) break;
            vm.deal(buyer, perBuyEth);
            vm.prank(buyer);
            curve.buy{value: perBuyEth}(0);
        }
        vm.assume(curve.graduated());

        uint256 ethReserveAtGraduation = curve.realEthReserve();
        assertGe(ethReserveAtGraduation, GRADUATION_THRESHOLD);

        (address pool, uint256 tokenId, uint128 liquidity) = migrator.migrate(curve);

        assertTrue(pool != address(0));
        assertGt(liquidity, 0);
        assertTrue(migrator.migrated(address(curve)));
        assertEq(IERC721(POSITION_MANAGER).ownerOf(tokenId), BURN_ADDRESS);
        assertEq(curve.realEthReserve(), 0);
    }
}
