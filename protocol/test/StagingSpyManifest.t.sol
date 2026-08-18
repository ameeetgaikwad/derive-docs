// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {AddMainnetStagingRwaMarket} from "../script/AddMainnetStagingRwaMarket.s.sol";
import {MarketDeployerBase} from "../script/MarketDeployerBase.sol";

contract StagingSpyManifestHarness is AddMainnetStagingRwaMarket {
    function stagingManifestConfig(string memory marketId) external returns (MarketConfig memory config) {
        config = getMarketConfigById(marketId);
        return _applyStagingManifest(config);
    }
}

contract StagingSpyManifestTest is Test {
    function testStagingSpyUsesReviewedChainlinkSource() public {
        vm.chainId(56);
        StagingSpyManifestHarness harness = new StagingSpyManifestHarness();
        MarketDeployerBase.MarketConfig memory config = harness.stagingManifestConfig("SPY");

        assertEq(uint256(config.oracleProvider), uint256(MarketDeployerBase.OracleProvider.Chainlink));
        assertEq(config.chainlinkAggregator, 0xb24D1DeE5F9a3f761D286B56d2bC44CE1D02DF7e);
        assertEq(config.pythPriceId, bytes32(0));
        assertFalse(config.benchmarkSettlement);
    }
}
