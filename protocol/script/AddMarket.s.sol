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
 *         Per-market parameters come from MarketDeployerBase.getMarketConfig.
 *
 *         Does NOT touch existing markets, the matching stack, or the cash asset.
 *         New addresses are written to deployments/<chainId>-<name>.json (sidecar file,
 *         so the main deployments JSON is never rewritten/reordered by this script).
 *
 * Usage (anvil — run DeployAll first):
 *   MARKET_INDEX=1 forge script script/AddMarket.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 * Usage (BSC testnet):
 *   MARKET_INDEX=1 WETH_ADDRESS=0x... forge script script/AddMarket.s.sol \
 *     --rpc-url $RPC_URL_97_THIRDWEB --broadcast --legacy --with-gas-price 200000000 \
 *     --retries 12 --delay 5
 * Env:
 *   MARKET_INDEX     config entry to deploy (see MarketDeployerBase.getMarketConfig; 0 = BTC, 1 = ETH)
 *   PRIVATE_KEY      deployer key — must own the SRM/viewer (default: anvil key 0)
 *   FEED_SIGNER      signer registered on the new feeds (default: feedSigner from deployments JSON)
 *   <UNDERLYING>_ADDRESS  real 18-dec token address for the market (off-anvil only, e.g. WETH_ADDRESS)
 */
contract AddMarket is MarketDeployerBase {
  function run() external {
    uint deployerKey = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
    address deployer = vm.addr(deployerKey);
    uint marketIndex = vm.envUint("MARKET_INDEX");
    MarketConfig memory cfg = getMarketConfig(marketIndex);

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
    vm.serializeAddress(k, "pythSpotFeed", address(m.pythSpotFeed));
    vm.serializeAddress(k, "optionAsset", address(m.option));
    vm.serializeBytes32(k, "pythPriceId", cfg.pythPriceId);
    vm.serializeAddress(k, "chainlinkAggregator", cfg.chainlinkAggregator);
    string memory out = vm.serializeAddress(k, "baseAsset", address(m.base));

    string memory path = string.concat(
      vm.projectRoot(), "/deployments/", vm.toString(block.chainid), "-", cfg.name, ".json"
    );
    vm.writeFile(path, out);
    console2.log("Market addresses written to:", path);
  }
}
