// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {DeployMainnetStaging} from "../script/DeployMainnetStaging.s.sol";
import {MarketDeployerBase} from "../script/MarketDeployerBase.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";

contract StagingTokenMock {
  string public symbol;
  uint8 public decimals;

  constructor(string memory symbol_, uint8 decimals_) {
    symbol = symbol_;
    decimals = decimals_;
  }
}

contract StagingPythMock {
  IPyth.Price internal price;

  constructor(int64 value, uint publishTime) {
    price = IPyth.Price({price: value, conf: 1, expo: -8, publishTime: publishTime});
  }

  function getPriceUnsafe(bytes32) external view returns (IPyth.Price memory) {
    return price;
  }
}

contract StagingChainlinkMock {
  string public description;
  uint8 public decimals;
  uint80 internal roundId;
  int256 internal answer;
  uint256 internal updatedAt;
  uint80 internal answeredInRound;

  constructor(
    string memory description_,
    uint8 decimals_,
    uint80 roundId_,
    int256 answer_,
    uint256 updatedAt_,
    uint80 answeredInRound_
  ) {
    description = description_;
    decimals = decimals_;
    roundId = roundId_;
    answer = answer_;
    updatedAt = updatedAt_;
    answeredInRound = answeredInRound_;
  }

  function latestRoundData()
    external
    view
    returns (uint80, int256, uint256, uint256, uint80)
  {
    return (roundId, answer, updatedAt, updatedAt, answeredInRound);
  }
}

contract DeployMainnetStagingHarness is DeployMainnetStaging {
  function deploymentOutputPath() external view returns (string memory) {
    return _deploymentOutputPath();
  }

  function validateStagingOperationalRoles(
    uint256 deployerKey,
    address stagingFeedSigner,
    address stagingTradeExecutor
  ) external pure {
    _validateStagingOperationalRoles(deployerKey, stagingFeedSigner, stagingTradeExecutor);
  }

  function requireExpectedAddress(bytes32 dependency, address expected, address actual)
    external
    pure
  {
    _requireExpectedAddress(dependency, expected, actual);
  }

  function validateTokenMetadata(
    address token,
    bytes32 dependency,
    string memory expectedSymbol,
    uint8 expectedDecimals
  ) external view {
    _validateTokenMetadata(token, dependency, expectedSymbol, expectedDecimals);
  }

  function validatePythBtcPrice(address pythAddress) external view {
    _validatePythBtcPrice(pythAddress);
  }

  function validateChainlinkBtcFeed(address aggregator) external view {
    _validateChainlinkBtcFeed(aggregator);
  }

  function stagingPythAddress() external pure returns (address) {
    return _pythAddress();
  }
}

