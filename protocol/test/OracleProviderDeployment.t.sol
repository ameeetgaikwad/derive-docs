// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {DeployAll} from "../script/DeployAll.s.sol";
import {AddMainnetStagingRwaMarket} from "../script/AddMainnetStagingRwaMarket.s.sol";
import {MarketDeployerBase} from "../script/MarketDeployerBase.sol";
import {MockChainlinkAggregator} from "./mocks/MockChainlinkAggregator.sol";

contract OracleProviderDeploymentHarness is DeployAll {
  function deployChainlinkNvda(MockChainlinkAggregator aggregator)
    external
    returns (MarketDeployment memory deployed)
  {
    deployer = address(this);
    feedSigner = address(this);
    _setupTokens();
    _deployCore();

    MarketConfig memory config = getMarketConfig(4);
    config.oracleProvider = OracleProvider.Chainlink;
    config.benchmarkSettlement = false;
    config.pythPriceId = bytes32(0);
    config.chainlinkAggregator = address(aggregator);
    address underlying = _resolveUnderlying(config);
    deployed = _deployAndRegisterMarket(subAccounts, srm, srmViewer, underlying, config);
  }
}

contract MainnetStagingRwaSequenceHarness is AddMainnetStagingRwaMarket {
  function nextStagingMarketId(string memory marketId, uint256 lastMarketId)
    external
    pure
    returns (uint256)
  {
    _stagingMarketConfig(marketId);
    return _nextStagingMarketId(marketId, lastMarketId);
  }
}

contract OracleProviderDeploymentTest is Test {
  function testChainlinkManifestModeDeploysNoPythContracts() public {
    vm.chainId(31337);
    vm.warp(1_781_000_000);
    MockChainlinkAggregator aggregator = new MockChainlinkAggregator(8);
    aggregator.setAnswer(18_000_000_000, block.timestamp);

    OracleProviderDeploymentHarness harness = new OracleProviderDeploymentHarness();
    MarketDeployerBase.MarketDeployment memory deployed = harness.deployChainlinkNvda(aggregator);

    assertEq(address(deployed.pythSpotFeed), address(0));
    assertEq(address(deployed.benchmarkSettlementFeed), address(0));
    assertTrue(address(deployed.chainlinkSpotFeed) != address(0));
    assertTrue(address(deployed.settlementFeed) != address(0));
    assertTrue(address(deployed.scaledSpotFeed) != address(0));
    assertTrue(address(deployed.scaledSettlementFeed) != address(0));
    assertTrue(address(deployed.multiplierRegistry) != address(0));
    assertEq(address(deployed.chainlinkSpotFeed.aggregator()), address(aggregator));
    assertEq(address(deployed.settlementFeed.aggregator()), address(aggregator));
    assertEq(address(deployed.settlementFeed.pyth()), address(0));
    assertEq(deployed.settlementFeed.priceId(), bytes32(0));
    assertEq(deployed.settlementFeed.maxRoundDelay(), 24 hours);
    assertEq(address(deployed.scaledSpotFeed.uiSpotFeed()), address(deployed.chainlinkSpotFeed));
    assertEq(
      address(deployed.scaledSettlementFeed.uiSettlementFeed()),
      address(deployed.settlementFeed)
    );
    assertEq(deployed.liveSpotFeed, address(deployed.scaledSpotFeed));
    assertEq(deployed.liveSettlementFeed, address(deployed.scaledSettlementFeed));
  }

  function testStagingNvdaDoesNotRequireSpyToBeDeployedFirst() public {
    MainnetStagingRwaSequenceHarness sequence = new MainnetStagingRwaSequenceHarness();

    assertEq(sequence.nextStagingMarketId("XAU", 1), 2);
    assertEq(sequence.nextStagingMarketId("NVDA", 2), 3);
    assertEq(sequence.nextStagingMarketId("SPY", 3), 4);

    vm.expectRevert(
      abi.encodeWithSelector(AddMainnetStagingRwaMarket.NoRemainingRwaMarketSlot.selector, 4)
    );
    sequence.nextStagingMarketId("SPY", 4);
  }

}
