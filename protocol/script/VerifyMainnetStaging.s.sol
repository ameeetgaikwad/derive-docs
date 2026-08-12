// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {Ownable} from "openzeppelin/access/Ownable.sol";
import {IManager} from "v2-core/src/interfaces/IManager.sol";
import {ISpotFeed} from "v2-core/src/interfaces/ISpotFeed.sol";
import {IForwardFeed} from "v2-core/src/interfaces/IForwardFeed.sol";
import {IVolFeed} from "v2-core/src/interfaces/IVolFeed.sol";
import {OptionAsset} from "v2-core/src/assets/OptionAsset.sol";
import {WrappedERC20Asset} from "v2-core/src/assets/WrappedERC20Asset.sol";
import {StandardManager} from "v2-core/src/risk-managers/StandardManager.sol";
import {SRMPortfolioViewer} from "v2-core/src/risk-managers/SRMPortfolioViewer.sol";
import {BaseLyraFeed} from "v2-core/src/feeds/BaseLyraFeed.sol";
import {Matching} from "v2-matching/src/Matching.sol";

import {PythSpotFeed} from "../src/PythSpotFeed.sol";
import {AnchoredSettlementFeed} from "../src/AnchoredSettlementFeed.sol";

/**
 * @title VerifyMainnetStaging
 * @notice Read-only verification for the isolated BSC mainnet staging deployment.
 *         This script never broadcasts and never repairs state; any mismatch reverts.
 *
 * Usage:
 *   forge script script/VerifyMainnetStaging.s.sol --rpc-url $RPC_URL_56
 *
 * Optional:
 *   STAGING_DEPLOYMENT_PATH=/absolute/path/to/56.json
 */
