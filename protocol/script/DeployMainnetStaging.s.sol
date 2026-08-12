// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {DeployAll} from "./DeployAll.s.sol";
import {IERC20Metadata} from "openzeppelin/token/ERC20/extensions/IERC20Metadata.sol";

import {IPyth} from "../src/interfaces/IPyth.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

interface IAggregatorV3Metadata is IAggregatorV3 {
  function description() external view returns (string memory);
}

/**
 * @title DeployMainnetStaging
 * @notice Dedicated entrypoint for an isolated Hedge staging deployment on BSC mainnet.
 *
 *         This deployment is for capped public staging against real chain-56
 *         tokens, oracles, and execution behavior. It is not a production
 *         deployment and must remain clearly identified as staging.
 *
 *         The entrypoint refuses every chain except BSC mainnet, requires an exact
 *         operator acknowledgement, and writes a staging deployment record so the
 *         existing chain-56 address record cannot be overwritten by a simulation or
 *         broadcast.
 *
 * Usage (simulation only until the remaining staging checks are complete):
 *   PRIVATE_KEY=<staging-deployer-key> \
 *   FEED_SIGNER=<staging-feed-signer-address> \
 *   TRADE_EXECUTOR=<staging-trade-executor-address> \
 *   MAINNET_STAGING_CONFIRM=DEPLOY_HEDGE_MAINNET_STAGING_CHAIN_56 \
 *     forge script script/DeployMainnetStaging.s.sol --rpc-url $RPC_URL_56
 */
