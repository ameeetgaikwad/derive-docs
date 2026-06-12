// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

// ---- v2-core ----
import {SubAccounts} from "v2-core/src/SubAccounts.sol";
import {OptionAsset} from "v2-core/src/assets/OptionAsset.sol";
import {WrappedERC20Asset} from "v2-core/src/assets/WrappedERC20Asset.sol";
import {StandardManager} from "v2-core/src/risk-managers/StandardManager.sol";
import {SRMPortfolioViewer} from "v2-core/src/risk-managers/SRMPortfolioViewer.sol";
import {LyraSpotFeed} from "v2-core/src/feeds/LyraSpotFeed.sol";
import {LyraForwardFeed} from "v2-core/src/feeds/LyraForwardFeed.sol";
import {LyraVolFeed} from "v2-core/src/feeds/LyraVolFeed.sol";
import {LyraRateFeed} from "v2-core/src/feeds/LyraRateFeed.sol";
import {BaseLyraFeed} from "v2-core/src/feeds/BaseLyraFeed.sol";
import {IManager} from "v2-core/src/interfaces/IManager.sol";
import {IStandardManager} from "v2-core/src/interfaces/IStandardManager.sol";

import {IERC20Metadata} from "openzeppelin/token/ERC20/extensions/IERC20Metadata.sol";

import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title MarketDeployerBase
 * @notice Shared per-market configuration + deploy/register logic for the hedge SRM.
 *         Used by DeployAll (full-stack deploy, BTC = config entry 0) and AddMarket
 *         (adds one market to an EXISTING deployment).
 *
 *         Per-market parameters live in `getMarketConfig` — token, name, Pyth feed id,
 *         Chainlink aggregator (BSC-testnet circuit breaker), caps and margin params.
 *         Margin/contingency params follow lib/v2-core/scripts/config-mainnet.sol.
 */
