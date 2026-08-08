// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";

/// @title DeployTokenAndCurve
/// @notice Deploys a matched `ImmutableLaunchToken` + `BondingCurve` pair to
/// Arbitrum Sepolia (chain id 421614) — or, unmodified, to Robinhood Chain,
/// which is EVM/bytecode-identical as an Arbitrum Orbit L2.
///
/// DEPLOYMENT ORDERING
/// --------------------
/// `BondingCurve`'s constructor needs the token's address; the token's
/// constructor needs the curve's address as its mint recipient. Neither
/// contract exposes any post-deploy "set this later" admin function (that
/// would reintroduce exactly the kind of privileged setter this whole
/// system deliberately avoids), so the two addresses are resolved by
/// predicting the bonding curve's CREATE address one nonce ahead of the
/// token's, deploying the token first with that predicted address as its
/// `curve` mint recipient, then deploying the curve at that exact address.
/// This is the standard two-`new`-calls pattern a factory contract would
/// also use internally.
///
/// This script does NOT deploy a `ProtocolTreasury` — that is meant to be a
/// single, protocol-wide contract shared by every `BondingCurve` the
/// factory deploys, not a per-token one-off. Deploy it once separately
/// (see `DeployProtocolTreasury.s.sol`) and pass its address in via
/// `PROTOCOL_TREASURY_ADDRESS`.
///
/// Usage:
///
///   forge script script/DeployTokenAndCurve.s.sol:DeployTokenAndCurve \
///     --rpc-url arbitrum_sepolia \
///     --broadcast \
///     --verify \
///     -vvvv
///
/// Required environment variables (see `.env.example`):
///   PRIVATE_KEY               - deployer key; pays gas only, receives
///                                nothing (same rationale as the standalone
///                                token deploy script).
///   TOKEN_NAME / TOKEN_SYMBOL / TOKEN_DECIMALS / TOKEN_TOTAL_SUPPLY
///                              - as in DeployImmutableLaunchToken.s.sol.
///   VIRTUAL_ETH_RESERVE        - virtual ETH liquidity, in whole ETH.
///   VIRTUAL_TOKEN_RESERVE      - virtual token liquidity, in whole tokens.
///   CREATOR_ADDRESS            - token creator; receives a flat 75% share
///                                of the 1% trade fee, for the life of the
///                                token.
///   PROTOCOL_TREASURY_ADDRESS  - already-deployed ProtocolTreasury address.
///   DELAY_BLOCKS               - number of blocks after deployment during
///                                which buy() is blocked (anti-snipe). E.g.
///                                1.
///   GRADUATION_THRESHOLD_WEI   - real-ETH-raised level (in wei) at which
///                                this curve graduates and halts trading.
///                                E.g. 4200000000000000000 for 4.2 ETH.
///   GRADUATION_MIGRATOR_ADDRESS - already-deployed GraduationMigrator
///                                address; the only address ever
///                                authorized to pull this curve's real ETH
///                                reserve + reserved liquidity tokens once
///                                graduated (see DeployGraduationMigrator.s.sol).
///   SELL_TAX_BPS                - additional creator-only tax on `sell`
///                                proceeds, in basis points (0-300, i.e.
///                                0%-3%), applied only to whale sells (see
///                                BondingCurve.sol's "SELL TAX" NatSpec).
///                                `buy` is never subject to this.
///   ETH_USD_PRICE_FEED_ADDRESS  - Chainlink-style ETH/USD price feed used
///                                ONLY to gate the whale sell tax live.
///                                Required even if SELL_TAX_BPS is 0 (any
///                                non-zero placeholder works in that case —
///                                it's never read when the rate is zero).
///   REFERRAL_VAULT_ADDRESS      - already-deployed ReferralVault address.
///                                Optional; omit (or pass the zero address)
///                                to opt this curve out of referrals.
contract DeployTokenAndCurve is Script {
    function run() external returns (ImmutableLaunchToken token, BondingCurve curve) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployerAddr = vm.addr(deployerPrivateKey);

        string memory name_ = vm.envString("TOKEN_NAME");
        string memory symbol_ = vm.envString("TOKEN_SYMBOL");
        uint8 decimals_ = uint8(vm.envUint("TOKEN_DECIMALS"));
        uint256 wholeTokenSupply = vm.envUint("TOKEN_TOTAL_SUPPLY");
        uint256 totalSupply_ = wholeTokenSupply * (10 ** uint256(decimals_));

        uint256 wholeVirtualEth = vm.envUint("VIRTUAL_ETH_RESERVE");
        uint256 wholeVirtualToken = vm.envUint("VIRTUAL_TOKEN_RESERVE");
        uint256 virtualEthReserve_ = wholeVirtualEth * 1 ether;
        uint256 virtualTokenReserve_ = wholeVirtualToken * (10 ** uint256(decimals_));

        address creator_ = vm.envAddress("CREATOR_ADDRESS");
        address protocolTreasury_ = vm.envAddress("PROTOCOL_TREASURY_ADDRESS");
        uint256 delayBlocks_ = vm.envUint("DELAY_BLOCKS");
        uint256 graduationThreshold_ = vm.envUint("GRADUATION_THRESHOLD_WEI");
        address migrator_ = vm.envAddress("GRADUATION_MIGRATOR_ADDRESS");
        uint256 sellTaxBps_ = vm.envUint("SELL_TAX_BPS");
        address ethUsdPriceFeed_ = vm.envAddress("ETH_USD_PRICE_FEED_ADDRESS");
        address referralVault_ = vm.envOr("REFERRAL_VAULT_ADDRESS", address(0));

        // Predict the curve's address one nonce ahead of the token's, so
        // the token can be minted straight to it.
        uint256 nonce = vm.getNonce(deployerAddr);
        address predictedCurve = vm.computeCreateAddress(deployerAddr, nonce + 1);

        vm.startBroadcast(deployerPrivateKey);

        token = new ImmutableLaunchToken(name_, symbol_, decimals_, totalSupply_, predictedCurve);
        curve = new BondingCurve(
            IERC20(address(token)),
            virtualEthReserve_,
            virtualTokenReserve_,
            creator_,
            protocolTreasury_,
            delayBlocks_,
            graduationThreshold_,
            migrator_,
            sellTaxBps_,
            ethUsdPriceFeed_,
            address(0),
            0,
            address(0),
            referralVault_
        );

        vm.stopBroadcast();

        require(address(curve) == predictedCurve, "curve address prediction mismatch");

        console.log("ImmutableLaunchToken deployed at:", address(token));
        console.log("BondingCurve deployed at:", address(curve));
        console.log("Name:", token.name());
        console.log("Symbol:", token.symbol());
        console.log("Decimals:", token.decimals());
        console.log("Total supply (smallest unit):", token.totalSupply());
        console.log("Curve token balance (real reserve):", token.balanceOf(address(curve)));
        console.log("Virtual ETH reserve:", curve.virtualEthReserve());
        console.log("Virtual token reserve:", curve.virtualTokenReserve());
        console.log("Initial spot price (wei per whole token):", curve.getPrice());
        console.log("Creator:", curve.creator());
        console.log("Protocol treasury:", curve.protocolTreasury());
        console.log("Creator fee share (bps, flat):", curve.currentCreatorFeeShareBps());
        console.log("Launch block:", curve.launchBlock());
        console.log("Delay blocks:", curve.delayBlocks());
        console.log("Max wallet tokens (2.5% of supply):", curve.maxWalletTokens());
        console.log("Graduation threshold (wei):", curve.graduationThreshold());
        console.log("Graduation migrator:", curve.migrator());
        console.log("Liquidity reserve tokens (20%, never sellable here):", curve.liquidityReserveTokens());
        console.log("Sell tax (bps):", curve.sellTaxBps());
        console.log("ETH/USD price feed:", address(curve.ethUsdPriceFeed()));
        console.log("Referral vault:", curve.referralVault());
        console.log("Referrer (0 = none):", curve.referrer());
    }
}