contract DeployMainnetStaging is DeployAll {
  uint256 internal constant BSC_MAINNET_CHAIN_ID = 56;
  string internal constant REQUIRED_CONFIRMATION = "DEPLOY_HEDGE_MAINNET_STAGING_CHAIN_56";

  address internal constant STAGING_BTCB = 0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c;
  address internal constant STAGING_USDT = 0x55d398326f99059fF775485246999027B3197955;
  address internal constant STAGING_PYTH = 0xdF21D137Aadc95588205586636710ca2890538d5;
  address internal constant STAGING_CHAINLINK_BTC_USD =
    0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf;
  bytes32 internal constant STAGING_PYTH_BTC_USD_ID =
    0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
  uint256 internal constant STAGING_OPTION_POSITION_CAP = 0.05e18;
  uint256 internal constant STAGING_BTCB_POSITION_CAP = 0.05e18;

  bytes32 internal constant DEPENDENCY_BTCB = "BTCB";
  bytes32 internal constant DEPENDENCY_USDT = "USDT";
  bytes32 internal constant DEPENDENCY_PYTH = "PYTH";
  bytes32 internal constant DEPENDENCY_CHAINLINK_BTC_USD = "CHAINLINK_BTC_USD";

  error WrongChain(uint256 expected, uint256 actual);
  error InvalidMainnetStagingConfirmation();
  error InvalidStagingDeployerKey();
  error InvalidStagingFeedSigner();
  error InvalidStagingTradeExecutor();
  error StagingOperationalRolesMustBeDistinct();
  error StagingDependencyAddressMismatch(bytes32 dependency, address expected, address actual);
  error StagingDependencyHasNoCode(bytes32 dependency, address target);
  error StagingTokenSymbolMismatch(bytes32 dependency);
  error StagingTokenDecimalsMismatch(bytes32 dependency, uint8 expected, uint8 actual);
  error StagingPythPriceIdMismatch(bytes32 expected, bytes32 actual);
  error StagingPythPriceUnavailable();
  error StagingChainlinkDescriptionMismatch();
  error StagingChainlinkDecimalsMismatch(uint8 expected, uint8 actual);
  error StagingChainlinkRoundInvalid();

  function run() public override {
    if (block.chainid != BSC_MAINNET_CHAIN_ID) {
      revert WrongChain(BSC_MAINNET_CHAIN_ID, block.chainid);
    }

    string memory confirmation = vm.envOr("MAINNET_STAGING_CONFIRM", string(""));
    if (keccak256(bytes(confirmation)) != keccak256(bytes(REQUIRED_CONFIRMATION))) {
      revert InvalidMainnetStagingConfirmation();
    }

    _validateStagingOperationalRoles(
      vm.envOr("PRIVATE_KEY", uint256(0)),
      vm.envOr("FEED_SIGNER", address(0)),
      vm.envOr("TRADE_EXECUTOR", address(0))
    );
    _validateStagingDependencies();
    super.run();
  }

  function _validateStagingOperationalRoles(
    uint256 deployerKey,
    address stagingFeedSigner,
    address stagingTradeExecutor
  ) internal pure {
    if (deployerKey == 0) revert InvalidStagingDeployerKey();

    address stagingDeployer = vm.addr(deployerKey);
    if (stagingFeedSigner == address(0)) revert InvalidStagingFeedSigner();
    if (stagingTradeExecutor == address(0)) revert InvalidStagingTradeExecutor();
    if (
      stagingDeployer == stagingFeedSigner || stagingDeployer == stagingTradeExecutor
        || stagingFeedSigner == stagingTradeExecutor
    ) {
      revert StagingOperationalRolesMustBeDistinct();
    }
  }

  function stagingRiskConfiguration()
    public
    pure
    returns (uint256 optionPositionCap, uint256 btcbPositionCap, bool borrowingEnabled)
  {
    return (STAGING_OPTION_POSITION_CAP, STAGING_BTCB_POSITION_CAP, false);
  }

  function _deployCore() internal override {
    super._deployCore();
    srm.setBorrowingEnabled(false);
  }

  function _deployBtcMarket(MarketConfig memory cfg) internal override {
    cfg.optionCap = STAGING_OPTION_POSITION_CAP;
    cfg.baseCap = STAGING_BTCB_POSITION_CAP;
    super._deployBtcMarket(cfg);
  }

  function _validateStagingDependencies() internal {
    address configuredBtcb = vm.envOr("BTCB_ADDRESS", STAGING_BTCB);
    address configuredUsdt = vm.envOr("USDT_ADDRESS", STAGING_USDT);
    address configuredPyth = vm.envOr("PYTH_ADDRESS", STAGING_PYTH);
    MarketConfig memory btcConfig = getManifestMarketConfig(0);

    _requireExpectedAddress(DEPENDENCY_BTCB, STAGING_BTCB, configuredBtcb);
    _requireExpectedAddress(DEPENDENCY_BTCB, STAGING_BTCB, btcConfig.underlyingDefault);
    _requireExpectedAddress(DEPENDENCY_USDT, STAGING_USDT, configuredUsdt);
    _requireExpectedAddress(DEPENDENCY_PYTH, STAGING_PYTH, configuredPyth);
    _requireExpectedAddress(
      DEPENDENCY_CHAINLINK_BTC_USD,
      STAGING_CHAINLINK_BTC_USD,
      btcConfig.chainlinkAggregator
    );
    if (btcConfig.pythPriceId != STAGING_PYTH_BTC_USD_ID) {
      revert StagingPythPriceIdMismatch(STAGING_PYTH_BTC_USD_ID, btcConfig.pythPriceId);
    }

    _validateTokenMetadata(configuredBtcb, DEPENDENCY_BTCB, "BTCB", 18);
    _validateTokenMetadata(configuredUsdt, DEPENDENCY_USDT, "USDT", 18);
    _validatePythBtcPrice(configuredPyth);
    _validateChainlinkBtcFeed(btcConfig.chainlinkAggregator);
  }

  function _requireExpectedAddress(
    bytes32 dependency,
    address expected,
    address actual
  ) internal pure {
    if (actual != expected) revert StagingDependencyAddressMismatch(dependency, expected, actual);
  }

  function _requireContract(bytes32 dependency, address target) internal view {
    if (target.code.length == 0) revert StagingDependencyHasNoCode(dependency, target);
  }

  function _validateTokenMetadata(
    address token,
    bytes32 dependency,
    string memory expectedSymbol,
    uint8 expectedDecimals
  ) internal view {
    _requireContract(dependency, token);
    if (keccak256(bytes(IERC20Metadata(token).symbol())) != keccak256(bytes(expectedSymbol))) {
      revert StagingTokenSymbolMismatch(dependency);
    }
    uint8 actualDecimals = IERC20Metadata(token).decimals();
    if (actualDecimals != expectedDecimals) {
      revert StagingTokenDecimalsMismatch(dependency, expectedDecimals, actualDecimals);
    }
  }

  function _validatePythBtcPrice(address pythAddress) internal view {
    _requireContract(DEPENDENCY_PYTH, pythAddress);
    try IPyth(pythAddress).getPriceUnsafe(STAGING_PYTH_BTC_USD_ID) returns (
      IPyth.Price memory price
    ) {
      if (price.price <= 0 || price.publishTime == 0) revert StagingPythPriceUnavailable();
    } catch {
      revert StagingPythPriceUnavailable();
    }
  }

  function _validateChainlinkBtcFeed(address aggregator) internal view {
    _requireContract(DEPENDENCY_CHAINLINK_BTC_USD, aggregator);
    IAggregatorV3Metadata feed = IAggregatorV3Metadata(aggregator);
    if (keccak256(bytes(feed.description())) != keccak256(bytes("BTC / USD"))) {
      revert StagingChainlinkDescriptionMismatch();
    }
    uint8 actualDecimals = feed.decimals();
    if (actualDecimals != 8) revert StagingChainlinkDecimalsMismatch(8, actualDecimals);
    (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
      feed.latestRoundData();
    if (roundId == 0 || answer <= 0 || updatedAt == 0 || answeredInRound < roundId) {
      revert StagingChainlinkRoundInvalid();
    }
  }

  function _pythAddress() internal pure override returns (address) {
    return STAGING_PYTH;
  }

  function _deploymentOutputPath() internal view override returns (string memory) {
    return string.concat(vm.projectRoot(), "/deployments/staging/56.json");
  }
}
