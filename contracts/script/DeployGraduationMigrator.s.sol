// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {GraduationMigrator} from "../src/GraduationMigrator.sol";

/// @title DeployGraduationMigrator
/// @notice Deploys the single, protocol-wide `GraduationMigrator`. Deploy
/// this ONCE; every `BondingCurve` the factory creates afterward points at
/// the same migrator address via `GRADUATION_MIGRATOR_ADDRESS` (see
/// DeployTokenAndCurve.s.sol).
///
/// Usage:
///
///   forge script script/DeployGraduationMigrator.s.sol:DeployGraduationMigrator \
///     --rpc-url arbitrum_sepolia \
///     --broadcast \
///     -vvvv
///
/// Required environment variables:
///   PRIVATE_KEY                    - deployer key; pays gas only.
///   UNISWAP_V3_FACTORY_ADDRESS     - canonical Uniswap V3 factory for the
///                                    target chain.
///   UNISWAP_V3_POSITION_MANAGER_ADDRESS
///                                  - canonical Uniswap V3
///                                    NonfungiblePositionManager for the
///                                    target chain.
///   WETH9_ADDRESS                  - canonical WETH9 for the target chain.
///   UNISWAP_V3_POOL_FEE             - fee tier (hundredths of a bip) to
///                                    create/seed pools at. Use 10000 (the
///                                    1% tier): the pool fee is the
///                                    creator's main post-graduation
///                                    income, since `TokenFeeCollector`
///                                    now holds the LP position and can
///                                    actually claim it. Must be a tier the
///                                    factory recognizes.
///
/// IMPORTANT: verify these addresses against Uniswap's own official
/// deployment docs for the target chain before broadcasting — this script
/// deliberately takes them as required env vars rather than hardcoding
/// them, so a wrong/stale address fails loudly instead of silently.
contract DeployGraduationMigrator is Script {
    function run() external returns (GraduationMigrator migrator) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address factory_ = vm.envAddress("UNISWAP_V3_FACTORY_ADDRESS");
        address positionManager_ = vm.envAddress("UNISWAP_V3_POSITION_MANAGER_ADDRESS");
        address weth9_ = vm.envAddress("WETH9_ADDRESS");
        uint24 poolFee_ = uint24(vm.envUint("UNISWAP_V3_POOL_FEE"));
        address swapRouter_ = vm.envAddress("UNISWAP_SWAP_ROUTER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        migrator = new GraduationMigrator(factory_, positionManager_, weth9_, poolFee_, swapRouter_);
        vm.stopBroadcast();

        console.log("GraduationMigrator deployed at:", address(migrator));
        console.log("Uniswap V3 factory:", address(migrator.factory()));
        console.log("Uniswap V3 position manager:", address(migrator.positionManager()));
        console.log("WETH9:", address(migrator.weth9()));
        console.log("Pool fee:", migrator.poolFee());
        console.log("Tick lower (full range):", vm.toString(migrator.tickLower()));
        console.log("Tick upper (full range):", vm.toString(migrator.tickUpper()));
    }
}