abstract contract MarketDeployerBase is Script {
  // anvil well-known account #0 — dev default only
  uint internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

  // Config feed heartbeats (lib/v2-core/scripts/config-mainnet.sol)
  uint64 internal constant SPOT_HEARTBEAT = 3 minutes;
  uint64 internal constant VOL_HEARTBEAT = 20 minutes;
  uint64 internal constant FORWARD_HEARTBEAT = 60 minutes;
  uint64 internal constant SETTLEMENT_HEARTBEAT = 3 minutes;
  uint64 internal constant STABLE_HEARTBEAT = 60 minutes;
  uint64 internal constant RATE_HEARTBEAT = 60 minutes; // signed rate feed (not in Config; matches stable)
  uint64 internal constant FWD_MAX_EXPIRY = 400 days;

  // fees — OIFeeRateBPS is (despite the name) a plain 18-decimal multiplier applied to
  // abs(delta) * forwardPrice (see BasePortfolioViewer.getAssetOIFee). The vendored
  // deploy-srm-option-only-market.s.sol value of 0.1e18 means 10% of notional per side —
  // clearly a test value. 0.001e18 = 0.1% of forward notional per side.
  uint internal constant OI_FEE_BPS = 0.001e18;
  uint internal constant MIN_OI_FEE = 10e18;

  /// @dev 1-of-1 feed signer; set by the inheriting script before deploying a market
  address internal feedSigner;

  // ---------------------------------------------------------------------------
  // Per-market config
  // ---------------------------------------------------------------------------

  struct MarketConfig {
    /// SRM market name, e.g. "BTC"
    string name;
    /// underlying token symbol, e.g. "BTCB" — used for the anvil mock
    string underlyingSymbol;
    /// env var holding the real (18-decimal) token address off-anvil, e.g. "BTCB_ADDRESS"
    string underlyingEnvKey;
    /// Pyth price feed id (Hermes / on-chain Pyth), for PythSpotFeed deployments
    bytes32 pythPriceId;
    /// Chainlink aggregator on BSC testnet used as PythSpotFeed circuit breaker
    address chainlinkAggregator;
    /// OptionAsset total position cap (18dp contracts)
    uint optionCap;
    /// WrappedERC20Asset total position cap (18dp tokens)
    uint baseCap;
    IStandardManager.OptionMarginParams optionMarginParams;
    IStandardManager.OracleContingencyParams ocParams;
    /// StandardManager.setBaseAssetMarginFactor(marketId, marginFactor, IMScale)
    uint baseMarginFactor;
    uint baseIMScale;
  }

  function marketConfigCount() public pure returns (uint) {
    return 2;
  }

  /// @notice entry 0 = BTC (the live testnet market), entry 1 = ETH (example second market)
  function getMarketConfig(uint index) public pure returns (MarketConfig memory) {
    // shared across markets per config-mainnet.sol getSRMParams()
    IStandardManager.OptionMarginParams memory optionMarginParams = IStandardManager.OptionMarginParams({
      maxSpotReq: 0.15e18,
      minSpotReq: 0.13e18,
      mmCallSpotReq: 0.09e18,
      mmPutSpotReq: 0.09e18,
      MMPutMtMReq: 0.09e18,
      unpairedIMScale: 1.2e18,
      unpairedMMScale: 1.1e18,
      mmOffsetScale: 1.05e18
    });
    IStandardManager.OracleContingencyParams memory ocParams = IStandardManager.OracleContingencyParams({
      perpThreshold: 0.55e18,
      optionThreshold: 0.55e18,
      baseThreshold: 0.55e18,
      OCFactor: 1e18
    });

    if (index == 0) {
      return MarketConfig({
        name: "BTC",
        underlyingSymbol: "BTCB",
        underlyingEnvKey: "BTCB_ADDRESS",
        // Crypto.BTC/USD (hermes.pyth.network)
        pythPriceId: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43,
        // Chainlink BTC/USD, BSC testnet
        chainlinkAggregator: 0x5741306c21795FdCBb9b265Ea0255F499DFe515C,
        optionCap: 100_000e18, // Config.getSRMCaps("BTC")
        baseCap: 5e18,
        optionMarginParams: optionMarginParams,
        ocParams: ocParams,
        baseMarginFactor: 0.75e18, // Config.getSRMBaseMarginParams("BTC")
        baseIMScale: 0.93e18
      });
    }
    if (index == 1) {
      return MarketConfig({
        name: "ETH",
        underlyingSymbol: "WETH",
        underlyingEnvKey: "WETH_ADDRESS",
        // Crypto.ETH/USD (hermes.pyth.network)
        pythPriceId: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace,
        // Chainlink ETH/USD, BSC testnet (verified: description() == "ETH / USD")
        chainlinkAggregator: 0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7,
        optionCap: 2_000_000e18, // Config.getSRMCaps("ETH")
        baseCap: 250e18,
        optionMarginParams: optionMarginParams,
        ocParams: ocParams,
        baseMarginFactor: 0.8e18, // Config.getSRMBaseMarginParams("ETH")
        baseIMScale: 0.9375e18
      });
    }
    revert("MarketDeployerBase: unknown market config index");
  }

  // ---------------------------------------------------------------------------
  // Deploy + register (mirrors lib/v2-core/scripts/deploy-srm-option-only-market.s.sol)
  // ---------------------------------------------------------------------------

  struct MarketDeployment {
    LyraSpotFeed spotFeed;
    LyraForwardFeed forwardFeed;
    LyraVolFeed volFeed;
    LyraRateFeed rateFeed;
    OptionAsset option;
    WrappedERC20Asset base;
    uint marketId;
  }

  /// @dev resolve the market's underlying 18-decimal token: a fresh open-mint mock on
  ///      anvil, otherwise `cfg.underlyingEnvKey` from env. Must run inside broadcast.
  function _resolveUnderlying(MarketConfig memory cfg) internal returns (address token) {
    if (block.chainid == 31337) {
      MockERC20 mock =
        new MockERC20(string.concat("Mock ", cfg.underlyingSymbol), cfg.underlyingSymbol, 18);
      return address(mock);
    }
    token = vm.envAddress(cfg.underlyingEnvKey);
    require(IERC20Metadata(token).decimals() == 18, "underlying must be 18 decimals");
  }

  /// @dev deploys the market's signed feeds + option/base assets and registers it on the
  ///      SRM with the config's caps/margin params + OI fee. Must run inside broadcast;
  ///      the broadcaster must own the SRM/viewer.
  function _deployAndRegisterMarket(
    SubAccounts subAccounts,
    StandardManager srm,
    SRMPortfolioViewer srmViewer,
    address underlying,
    MarketConfig memory cfg
  ) internal returns (MarketDeployment memory m) {
    // ---- market contracts (mirrors _deployMarketContracts) ----
    m.spotFeed = new LyraSpotFeed();
    m.forwardFeed = new LyraForwardFeed(m.spotFeed);
    m.volFeed = new LyraVolFeed();
    m.rateFeed = new LyraRateFeed();

    _configureFeed(BaseLyraFeed(address(m.spotFeed)), SPOT_HEARTBEAT);
    _configureFeed(BaseLyraFeed(address(m.volFeed)), VOL_HEARTBEAT);
    _configureFeed(BaseLyraFeed(address(m.rateFeed)), RATE_HEARTBEAT);
    _configureFeed(BaseLyraFeed(address(m.forwardFeed)), FORWARD_HEARTBEAT);
    m.forwardFeed.setSettlementHeartbeat(SETTLEMENT_HEARTBEAT);
    m.forwardFeed.setMaxExpiry(FWD_MAX_EXPIRY);

    // option settles against the forward feed (ISettlementFeed)
    m.option = new OptionAsset(subAccounts, address(m.forwardFeed));
    m.base = new WrappedERC20Asset(subAccounts, IERC20Metadata(underlying));

    // ---- registration (mirrors _setPermissionAndCaps + _registerMarketToSRM) ----
    m.option.setWhitelistManager(address(srm), true);
    m.base.setWhitelistManager(address(srm), true);
    m.option.setTotalPositionCap(IManager(address(srm)), cfg.optionCap);
    m.base.setTotalPositionCap(IManager(address(srm)), cfg.baseCap);

    m.marketId = srm.createMarket(cfg.name);

    srm.whitelistAsset(m.option, m.marketId, IStandardManager.AssetType.Option);
    srm.whitelistAsset(m.base, m.marketId, IStandardManager.AssetType.Base);

    srm.setOraclesForMarket(m.marketId, m.spotFeed, m.forwardFeed, m.volFeed);

    srm.setOptionMarginParams(m.marketId, cfg.optionMarginParams);
    srm.setOracleContingencyParams(m.marketId, cfg.ocParams);
    srm.setBaseAssetMarginFactor(m.marketId, cfg.baseMarginFactor, cfg.baseIMScale);

    srmViewer.setOIFeeRateBPS(address(m.option), OI_FEE_BPS);
    srmViewer.setOIFeeRateBPS(address(m.base), OI_FEE_BPS);

    // allow feed data to be pushed through manager during trades (BaseManager whitelisted callees)
    srm.setWhitelistedCallee(address(m.spotFeed), true);
    srm.setWhitelistedCallee(address(m.forwardFeed), true);
    srm.setWhitelistedCallee(address(m.volFeed), true);
    srm.setWhitelistedCallee(address(m.rateFeed), true);
  }

  /// @dev 1-of-1 signer set for anvil; signer/threshold are env-configurable for other chains
  function _configureFeed(BaseLyraFeed feed, uint64 heartbeat) internal {
    feed.setHeartbeat(heartbeat);
    feed.addSigner(feedSigner, true);
    feed.setRequiredSigners(1);
  }
}
