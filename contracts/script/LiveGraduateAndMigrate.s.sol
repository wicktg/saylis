// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {GraduationMigrator} from "../src/GraduationMigrator.sol";

/// @notice One-off live-testnet script: funds a series of fresh wallets
/// from the deployer, has each buy into an already-deployed BondingCurve
/// until it graduates, then triggers migration and reports the result.
/// NOT part of the permanent deploy tooling — throwaway test script.
contract LiveGraduateAndMigrate is Script {
    address constant POSITION_MANAGER = 0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65;
    address constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        BondingCurve curve = BondingCurve(payable(vm.envAddress("CURVE_ADDRESS")));
        GraduationMigrator migrator = GraduationMigrator(payable(vm.envAddress("MIGRATOR_ADDRESS")));

        uint256 perBuyEth = 0.05 ether;
        uint256 fundAmount = perBuyEth + 0.0005 ether; // buffer for gas

        uint256 i = 0;
        while (!curve.graduated() && i < 200) {
            (address buyer, uint256 buyerKey) = makeAddrAndKey(string.concat("liveBuyer", vm.toString(i)));

            vm.startBroadcast(deployerKey);
            (bool sent,) = buyer.call{value: fundAmount}("");
            require(sent, "fund failed");
            vm.stopBroadcast();

            uint256 quoted = curve.quoteBuy(perBuyEth);
            if (quoted == 0 || quoted > curve.realTokenReserve() || quoted > curve.maxWalletTokens()) {
                console.log("stopping: buy would exceed a limit at i =", i);
                break;
            }

            vm.startBroadcast(buyerKey);
            curve.buy{value: perBuyEth}(0);
            vm.stopBroadcast();

            console.log("buy", i, "done. graduated =", curve.graduated());
            i++;
        }

        console.log("=== Graduation summary ===");
        console.log("buyers used:", i);
        console.log("graduated:", curve.graduated());
        console.log("realEthReserve:", curve.realEthReserve());
        console.log("liquidityReserveTokens:", curve.liquidityReserveTokens());
        console.log("creatorFeesOwed:", curve.creatorFeesOwed());
        console.log("protocolFeesOwed:", curve.protocolFeesOwed());

        require(curve.graduated(), "curve did not graduate within buyer cap");

        uint256 preMigrateEthReserve = curve.realEthReserve();
        uint256 preMigrateReservedTokens = curve.liquidityReserveTokens();

        vm.startBroadcast(deployerKey);
        (address pool, uint256 tokenId, uint128 liquidity) = migrator.migrate(curve);
        vm.stopBroadcast();

        console.log("=== Migration summary ===");
        console.log("pool:", pool);
        console.log("tokenId:", tokenId);
        console.log("liquidity:", liquidity);
        console.log("LP owner (should be burn address):", IERC721(POSITION_MANAGER).ownerOf(tokenId));
        console.log("pre-migrate realEthReserve (wei):", preMigrateEthReserve);
        console.log("pre-migrate liquidityReserveTokens:", preMigrateReservedTokens);
        console.log("post-migrate curve.realEthReserve:", curve.realEthReserve());
        console.log("post-migrate curve.migrationExecuted:", curve.migrationExecuted());
        console.log("post-migrate curve native balance (should == owed fees):", address(curve).balance);

        uint256 creatorOwed = curve.creatorFeesOwed();
        uint256 protocolOwed = curve.protocolFeesOwed();

        vm.startBroadcast(deployerKey);
        uint256 creatorWithdrawn = curve.withdrawCreatorFees();
        uint256 protocolWithdrawn = curve.withdrawProtocolFees();
        vm.stopBroadcast();

        console.log("=== Fee withdrawal summary (deployer is both creator + protocolTreasury) ===");
        console.log("creatorFeesOwed (pre-withdraw):", creatorOwed);
        console.log("protocolFeesOwed (pre-withdraw):", protocolOwed);
        console.log("creatorWithdrawn (actual):", creatorWithdrawn);
        console.log("protocolWithdrawn (actual):", protocolWithdrawn);
        console.log("full payout confirmed:", creatorWithdrawn == creatorOwed && protocolWithdrawn == protocolOwed);
        console.log("post-withdraw creatorFeesOwed (should be 0):", curve.creatorFeesOwed());
        console.log("post-withdraw protocolFeesOwed (should be 0):", curve.protocolFeesOwed());
        console.log("post-withdraw curve native balance (should be 0):", address(curve).balance);
    }
}
