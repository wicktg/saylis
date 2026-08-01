// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ReferralVault} from "../src/ReferralVault.sol";

/// @title DeployReferralVault
/// @notice Deploys the single, protocol-wide `ReferralVault`. Deploy this
/// ONCE; every `BondingCurve` deployed afterward points at the same vault
/// address so a referrer's earnings unify across every creator they've
/// referred, regardless of which curve the fee came from.
///
/// Usage:
///
///   forge script script/DeployReferralVault.s.sol:DeployReferralVault \
///     --rpc-url arbitrum_sepolia --broadcast -vvvv
///
/// Required environment variables:
///   PRIVATE_KEY - deployer key; pays gas only. The vault has no owner and
///                 no admin function of any kind — nothing to configure.
contract DeployReferralVault is Script {
    function run() external returns (ReferralVault vault) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        vault = new ReferralVault();
        vm.stopBroadcast();

        console.log("ReferralVault deployed at:", address(vault));
    }
}
