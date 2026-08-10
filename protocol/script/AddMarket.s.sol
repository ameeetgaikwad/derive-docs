// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/console2.sol";

import {SubAccounts} from "v2-core/src/SubAccounts.sol";
import {StandardManager} from "v2-core/src/risk-managers/StandardManager.sol";
import {SRMPortfolioViewer} from "v2-core/src/risk-managers/SRMPortfolioViewer.sol";

import {MarketDeployerBase} from "./MarketDeployerBase.sol";

/**
 * @title AddMarket
 * @notice Deploys and registers ONE new market (signed feeds + option/base assets) against
 *         an EXISTING deployment: reads core addresses from deployments/<chainId>.json
 *         (written by DeployAll) and registers the market on the live StandardManager.
 *         Token/oracle boundary parameters are validated against
 *         deployments/markets/<chainId>.json before anything is broadcast.
 *
 *         Does NOT touch existing markets, the matching stack, or the cash asset.
 *         New addresses are written to deployments/<chainId>-<name>.json (sidecar file,
 *         so the main deployments JSON is never rewritten/reordered by this script).
 *
 * Usage (anvil — run DeployAll first):
 *   MARKET_ID=NVDA forge script script/AddMarket.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 * Usage (BSC testnet):
 *   MARKET_ID=NVDA NVDAB_ADDRESS=0x... forge script script/AddMarket.s.sol \
 *     --rpc-url $RPC_URL_97_THIRDWEB --broadcast --legacy --with-gas-price 200000000 \
 *     --retries 12 --delay 5
 * Env:
 *   MARKET_ID        BTC, XAU, SPY, NVDA, or SPCX (preferred)
 *   MARKET_INDEX     legacy config entry: 0 BTC, 1 ETH, 2 XAU, 3 SPY, 4 NVDA, 5 SPCX
 *   PRIVATE_KEY      deployer key — must own the SRM/viewer (default: anvil key 0)
 *   FEED_SIGNER      signer registered on the new feeds (default: feedSigner from deployments JSON)
 *   <UNDERLYING>_ADDRESS  real token address for the market (off-anvil only)
 *   <MARKET>_PYTH_PRICE_ID required for RWA markets until pinned in the manifest
 */
contract AddMarket is MarketDeployerBase {
  function run() external {
    uint deployerKey = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
    address deployer = vm.addr(deployerKey);
    string memory marketId = vm.envOr("MARKET_ID", string(""));
    MarketConfig memory cfg = bytes(marketId).length > 0
      ? getMarketConfigById(marketId)
      : getManifestMarketConfig(vm.envUint("MARKET_INDEX"));

    // ---- existing deployment ----
    string memory deploymentsPath =
      string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    string memory json = vm.readFile(deploymentsPath);
    SubAccounts subAccounts = SubAccounts(vm.parseJsonAddress(json, ".subAccounts"));
    StandardManager srm = StandardManager(vm.parseJsonAddress(json, ".standardManager"));
    SRMPortfolioViewer srmViewer = SRMPortfolioViewer(vm.parseJsonAddress(json, ".srmViewer"));
    feedSigner = vm.envOr("FEED_SIGNER", vm.parseJsonAddress(json, ".feedSigner"));

    require(srm.owner() == deployer, "AddMarket: deployer does not own the SRM");

    console2.log("chainId:    ", block.chainid);
    console2.log("deployer:   ", deployer);
    console2.log("feedSigner: ", feedSigner);
    console2.log("market:     ", cfg.name);
    console2.log("srm:        ", address(srm));

    vm.startBroadcast(deployerKey);
    address underlying = _resolveUnderlying(cfg);
    MarketDeployment memory m = _deployAndRegisterMarket(subAccounts, srm, srmViewer, underlying, cfg);
    vm.stopBroadcast();

    console2.log("marketId:   ", m.marketId);
    console2.log("underlying: ", underlying);

    _writeMarketJson(cfg, underlying, m);
  }

  function _writeMarketJson(MarketConfig memory cfg, address underlying, MarketDeployment memory m) internal {
    string memory k = "market";
    vm.serializeUint(k, "chainId", block.chainid);
    vm.serializeString(k, "name", cfg.name);
    vm.serializeUint(k, "marketId", m.marketId);
    vm.serializeAddress(k, "underlying", underlying);
    vm.serializeAddress(k, "spotFeed", address(m.spotFeed));
    vm.serializeAddress(k, "forwardFeed", address(m.forwardFeed));
    vm.serializeAddress(k, "volFeed", address(m.volFeed));
    vm.serializeAddress(k, "rateFeed", address(m.rateFeed));
    vm.serializeAddress(k, "settlementFeed", address(m.settlementFeed));
    vm.serializeAddress(k, "liveSettlementFeed", m.liveSettlementFeed);
    vm.serializeAddress(k, "pythSpotFeed", address(m.pythSpotFeed));
    vm.serializeAddress(k, "scaledSpotFeed", address(m.scaledSpotFeed));
    vm.serializeAddress(k, "multiplierRegistry", address(m.multiplierRegistry));
    vm.serializeAddress(k, "benchmarkSettlementFeed", address(m.benchmarkSettlementFeed));
    vm.serializeAddress(k, "liveSpotFeed", m.liveSpotFeed);
    vm.serializeAddress(k, "optionAsset", address(m.option));
    vm.serializeBytes32(k, "pythPriceId", cfg.pythPriceId);
    vm.serializeAddress(k, "chainlinkAggregator", cfg.chainlinkAggregator);
    vm.serializeUint(k, "underlyingDecimals", cfg.underlyingDecimals);
    vm.serializeBool(k, "scaledUi", cfg.scaledUi);
    string memory out = vm.serializeAddress(k, "baseAsset", address(m.base));

    string memory path = string.concat(
      vm.projectRoot(), "/deployments/", vm.toString(block.chainid), "-", cfg.name, ".json"
    );
    vm.writeFile(path, out);
    console2.log("Market addresses written to:", path);
  }
}
