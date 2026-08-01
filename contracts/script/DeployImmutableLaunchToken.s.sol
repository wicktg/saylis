// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ImmutableLaunchToken} from "../src/ImmutableLaunchToken.sol";

/// @title DeployImmutableLaunchToken
/// @notice Deploys a single `ImmutableLaunchToken` to Arbitrum Sepolia
/// (chain id 421614). Robinhood Chain is an Arbitrum Orbit L2 that is
/// chain-identical at the EVM/bytecode level, so the exact same script and
/// compiled artifact target it too — only `--rpc-url` changes.
///
/// Usage:
///
///   forge script script/DeployImmutableLaunchToken.s.sol:DeployImmutableLaunchToken \
///     --rpc-url arbitrum_sepolia \
///     --broadcast \
///     --verify \
///     -vvvv
///
/// Required environment variables (see `.env.example`):
///   PRIVATE_KEY              - deployer key, used ONLY to pay gas & submit
///                               the deployment tx. It never receives tokens.
///   BONDING_CURVE_ADDRESS    - the sole recipient of the entire supply.
///   TOKEN_NAME                - e.g. "Saylis Doge"
///   TOKEN_SYMBOL              - e.g. "LDOGE"
///   TOKEN_DECIMALS            - e.g. 18
///   TOKEN_TOTAL_SUPPLY        - in whole tokens (script scales by decimals)
///   ARBITRUM_SEPOLIA_RPC_URL  - RPC endpoint (see foundry.toml)
///   ARBISCAN_API_KEY          - only needed for --verify
contract DeployImmutableLaunchToken is Script {
    function run() external returns (ImmutableLaunchToken token) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address curve = vm.envAddress("BONDING_CURVE_ADDRESS");
        string memory name_ = vm.envString("TOKEN_NAME");
        string memory symbol_ = vm.envString("TOKEN_SYMBOL");
        uint8 decimals_ = uint8(vm.envUint("TOKEN_DECIMALS"));
        uint256 wholeTokenSupply = vm.envUint("TOKEN_TOTAL_SUPPLY");

        // Scale the human-readable supply (e.g. "1000000000") into the
        // token's smallest unit using its own decimals, exactly once, here
        // in the deploy script — the contract itself never does this
        // conversion or any other supply arithmetic beyond a single _mint.
        uint256 totalSupply_ = wholeTokenSupply * (10 ** uint256(decimals_));

        // Deliberately NOT using vm.addr(deployerPrivateKey) as any kind of
        // recipient or admin parameter below — the deployer key exists
        // solely to sign and pay for this transaction.
        vm.startBroadcast(deployerPrivateKey);

        token = new ImmutableLaunchToken(name_, symbol_, decimals_, totalSupply_, curve);

        vm.stopBroadcast();

        console.log("ImmutableLaunchToken deployed at:", address(token));
        console.log("Name:", token.name());
        console.log("Symbol:", token.symbol());
        console.log("Decimals:", token.decimals());
        console.log("Total supply (smallest unit):", token.totalSupply());
        console.log("Entire supply minted to bonding curve:", curve);
        console.log("Curve balance:", token.balanceOf(curve));
    }
}
