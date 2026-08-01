// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {InfoFiCampaign} from "../src/InfoFiCampaign.sol";

/// @title DeployInfoFiCampaign
/// @notice Deploys the single, protocol-wide `InfoFiCampaign`. Deploy ONCE;
/// every `BondingCurve` launched with a non-zero `infoFiBps` transfers its
/// pool to this same address at construction.
///
/// Usage:
///
///   forge script script/DeployInfoFiCampaign.s.sol:DeployInfoFiCampaign \
///     --rpc-url arbitrum_sepolia --broadcast -vvvv
///
/// Required environment variables:
///   PRIVATE_KEY                  - deployer key; pays gas only.
///   INFOFI_TEAM_ADDRESS          - the ONLY address that can open and
///                                  settle campaigns. Use a multisig in
///                                  production; it is immutable once set.
///   INFOFI_MCAP_THRESHOLD_USD18  - sustained market cap required, 18dp USD
///                                  (120000e18 = $120k).
///   INFOFI_SUSTAINED_DURATION    - seconds it must hold (86400 = 24h).
///   UNISWAP_V3_FACTORY_ADDRESS   - for the post-graduation TWAP read.
///   WETH9_ADDRESS                - the pair side graduated pools use.
///   UNISWAP_V3_POOL_FEE          - must match GraduationMigrator's tier.
///   ETH_USD_PRICE_FEED_ADDRESS   - Chainlink-style ETH/USD feed.
///
/// NOTE ON `team`: this address can start a campaign and publish its payout
/// root. It can NEVER take a pool — there is no sweep path in the contract.
/// Still, a compromised team key could open campaigns and publish roots
/// paying itself, so it should be a multisig, not a hot wallet.
contract DeployInfoFiCampaign is Script {
    function run() external returns (InfoFiCampaign campaign) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address team = vm.envAddress("INFOFI_TEAM_ADDRESS");
        uint256 mcapThreshold = vm.envUint("INFOFI_MCAP_THRESHOLD_USD18");
        uint64 sustained = uint64(vm.envUint("INFOFI_SUSTAINED_DURATION"));
        address factory = vm.envAddress("UNISWAP_V3_FACTORY_ADDRESS");
        address weth9 = vm.envAddress("WETH9_ADDRESS");
        uint24 poolFee = uint24(vm.envUint("UNISWAP_V3_POOL_FEE"));
        address ethUsdFeed = vm.envAddress("ETH_USD_PRICE_FEED_ADDRESS");
        bool graduationOnly = vm.envOr("INFOFI_GRADUATION_ONLY", false);

        vm.startBroadcast(deployerPrivateKey);
        campaign = new InfoFiCampaign(
            team, mcapThreshold, sustained, factory, weth9, poolFee, ethUsdFeed, graduationOnly
        );
        vm.stopBroadcast();

        console.log("InfoFiCampaign deployed at:", address(campaign));
        console.log("team (open/settle only, no sweep):", campaign.team());
        console.log("mcap threshold (18dp USD):", campaign.mcapThresholdUsd18());
        console.log("sustained duration (seconds):", campaign.sustainedDuration());
        console.log("campaign window (seconds):", campaign.CAMPAIGN_WINDOW());
        console.log("claim window (seconds):", campaign.CLAIM_WINDOW());
        console.log("abandon period (seconds):", campaign.ABANDON_PERIOD());
        console.log("burn address:", campaign.BURN_ADDRESS());
    }
}
