// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ProtocolTreasury} from "../src/ProtocolTreasury.sol";

/// @title DeployProtocolTreasury
/// @notice Deploys the single, protocol-wide `ProtocolTreasury`. Deploy
/// this ONCE; every `BondingCurve` the factory creates afterward points at
/// the same treasury address via `PROTOCOL_TREASURY_ADDRESS`.
///
/// Usage:
///
///   forge script script/DeployProtocolTreasury.s.sol:DeployProtocolTreasury \
///     --rpc-url arbitrum_sepolia \
///     --broadcast \
///     -vvvv
///
/// Required environment variables:
///   PRIVATE_KEY           - deployer key; pays gas only.
///   TREASURY_OWNER_ADDRESS - the multisig that will control withdrawals.
contract DeployProtocolTreasury is Script {
    function run() external returns (ProtocolTreasury treasury) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address owner_ = vm.envAddress("TREASURY_OWNER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        treasury = new ProtocolTreasury(owner_);
        vm.stopBroadcast();

        console.log("ProtocolTreasury deployed at:", address(treasury));
        console.log("Owner:", treasury.owner());
    }
}