contract VerifyMainnetStaging is Script {
  uint256 internal constant BSC_MAINNET_CHAIN_ID = 56;
  uint256 internal constant STAGING_OPTION_POSITION_CAP = 0.05e18;
  uint256 internal constant STAGING_BTCB_POSITION_CAP = 0.05e18;
  uint256 internal constant EXPECTED_OI_FEE_RATE = 0.001e18;
  uint256 internal constant EXPECTED_MIN_OI_FEE = 0.01e18;
  address internal constant STAGING_PYTH = 0xdF21D137Aadc95588205586636710ca2890538d5;
  address internal constant STAGING_CHAINLINK_BTC_USD =
    0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf;
  bytes32 internal constant STAGING_PYTH_BTC_USD_ID =
    0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;

  function run() external {
    require(block.chainid == BSC_MAINNET_CHAIN_ID, "staging verifier requires chain 56");
    string memory defaultPath =
      string.concat(vm.projectRoot(), "/deployments/staging/56.json");
    string memory path = vm.envOr("STAGING_DEPLOYMENT_PATH", defaultPath);
    string memory json = vm.readFile(path);
    require(vm.parseJsonUint(json, ".chainId") == BSC_MAINNET_CHAIN_ID, "deployment chain mismatch");

    _verifyCodeAndOwnership(json);
    _verifyRiskAndFees(json);
    _verifyOperationalAccess(json);
    _verifyOracleWiring(json);

    console2.log("MAINNET STAGING VERIFICATION PASSED");
    console2.log("deployment:", path);
  }

  function _verifyCodeAndOwnership(string memory json) internal {
    address expectedOwner = _address(json, "deployer");
    string[20] memory keys = [
      "cashAsset",
      "securityModule",
      "dutchAuction",
      "standardManager",
      "srmViewer",
      "stableFeed",
      "btcSpotFeed",
      "btcForwardFeed",
      "btcVolFeed",
      "btcRateFeed",
      "btcOptionAsset",
      "btcBaseAsset",
      "btcPythSpotFeed",
      "btcSettlementFeed",
      "matching",
      "depositModule",
      "withdrawalModule",
      "transferModule",
      "tradeModule",
      "rfqModule"
    ];
    for (uint256 i = 0; i < keys.length; i++) {
      address target = _address(json, keys[i]);
      require(target.code.length > 0, string.concat(keys[i], " has no code"));
      require(Ownable(target).owner() == expectedOwner, string.concat(keys[i], " owner mismatch"));
    }
  }

  function _verifyRiskAndFees(string memory json) internal {
    StandardManager manager = StandardManager(_address(json, "standardManager"));
    OptionAsset option = OptionAsset(_address(json, "btcOptionAsset"));
    WrappedERC20Asset base = WrappedERC20Asset(_address(json, "btcBaseAsset"));
    SRMPortfolioViewer viewer = SRMPortfolioViewer(_address(json, "srmViewer"));

    require(!manager.borrowingEnabled(), "borrowing must be disabled");
    require(
      option.totalPositionCap(IManager(address(manager))) == STAGING_OPTION_POSITION_CAP,
      "option position cap mismatch"
    );
    require(
      base.totalPositionCap(IManager(address(manager))) == STAGING_BTCB_POSITION_CAP,
      "BTCB position cap mismatch"
    );
    require(viewer.OIFeeRateBPS(address(option)) == EXPECTED_OI_FEE_RATE, "option OI fee mismatch");
    require(viewer.OIFeeRateBPS(address(base)) == EXPECTED_OI_FEE_RATE, "base OI fee mismatch");
    require(manager.minOIFee() == EXPECTED_MIN_OI_FEE, "minimum OI fee mismatch");
  }

  function _verifyOperationalAccess(string memory json) internal {
    address signer = _address(json, "feedSigner");
    _requireSigner(json, "stableFeed", signer);
    _requireSigner(json, "btcSpotFeed", signer);
    _requireSigner(json, "btcForwardFeed", signer);
    _requireSigner(json, "btcVolFeed", signer);
    _requireSigner(json, "btcRateFeed", signer);

    address executor = _address(json, "tradeExecutor");
    require(Matching(_address(json, "matching")).tradeExecutors(executor), "executor not registered");
  }

  function _verifyOracleWiring(string memory json) internal {
    StandardManager manager = StandardManager(_address(json, "standardManager"));
    uint256 marketId = vm.parseJsonUint(json, ".btcMarketId");
    (ISpotFeed spot, IForwardFeed forward, IVolFeed vol) = manager.getMarketFeeds(marketId);
    require(address(spot) == _address(json, "btcPythSpotFeed"), "SRM spot feed mismatch");
    require(address(forward) == _address(json, "btcForwardFeed"), "SRM forward feed mismatch");
    require(address(vol) == _address(json, "btcVolFeed"), "SRM vol feed mismatch");

    PythSpotFeed spotAdapter = PythSpotFeed(_address(json, "btcPythSpotFeed"));
    require(address(spotAdapter.pyth()) == STAGING_PYTH, "spot Pyth contract mismatch");
    require(spotAdapter.priceId() == STAGING_PYTH_BTC_USD_ID, "spot Pyth price id mismatch");
    require(
      address(spotAdapter.chainlinkAggregator()) == STAGING_CHAINLINK_BTC_USD,
      "spot Chainlink aggregator mismatch"
    );

    address settlementAddress = _address(json, "btcSettlementFeed");
    require(
      address(OptionAsset(_address(json, "btcOptionAsset")).settlementFeed()) == settlementAddress,
      "option settlement feed mismatch"
    );
    AnchoredSettlementFeed settlement = AnchoredSettlementFeed(settlementAddress);
    require(address(settlement.pyth()) == STAGING_PYTH, "settlement Pyth contract mismatch");
    require(settlement.priceId() == STAGING_PYTH_BTC_USD_ID, "settlement Pyth price id mismatch");
    require(
      address(settlement.aggregator()) == STAGING_CHAINLINK_BTC_USD,
      "settlement Chainlink aggregator mismatch"
    );
  }

  function _requireSigner(string memory json, string memory key, address signer) internal {
    require(BaseLyraFeed(_address(json, key)).isSigner(signer), string.concat(key, " signer mismatch"));
  }

  function _address(string memory json, string memory key) internal returns (address value) {
    value = vm.parseJsonAddress(json, string.concat(".", key));
    require(value != address(0), string.concat(key, " is zero"));
  }
}
