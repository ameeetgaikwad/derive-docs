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
import {IERC165} from "openzeppelin/utils/introspection/IERC165.sol";

import {ISpotFeed} from "v2-core/src/interfaces/ISpotFeed.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockScaledToken} from "./mocks/MockScaledToken.sol";
import {AnchoredSettlementFeed} from "../src/AnchoredSettlementFeed.sol";
import {PythSpotFeed} from "../src/PythSpotFeed.sol";
import {PythBenchmarkSettlementFeed} from "../src/PythBenchmarkSettlementFeed.sol";
import {MultiplierCheckpointRegistry} from "../src/MultiplierCheckpointRegistry.sol";
import {ScaledSpotFeed} from "../src/ScaledSpotFeed.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IScaledUiToken} from "../src/interfaces/IScaledUiToken.sol";

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

  // ---------------------------------------------------------------------------
  // BSC MAINNET (chainId 56) — verified addresses. Every entry was cross-checked
  // against an official source AND read back on-chain via RPC on 2026-07-01; the
  // full evidence table lives in protocol/MAINNET.md. Env vars (BTCB_ADDRESS,
  // USDT_ADDRESS, PYTH_ADDRESS) still override, so these are defaults, not locks.
  // ---------------------------------------------------------------------------

  /// @dev Binance-Peg BTCB Token — bscscan verified; on-chain symbol()="BTCB", decimals()=18
  address internal constant BSC_MAINNET_BTCB = 0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c;
  /// @dev Binance-Peg BSC-USD (Tether USD) — bscscan verified; on-chain symbol()="USDT", decimals()=18
  address internal constant BSC_MAINNET_USDT = 0x55d398326f99059fF775485246999027B3197955;
  /// @dev official Pyth price-feeds contract, BNB Chain mainnet (docs.pyth.network);
  ///      on-chain getValidTimePeriod()=60 and a live Crypto.BTC/USD price
  address internal constant BSC_MAINNET_PYTH = 0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594;
  /// @dev Chainlink BTC/USD proxy, BSC mainnet (docs.chain.link reference data);
  ///      on-chain description()="BTC / USD", decimals()=8
  address internal constant BSC_MAINNET_CHAINLINK_BTC_USD = 0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf;
  /// @dev Chainlink ETH/USD proxy, BSC mainnet (docs.chain.link reference data);
  ///      on-chain description()="ETH / USD", decimals()=8
  address internal constant BSC_MAINNET_CHAINLINK_ETH_USD = 0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e;
  address internal constant BSC_MAINNET_XAUT = 0x21cAef8A43163Eea865baeE23b9C2E327696A3bf;
  address internal constant BSC_MAINNET_SPYB = 0x7138b48df7D98D7e3cc221BfE7192D0a178182D8;
  address internal constant BSC_MAINNET_NVDAB = 0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436;
  address internal constant BSC_MAINNET_SPCXB = 0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1;

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
  bytes4 internal constant SCALED_UI_AMOUNT_INTERFACE_ID = 0xa60bf13d;
  bytes4 internal constant SCALED_UI_PENDING_INTERFACE_ID = 0x4bd27648;

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
    /// baked-in default token address for the current chain (BSC mainnet only);
    /// address(0) means the env var is required off-anvil
    address underlyingDefault;
    /// expected native ERC20 decimals; checked before deployment
    uint8 underlyingDecimals;
    /// BEP-8056 collateral whose UI amount is raw amount * uiMultiplier / 1e18
    bool scaledUi;
    /// settle from a Pyth benchmark proof instead of Chainlink history
    bool benchmarkSettlement;
    /// Pyth price feed id (Hermes / on-chain Pyth), for PythSpotFeed deployments
    bytes32 pythPriceId;
    /// Chainlink aggregator for the current chain — PythSpotFeed circuit breaker +
    /// AnchoredSettlementFeed anchor (selected by block.chainid; testnet default)
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
    return 6;
  }

  /// @notice Resolve a deployable market by canonical manifest id.
  function getMarketConfigById(string memory marketId) public returns (MarketConfig memory) {
    bytes32 id = keccak256(bytes(marketId));
    if (id == keccak256("BTC")) return getManifestMarketConfig(0);
    if (id == keccak256("XAU")) return getManifestMarketConfig(2);
    if (id == keccak256("SPY")) return getManifestMarketConfig(3);
    if (id == keccak256("NVDA")) return getManifestMarketConfig(4);
    if (id == keccak256("SPCX")) return getManifestMarketConfig(5);
    // Kept only for compatibility with the historical optional ETH sidecar.
    if (id == keccak256("ETH")) return getMarketConfig(1);
    revert("MarketDeployerBase: unknown market id");
  }

  /// @notice Merge and validate token/oracle boundary fields from the canonical JSON manifest.
  function getManifestMarketConfig(uint index) public returns (MarketConfig memory cfg) {
    cfg = getMarketConfig(index);
    string memory path = string.concat(
      vm.projectRoot(), "/deployments/markets/", vm.toString(block.chainid), ".json"
    );
    string memory json = vm.readFile(path);
    require(vm.parseJsonUint(json, ".chainId") == block.chainid, "market manifest chain mismatch");
    uint length = vm.parseJsonUint(json, ".marketCount");
    bool found;
    for (uint i = 0; i < length; i++) {
      string memory base = string.concat(".markets[", vm.toString(i), "]");
      if (keccak256(bytes(vm.parseJsonString(json, string.concat(base, ".id")))) != keccak256(bytes(cfg.name))) {
        continue;
      }
      found = true;
      require(
        vm.parseJsonUint(json, string.concat(base, ".collateral.decimals")) == cfg.underlyingDecimals,
        "manifest collateral decimals mismatch"
      );
      require(
        vm.parseJsonBool(json, string.concat(base, ".collateral.scaledUi")) == cfg.scaledUi,
        "manifest scaledUi mismatch"
      );
      require(
        keccak256(bytes(vm.parseJsonString(json, string.concat(base, ".collateral.symbol"))))
          == keccak256(bytes(cfg.underlyingSymbol)),
        "manifest collateral symbol mismatch"
      );
      try vm.parseJsonAddress(json, string.concat(base, ".collateral.address")) returns (address token) {
        if (token != address(0)) cfg.underlyingDefault = token;
      } catch {}
      try vm.parseJsonBytes32(json, string.concat(base, ".pythPriceId")) returns (bytes32 priceId) {
        if (priceId != bytes32(0)) cfg.pythPriceId = priceId;
      } catch {}
      break;
    }
    require(found, "market missing from chain manifest");
  }

  /// @notice entry 0 = BTC (the live testnet market), entry 1 = ETH (example second market)
  /// @dev chain-aware (view): Chainlink aggregators and baked-in underlying defaults are
  ///      selected by block.chainid — BSC mainnet (56) uses the verified constants above,
  ///      everything else keeps the BSC-testnet aggregators (no code on anvil -> signed
  ///      fallback). Caps/margin params are the standard values from the vendored
  ///      lib/v2-core/scripts/config-mainnet.sol on every chain.
  function getMarketConfig(uint index) public returns (MarketConfig memory) {
    bool isBscMainnet = block.chainid == 56;
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
        underlyingDefault: isBscMainnet ? BSC_MAINNET_BTCB : address(0),
        underlyingDecimals: 18,
        scaledUi: false,
        benchmarkSettlement: false,
        // Crypto.BTC/USD (hermes.pyth.network) — Pyth price ids are chain-agnostic
        pythPriceId: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43,
        // Chainlink BTC/USD (mainnet verified / testnet default)
        chainlinkAggregator: isBscMainnet
          ? BSC_MAINNET_CHAINLINK_BTC_USD
          : 0x5741306c21795FdCBb9b265Ea0255F499DFe515C,
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
        // no baked-in mainnet default: BSC's canonical "ETH" is Binance-Peg ETH, not
        // verified here — WETH_ADDRESS env is required to add this market on 56
        underlyingDefault: address(0),
        underlyingDecimals: 18,
        scaledUi: false,
        benchmarkSettlement: false,
        // Crypto.ETH/USD (hermes.pyth.network) — Pyth price ids are chain-agnostic
        pythPriceId: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace,
        // Chainlink ETH/USD (mainnet verified / testnet default)
        chainlinkAggregator: isBscMainnet
          ? BSC_MAINNET_CHAINLINK_ETH_USD
          : 0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7,
        optionCap: 2_000_000e18, // Config.getSRMCaps("ETH")
        baseCap: 250e18,
        optionMarginParams: optionMarginParams,
        ocParams: ocParams,
        baseMarginFactor: 0.8e18, // Config.getSRMBaseMarginParams("ETH")
        baseIMScale: 0.9375e18
      });
    }
    if (index == 2) {
      return _rwaConfig(
        "XAU", "XAUt", "XAUT_ADDRESS", isBscMainnet ? BSC_MAINNET_XAUT : address(0), 6, false,
        vm.envOr("XAU_PYTH_PRICE_ID", bytes32(0)), 10_000e18, 250e18, optionMarginParams, ocParams, 0.8e18, 0.94e18
      );
    }
    if (index == 3) {
      return _rwaConfig(
        "SPY", "SPYB", "SPYB_ADDRESS", isBscMainnet ? BSC_MAINNET_SPYB : address(0), 18, true,
        vm.envOr("SPY_PYTH_PRICE_ID", bytes32(0)), 1_000_000e18, 10_000e18, optionMarginParams, ocParams, 0.8e18, 0.94e18
      );
    }
    if (index == 4) {
      return _rwaConfig(
        "NVDA", "NVDAB", "NVDAB_ADDRESS", isBscMainnet ? BSC_MAINNET_NVDAB : address(0), 18, true,
        vm.envOr("NVDA_PYTH_PRICE_ID", bytes32(0)), 1_000_000e18, 10_000e18, optionMarginParams, ocParams, 0.8e18, 0.94e18
      );
    }
    if (index == 5) {
      return _rwaConfig(
        "SPCX", "SPCXB", "SPCXB_ADDRESS", isBscMainnet ? BSC_MAINNET_SPCXB : address(0), 18, true,
        vm.envOr("SPCX_PYTH_PRICE_ID", bytes32(0)), 1_000_000e18, 10_000e18, optionMarginParams, ocParams, 0.8e18, 0.94e18
      );
    }
    revert("MarketDeployerBase: unknown market config index");
  }

  function _rwaConfig(
    string memory name,
    string memory symbol,
    string memory envKey,
    address defaultToken,
    uint8 decimals,
    bool scaledUi,
    bytes32 priceId,
    uint optionCap,
    uint baseCap,
    IStandardManager.OptionMarginParams memory optionMarginParams,
    IStandardManager.OracleContingencyParams memory ocParams,
    uint baseMarginFactor,
    uint baseIMScale
  ) internal pure returns (MarketConfig memory) {
    return MarketConfig({
      name: name,
      underlyingSymbol: symbol,
      underlyingEnvKey: envKey,
      underlyingDefault: defaultToken,
      underlyingDecimals: decimals,
      scaledUi: scaledUi,
      benchmarkSettlement: true,
      pythPriceId: priceId,
      chainlinkAggregator: address(0),
      optionCap: optionCap,
      baseCap: baseCap,
      optionMarginParams: optionMarginParams,
      ocParams: ocParams,
      baseMarginFactor: baseMarginFactor,
      baseIMScale: baseIMScale
    });
  }

  // ---------------------------------------------------------------------------
  // Deploy + register (mirrors lib/v2-core/scripts/deploy-srm-option-only-market.s.sol)
  // ---------------------------------------------------------------------------

  struct MarketDeployment {
    LyraSpotFeed spotFeed;
    LyraForwardFeed forwardFeed;
    LyraVolFeed volFeed;
    LyraRateFeed rateFeed;
    /// Chainlink/Pyth-anchored ISettlementFeed the OptionAsset settles against;
    /// address(0) when the market's Chainlink aggregator is unavailable (plain anvil),
    /// in which case settlement falls back to the signed LyraForwardFeed
    AnchoredSettlementFeed settlementFeed;
    /// Pyth adapter with Chainlink circuit breaker, wired as the SRM's live spot feed;
    /// address(0) when Pyth/Chainlink are unavailable (plain anvil), in which case the
    /// SRM keeps the signed LyraSpotFeed (which stays deployed as fallback regardless)
    PythSpotFeed pythSpotFeed;
    ScaledSpotFeed scaledSpotFeed;
    MultiplierCheckpointRegistry multiplierRegistry;
    PythBenchmarkSettlementFeed benchmarkSettlementFeed;
    address liveSpotFeed;
    address liveSettlementFeed;
    OptionAsset option;
    WrappedERC20Asset base;
    uint marketId;
  }

  /// @dev official Pyth price-feeds contract per chain (docs.pyth.network); used by the
  ///      AnchoredSettlementFeed as a best-effort cross-check. address(0) disables it.
  function _pythAddress() internal returns (address) {
    if (block.chainid == 56) return vm.envOr("PYTH_ADDRESS", BSC_MAINNET_PYTH); // BSC mainnet
    if (block.chainid == 97) return 0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb; // BSC testnet
    return vm.envOr("PYTH_ADDRESS", address(0));
  }

  /// @dev resolve the market's underlying token: a fresh open-mint mock on
  ///      anvil; otherwise `cfg.underlyingEnvKey` from env, falling back to the chain's
  ///      baked-in verified default (BSC mainnet) when set. Must run inside broadcast.
  function _resolveUnderlying(MarketConfig memory cfg) internal returns (address token) {
    if (block.chainid == 31337) {
      if (cfg.scaledUi) {
        token = address(new MockScaledToken(
          string.concat("Mock ", cfg.underlyingSymbol), cfg.underlyingSymbol, 1e18
        ));
      } else {
        MockERC20 mock = new MockERC20(
          string.concat("Mock ", cfg.underlyingSymbol), cfg.underlyingSymbol, cfg.underlyingDecimals
        );
        token = address(mock);
      }
    } else {
      token = cfg.underlyingDefault == address(0)
        ? vm.envAddress(cfg.underlyingEnvKey)
        : vm.envOr(cfg.underlyingEnvKey, cfg.underlyingDefault);
    }

    require(token != address(0) && token.code.length > 0, "underlying is not a contract");
    require(IERC20Metadata(token).decimals() == cfg.underlyingDecimals, "underlying decimals mismatch");
    require(
      keccak256(bytes(IERC20Metadata(token).symbol())) == keccak256(bytes(cfg.underlyingSymbol)),
      "underlying symbol mismatch"
    );
    if (cfg.scaledUi) {
      require(
        IERC165(token).supportsInterface(SCALED_UI_AMOUNT_INTERFACE_ID),
        "underlying missing ERC-8056 core"
      );
      require(
        IERC165(token).supportsInterface(SCALED_UI_PENDING_INTERFACE_ID),
        "underlying missing ERC-8056 pending multiplier"
      );
    }
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

    // Settlement anchoring: options settle against Chainlink round data (Pyth-cross-checked)
    // via AnchoredSettlementFeed — NOT the signed forward feed — whenever the market's
    // Chainlink aggregator actually exists on this chain. On plain anvil (no aggregator
    // code) settlement falls back to the signed LyraForwardFeed so local e2e keeps working.
    address settlementFeed = address(m.forwardFeed);
    ISpotFeed srmSpotFeed = m.spotFeed;
    address pyth = _pythAddress();

    if (block.chainid != 31337 && cfg.benchmarkSettlement) {
      require(pyth != address(0) && pyth.code.length > 0, "RWA market requires Pyth");
      require(cfg.pythPriceId != bytes32(0), "RWA market requires Pyth price id");
    }

    if (pyth != address(0) && pyth.code.length > 0 && cfg.pythPriceId != bytes32(0)) {
      m.pythSpotFeed = new PythSpotFeed(
        IPyth(pyth), cfg.pythPriceId, IAggregatorV3(cfg.chainlinkAggregator)
      );
      srmSpotFeed = m.pythSpotFeed;

      if (cfg.scaledUi) {
        m.multiplierRegistry = new MultiplierCheckpointRegistry(
          IScaledUiToken(underlying)
        );
        m.scaledSpotFeed = new ScaledSpotFeed(m.pythSpotFeed, m.multiplierRegistry);
        srmSpotFeed = m.scaledSpotFeed;
      }

      if (cfg.benchmarkSettlement) {
        m.benchmarkSettlementFeed = new PythBenchmarkSettlementFeed(
          IPyth(pyth), cfg.pythPriceId, m.multiplierRegistry, 5 minutes
        );
        settlementFeed = address(m.benchmarkSettlementFeed);
      }
    }

    if (cfg.chainlinkAggregator != address(0) && cfg.chainlinkAggregator.code.length > 0) {
      m.settlementFeed = new AnchoredSettlementFeed(
        IAggregatorV3(cfg.chainlinkAggregator), IPyth(pyth), cfg.pythPriceId
      );
      settlementFeed = address(m.settlementFeed);

      // Live oracle stack: the SRM's spot feed is the Pyth adapter (Chainlink circuit
      // breaker) whenever the on-chain Pyth contract exists — the hardened end-state
      // the testnet reached via a post-deploy setOraclesForMarket swap (TESTNET.md
      // "Oracle stack"). The signed LyraSpotFeed stays deployed/configured as fallback.
    }
    m.liveSpotFeed = address(srmSpotFeed);
    m.liveSettlementFeed = settlementFeed;
    m.option = new OptionAsset(subAccounts, settlementFeed);
    m.base = new WrappedERC20Asset(subAccounts, IERC20Metadata(underlying));

    // ---- registration (mirrors _setPermissionAndCaps + _registerMarketToSRM) ----
    m.option.setWhitelistManager(address(srm), true);
    m.base.setWhitelistManager(address(srm), true);
    m.option.setTotalPositionCap(IManager(address(srm)), cfg.optionCap);
    m.base.setTotalPositionCap(IManager(address(srm)), cfg.baseCap);

    m.marketId = srm.createMarket(cfg.name);

    srm.whitelistAsset(m.option, m.marketId, IStandardManager.AssetType.Option);
    srm.whitelistAsset(m.base, m.marketId, IStandardManager.AssetType.Base);

    srm.setOraclesForMarket(m.marketId, srmSpotFeed, m.forwardFeed, m.volFeed);

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