contract DeployMainnetStagingTest is Test {
  uint256 internal constant STAGING_DEPLOYER_KEY =
    0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  bytes32 internal constant BTCB_DEPENDENCY =
    0x4254434200000000000000000000000000000000000000000000000000000000;

  DeployMainnetStagingHarness internal deployment;

  function setUp() public {
    deployment = new DeployMainnetStagingHarness();
  }

  function testRejectsNonMainnetChain() public {
    vm.chainId(97);

    vm.expectRevert(abi.encodeWithSelector(DeployMainnetStaging.WrongChain.selector, 56, 97));
    deployment.run();
  }

  function testRequiresExactOperatorConfirmation() public {
    vm.chainId(56);
    vm.setEnv("MAINNET_STAGING_CONFIRM", "not-confirmed");

    vm.expectRevert(DeployMainnetStaging.InvalidMainnetStagingConfirmation.selector);
    deployment.run();
  }

  function testRequiresExplicitStagingDeployerKey() public {
    vm.expectRevert(DeployMainnetStaging.InvalidStagingDeployerKey.selector);
    deployment.validateStagingOperationalRoles(0, address(0x1001), address(0x1002));
  }

  function testRequiresExplicitStagingFeedSigner() public {
    vm.expectRevert(DeployMainnetStaging.InvalidStagingFeedSigner.selector);
    deployment.validateStagingOperationalRoles(STAGING_DEPLOYER_KEY, address(0), address(0x1002));
  }

  function testRequiresExplicitStagingTradeExecutor() public {
    vm.expectRevert(DeployMainnetStaging.InvalidStagingTradeExecutor.selector);
    deployment.validateStagingOperationalRoles(STAGING_DEPLOYER_KEY, address(0x1001), address(0));
  }

  function testRequiresDistinctStagingOperationalRoles() public {
    vm.expectRevert(DeployMainnetStaging.StagingOperationalRolesMustBeDistinct.selector);
    deployment.validateStagingOperationalRoles(
      STAGING_DEPLOYER_KEY, vm.addr(STAGING_DEPLOYER_KEY), address(0x1002)
    );
  }

  function testRejectsSharedFeedSignerAndTradeExecutor() public {
    vm.expectRevert(DeployMainnetStaging.StagingOperationalRolesMustBeDistinct.selector);
    deployment.validateStagingOperationalRoles(
      STAGING_DEPLOYER_KEY, address(0x1001), address(0x1001)
    );
  }

  function testAcceptsExplicitDistinctStagingOperationalRoles() public view {
    deployment.validateStagingOperationalRoles(
      STAGING_DEPLOYER_KEY, address(0x1001), address(0x1002)
    );
  }

  function testRejectsDependencyAddressOverride() public {
    vm.expectRevert(
      abi.encodeWithSelector(
        DeployMainnetStaging.StagingDependencyAddressMismatch.selector,
        BTCB_DEPENDENCY,
        address(0x1001),
        address(0x1002)
      )
    );
    deployment.requireExpectedAddress("BTCB", address(0x1001), address(0x1002));
  }

  function testAcceptsExpectedTokenMetadata() public {
    StagingTokenMock token = new StagingTokenMock("BTCB", 18);

    deployment.validateTokenMetadata(address(token), "BTCB", "BTCB", 18);
  }

  function testRejectsTokenWithoutContractCode() public {
    vm.expectRevert(
      abi.encodeWithSelector(
        DeployMainnetStaging.StagingDependencyHasNoCode.selector,
        BTCB_DEPENDENCY,
        address(0x1001)
      )
    );
    deployment.validateTokenMetadata(address(0x1001), "BTCB", "BTCB", 18);
  }

  function testRejectsWrongTokenSymbol() public {
    StagingTokenMock token = new StagingTokenMock("NOT_BTCB", 18);

    vm.expectRevert(
      abi.encodeWithSelector(
        DeployMainnetStaging.StagingTokenSymbolMismatch.selector, BTCB_DEPENDENCY
      )
    );
    deployment.validateTokenMetadata(address(token), "BTCB", "BTCB", 18);
  }

  function testRejectsWrongTokenDecimals() public {
    StagingTokenMock token = new StagingTokenMock("BTCB", 8);

    vm.expectRevert(
      abi.encodeWithSelector(
        DeployMainnetStaging.StagingTokenDecimalsMismatch.selector,
        BTCB_DEPENDENCY,
        uint8(18),
        uint8(8)
      )
    );
    deployment.validateTokenMetadata(address(token), "BTCB", "BTCB", 18);
  }

  function testAcceptsAvailablePythBtcPrice() public {
    StagingPythMock pyth = new StagingPythMock(6_500_000_000_000, 1);

    deployment.validatePythBtcPrice(address(pyth));
  }

  function testRejectsUnavailablePythBtcPrice() public {
    StagingPythMock pyth = new StagingPythMock(0, 0);

    vm.expectRevert(DeployMainnetStaging.StagingPythPriceUnavailable.selector);
    deployment.validatePythBtcPrice(address(pyth));
  }

  function testPinsUpgradedPythContract() public {
    assertEq(deployment.stagingPythAddress(), 0xdF21D137Aadc95588205586636710ca2890538d5);
  }

  function testAcceptsValidChainlinkBtcFeed() public {
    StagingChainlinkMock chainlink =
      new StagingChainlinkMock("BTC / USD", 8, 10, 6_500_000_000_000, 1, 10);

    deployment.validateChainlinkBtcFeed(address(chainlink));
  }

  function testRejectsWrongChainlinkDescription() public {
    StagingChainlinkMock chainlink =
      new StagingChainlinkMock("ETH / USD", 8, 10, 6_500_000_000_000, 1, 10);

    vm.expectRevert(DeployMainnetStaging.StagingChainlinkDescriptionMismatch.selector);
    deployment.validateChainlinkBtcFeed(address(chainlink));
  }

  function testRejectsWrongChainlinkDecimals() public {
    StagingChainlinkMock chainlink =
      new StagingChainlinkMock("BTC / USD", 18, 10, 6_500_000_000_000, 1, 10);

    vm.expectRevert(
      abi.encodeWithSelector(
        DeployMainnetStaging.StagingChainlinkDecimalsMismatch.selector, uint8(8), uint8(18)
      )
    );
    deployment.validateChainlinkBtcFeed(address(chainlink));
  }

  function testRejectsInvalidChainlinkRound() public {
    StagingChainlinkMock chainlink =
      new StagingChainlinkMock("BTC / USD", 8, 10, 6_500_000_000_000, 1, 9);

    vm.expectRevert(DeployMainnetStaging.StagingChainlinkRoundInvalid.selector);
    deployment.validateChainlinkBtcFeed(address(chainlink));
  }

  function testUsesStagingDeploymentRecord() public {
    assertEq(
      deployment.deploymentOutputPath(),
      string.concat(vm.projectRoot(), "/deployments/staging/56.json")
    );
  }

  function testReadsChainlinkNvdaProviderFromMainnetManifest() public {
    vm.chainId(56);
    vm.setEnv(
      "NVDA_PYTH_PRICE_ID",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    MarketDeployerBase.MarketConfig memory config = deployment.getMarketConfigById("NVDA");

    assertEq(uint(config.oracleProvider), uint(MarketDeployerBase.OracleProvider.Chainlink));
    assertEq(config.chainlinkAggregator, 0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8);
    assertEq(config.pythPriceId, bytes32(0));
    assertFalse(config.benchmarkSettlement);
  }

  function testUsesContainedStagingRiskConfiguration() public {
    (uint256 optionCap, uint256 btcbCap, bool borrowingEnabled) =
      deployment.stagingRiskConfiguration();

    assertEq(optionCap, 0.05e18);
    assertEq(btcbCap, 0.05e18);
    assertFalse(borrowingEnabled);
  }
}
