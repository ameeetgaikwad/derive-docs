// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

// ---- v2-core ----
import {SubAccounts} from "v2-core/src/SubAccounts.sol";
import {SecurityModule} from "v2-core/src/SecurityModule.sol";
import {InterestRateModel} from "v2-core/src/assets/InterestRateModel.sol";
import {CashAsset} from "v2-core/src/assets/CashAsset.sol";
import {WrappedERC20Asset} from "v2-core/src/assets/WrappedERC20Asset.sol";
import {OptionAsset} from "v2-core/src/assets/OptionAsset.sol";
import {DutchAuction} from "v2-core/src/liquidation/DutchAuction.sol";
import {StandardManager} from "v2-core/src/risk-managers/StandardManager.sol";
import {SRMPortfolioViewer} from "v2-core/src/risk-managers/SRMPortfolioViewer.sol";
import {LyraSpotFeed} from "v2-core/src/feeds/LyraSpotFeed.sol";
import {LyraForwardFeed} from "v2-core/src/feeds/LyraForwardFeed.sol";
import {LyraVolFeed} from "v2-core/src/feeds/LyraVolFeed.sol";
import {LyraRateFeed} from "v2-core/src/feeds/LyraRateFeed.sol";
import {BaseLyraFeed} from "v2-core/src/feeds/BaseLyraFeed.sol";
import {OptionSettlementHelper} from "v2-core/src/periphery/OptionSettlementHelper.sol";
import {IManager} from "v2-core/src/interfaces/IManager.sol";
import {IAsset} from "v2-core/src/interfaces/IAsset.sol";
import {IStandardManager} from "v2-core/src/interfaces/IStandardManager.sol";
import {IDutchAuction} from "v2-core/src/interfaces/IDutchAuction.sol";

// ---- v2-matching ----
import {Matching} from "v2-matching/src/Matching.sol";
import {DepositModule} from "v2-matching/src/modules/DepositModule.sol";
import {WithdrawalModule} from "v2-matching/src/modules/WithdrawalModule.sol";
import {TransferModule} from "v2-matching/src/modules/TransferModule.sol";
import {TradeModule} from "v2-matching/src/modules/TradeModule.sol";
import {RfqModule} from "v2-matching/src/modules/RfqModule.sol";
import {SubAccountCreator} from "v2-matching/src/periphery/SubAccountCreator.sol";
import {LyraSettlementUtils} from "v2-matching/src/periphery/LyraSettlementUtils.sol";
import {ISubAccounts} from "v2-core/src/interfaces/ISubAccounts.sol";

import {IERC20Metadata} from "openzeppelin/token/ERC20/extensions/IERC20Metadata.sol";

import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title DeployAll
 * @notice Deploys + wires the full sats-options v1 system (BTC covered calls via RFQ):
 *         SubAccounts, InterestRateModel + CashAsset(USDT), SecurityModule, DutchAuction,
 *         StandardManager (SRM) + SRMPortfolioViewer, signed feeds (spot/forward/vol/rate +
 *         USDT stable feed), BTC OptionAsset + BTCB WrappedERC20Asset registered as the BTC
 *         market on the SRM, then Matching + Deposit/Withdrawal/Transfer/Trade/Rfq modules
 *         and settlement periphery. Writes all addresses to deployments/<chainId>.json.
 *
 *         Wiring order, parameters and registration calls are mined from the vendored
 *         deployment scripts (read-only references, identical pins):
 *           lib/v2-core/scripts/deploy-core.s.sol
 *           lib/v2-core/scripts/deploy-srm-option-only-market.s.sol
 *           lib/v2-core/scripts/config-mainnet.sol            (param values inlined below)
 *           lib/v2-matching/scripts/deploy-all.s.sol
 *
 *         LiquidateModule is intentionally NOT deployed: it is headered UNLICENSED at this
 *         pin (pending counsel review — see PROVENANCE.md).
 *
 * Usage (anvil):
 *   forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 * Env (all optional on 31337):
 *   PRIVATE_KEY      deployer key   (default: anvil well-known key 0)
 *   FEED_SIGNER      1-of-1 signer registered on every signed feed (default: deployer)
 *   TRADE_EXECUTOR   address allowed to call Matching.verifyAndMatch (default: deployer)
 * Env (required when chainId != 31337, e.g. BSC testnet 97):
 *   BTCB_ADDRESS, USDT_ADDRESS   real 18-decimal token addresses (mocks are anvil-only)
 */
contract DeployAll is Script {
  // anvil well-known account #0 — dev default only
  uint internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

  // ---------------------------------------------------------------------------
  // Parameters — copied from lib/v2-core/scripts/config-mainnet.sol ("Config"),
  // the same values Derive uses for integration tests / anvil state generation.
  // ---------------------------------------------------------------------------

  // Config.getDefaultInterestRateModel()
  uint internal constant IRM_MIN_RATE = 0.02e18;
  uint internal constant IRM_RATE_MULTIPLIER = 0.08e18;
  uint internal constant IRM_HIGH_RATE_MULTIPLIER = 0.9e18;
  uint internal constant IRM_OPTIMAL_UTIL = 0.85e18;

  uint internal constant CASH_SM_FEE = 0.2e18; // Config.CASH_SM_FEE

  uint internal constant MAX_ACCOUNT_SIZE_SRM = 48; // Config.MAX_ACCOUNT_SIZE_SRM
  bool internal constant BORROW_ENABLED = true; // Config.BORROW_ENABLED

  // Config feed heartbeats
  uint64 internal constant SPOT_HEARTBEAT = 3 minutes;
  uint64 internal constant VOL_HEARTBEAT = 20 minutes;
  uint64 internal constant FORWARD_HEARTBEAT = 60 minutes;
  uint64 internal constant SETTLEMENT_HEARTBEAT = 3 minutes;
  uint64 internal constant STABLE_HEARTBEAT = 60 minutes;
  uint64 internal constant RATE_HEARTBEAT = 60 minutes; // signed rate feed (not in Config; matches stable)
  uint64 internal constant FWD_MAX_EXPIRY = 400 days;

  // Config.getSRMCaps("BTC") (option/base only — no perp in v1)
  uint internal constant BTC_OPTION_CAP = 100_000e18;
  uint internal constant BTC_BASE_CAP = 5e18;

  // fees — per lib/v2-core/scripts/deploy-srm-option-only-market.s.sol
  uint internal constant OI_FEE_BPS = 0.1e18;
  uint internal constant MIN_OI_FEE = 10e18;

  // ---------------------------------------------------------------------------
  // Deployed contracts (state vars to keep run() shallow / avoid stack issues)
  // ---------------------------------------------------------------------------
  address internal deployer;
  address internal feedSigner;
  address internal tradeExecutor;

  address internal btcb;
  address internal usdt;

  SubAccounts internal subAccounts;
  InterestRateModel internal rateModel;
  CashAsset internal cash;
  SecurityModule internal securityModule;
  DutchAuction internal auction;
  SRMPortfolioViewer internal srmViewer;
  StandardManager internal srm;
  LyraSpotFeed internal stableFeed;
  OptionSettlementHelper internal optionSettlementHelper;

  LyraSpotFeed internal btcSpotFeed;
  LyraForwardFeed internal btcForwardFeed;
  LyraVolFeed internal btcVolFeed;
  LyraRateFeed internal btcRateFeed;
  OptionAsset internal btcOption;
  WrappedERC20Asset internal btcBase;
  uint internal btcMarketId;

  Matching internal matching;
  DepositModule internal depositModule;
  WithdrawalModule internal withdrawalModule;
  TransferModule internal transferModule;
  TradeModule internal tradeModule;
  RfqModule internal rfqModule;
  SubAccountCreator internal subAccountCreator;
  LyraSettlementUtils internal settlementUtils;
  uint internal feeRecipientSubAccount;

  function run() external {
    uint deployerKey = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
    deployer = vm.addr(deployerKey);
    feedSigner = vm.envOr("FEED_SIGNER", deployer);
    tradeExecutor = vm.envOr("TRADE_EXECUTOR", deployer);

    console2.log("chainId:       ", block.chainid);
    console2.log("deployer:      ", deployer);
    console2.log("feedSigner:    ", feedSigner);
    console2.log("tradeExecutor: ", tradeExecutor);

    vm.startBroadcast(deployerKey);

    _setupTokens();
    _deployCore();
    _deployBtcMarket();
    _registerBtcMarketOnSrm();
    _deployMatchingStack();

    vm.stopBroadcast();

    _writeDeploymentsJson();
  }

  /// @dev 18-decimal mocks on anvil (BTCB & USDT are both 18 decimals on BNB chain);
  ///      real token addresses from env elsewhere.
  function _setupTokens() internal {
    if (block.chainid == 31337) {
      MockERC20 mockBtcb = new MockERC20("Mock BTCB", "BTCB", 18);
      MockERC20 mockUsdt = new MockERC20("Mock USDT", "USDT", 18);
      // seed the deployer so local tooling has funds out of the box
      mockBtcb.mint(deployer, 1_000e18);
      mockUsdt.mint(deployer, 100_000_000e18);
      btcb = address(mockBtcb);
      usdt = address(mockUsdt);
    } else {
      btcb = vm.envAddress("BTCB_ADDRESS");
      usdt = vm.envAddress("USDT_ADDRESS");
      require(IERC20Metadata(btcb).decimals() == 18, "BTCB must be 18 decimals");
      require(IERC20Metadata(usdt).decimals() == 18, "USDT must be 18 decimals");
    }
  }

  /// @dev mirrors lib/v2-core/scripts/deploy-core.s.sol (_deployCoreContracts + _setupCoreFunctions)
  function _deployCore() internal {
    uint nonce = vm.getNonce(deployer);

    // nonce
    subAccounts = new SubAccounts("sats-options SubAccounts", "SATS-SA");
    // nonce + 1
    rateModel = new InterestRateModel(IRM_MIN_RATE, IRM_RATE_MULTIPLIER, IRM_HIGH_RATE_MULTIPLIER, IRM_OPTIMAL_UTIL);
    // nonce + 2
    cash = new CashAsset(subAccounts, IERC20Metadata(usdt), rateModel);

    // nonce + 3: SecurityModule needs the (not yet deployed) manager — predict SRM at nonce + 6
    address srmAddr = computeCreateAddress(deployer, nonce + 6);
    securityModule = new SecurityModule(subAccounts, cash, IManager(srmAddr));
    // nonce + 4
    auction = new DutchAuction(subAccounts, securityModule, cash);
    // nonce + 5
    srmViewer = new SRMPortfolioViewer(subAccounts, cash);
    // nonce + 6
    srm = new StandardManager(subAccounts, cash, auction, srmViewer);
    require(address(srm) == srmAddr, "SRM address prediction failed");

    // USDT/USD stable feed used by the SRM for depeg checks
    stableFeed = new LyraSpotFeed();
    _configureFeed(BaseLyraFeed(address(stableFeed)), STABLE_HEARTBEAT);

    optionSettlementHelper = new OptionSettlementHelper();

    // ---- wiring (same order as vendored deploy-core) ----
    srmViewer.setStandardManager(srm);

    auction.setSMAccount(securityModule.accountId());
    auction.setWhitelistManager(address(srm), true);

    cash.setLiquidationModule(auction);
    cash.setSmFeeRecipient(securityModule.accountId());
    cash.setSmFee(CASH_SM_FEE);

    // Config.getDefaultAuctionParam()
    auction.setAuctionParams(
      IDutchAuction.AuctionParams({
        startingMtMPercentage: 0.95e18,
        fastAuctionCutoffPercentage: 0.7e18,
        fastAuctionLength: 15 minutes,
        slowAuctionLength: 12 hours,
        insolventAuctionLength: 60 minutes,
        liquidatorFeeRate: 0.1e18,
        bufferMarginPercentage: 0.15e18
      })
    );

    securityModule.setWhitelistModule(address(auction), true);

    cash.setWhitelistManager(address(srm), true);

    srm.setMaxAccountSize(MAX_ACCOUNT_SIZE_SRM);
    srm.setBorrowingEnabled(BORROW_ENABLED);
    srm.setStableFeed(stableFeed);
    // Config.getSRMDepegParams()
    srm.setDepegParameters(IStandardManager.DepegParams({threshold: 0.99e18, depegFactor: 2e18}));

    srm.setWhitelistedCallee(address(stableFeed), true);
    srm.setWhitelistedCallee(address(optionSettlementHelper), true);
  }

  /// @dev mirrors lib/v2-core/scripts/deploy-srm-option-only-market.s.sol (_deployMarketContracts),
  ///      plus the signed LyraRateFeed required by the spec.
  function _deployBtcMarket() internal {
    btcSpotFeed = new LyraSpotFeed();
    btcForwardFeed = new LyraForwardFeed(btcSpotFeed);
    btcVolFeed = new LyraVolFeed();
    btcRateFeed = new LyraRateFeed();

    _configureFeed(BaseLyraFeed(address(btcSpotFeed)), SPOT_HEARTBEAT);
    _configureFeed(BaseLyraFeed(address(btcVolFeed)), VOL_HEARTBEAT);
    _configureFeed(BaseLyraFeed(address(btcRateFeed)), RATE_HEARTBEAT);
    _configureFeed(BaseLyraFeed(address(btcForwardFeed)), FORWARD_HEARTBEAT);
    btcForwardFeed.setSettlementHeartbeat(SETTLEMENT_HEARTBEAT);
    btcForwardFeed.setMaxExpiry(FWD_MAX_EXPIRY);

    // option settles against the forward feed (ISettlementFeed)
    btcOption = new OptionAsset(subAccounts, address(btcForwardFeed));
    btcBase = new WrappedERC20Asset(subAccounts, IERC20Metadata(btcb));
  }

  /// @dev mirrors deploy-srm-option-only-market (_setPermissionAndCaps + _registerMarketToSRM)
  function _registerBtcMarketOnSrm() internal {
    // asset-side whitelisting + caps, Config.getSRMCaps("BTC")
    btcOption.setWhitelistManager(address(srm), true);
    btcBase.setWhitelistManager(address(srm), true);
    btcOption.setTotalPositionCap(IManager(address(srm)), BTC_OPTION_CAP);
    btcBase.setTotalPositionCap(IManager(address(srm)), BTC_BASE_CAP);

    btcMarketId = srm.createMarket("BTC");

    srm.whitelistAsset(btcOption, btcMarketId, IStandardManager.AssetType.Option);
    srm.whitelistAsset(btcBase, btcMarketId, IStandardManager.AssetType.Base);

    srm.setOraclesForMarket(btcMarketId, btcSpotFeed, btcForwardFeed, btcVolFeed);

    // Config.getSRMParams("BTC")
    srm.setOptionMarginParams(
      btcMarketId,
      IStandardManager.OptionMarginParams({
        maxSpotReq: 0.15e18,
        minSpotReq: 0.13e18,
        mmCallSpotReq: 0.09e18,
        mmPutSpotReq: 0.09e18,
        MMPutMtMReq: 0.09e18,
        unpairedIMScale: 1.2e18,
        unpairedMMScale: 1.1e18,
        mmOffsetScale: 1.05e18
      })
    );
    srm.setOracleContingencyParams(
      btcMarketId,
      IStandardManager.OracleContingencyParams({
        perpThreshold: 0.55e18,
        optionThreshold: 0.55e18,
        baseThreshold: 0.55e18,
        OCFactor: 1e18
      })
    );
    srm.setBaseAssetMarginFactor(btcMarketId, 0.75e18, 0.93e18);

    srmViewer.setOIFeeRateBPS(address(btcOption), OI_FEE_BPS);
    srmViewer.setOIFeeRateBPS(address(btcBase), OI_FEE_BPS);
    srm.setMinOIFee(MIN_OI_FEE);

    // allow feed data to be pushed through manager during trades (BaseManager whitelisted callees)
    srm.setWhitelistedCallee(address(btcSpotFeed), true);
    srm.setWhitelistedCallee(address(btcForwardFeed), true);
    srm.setWhitelistedCallee(address(btcVolFeed), true);
    srm.setWhitelistedCallee(address(btcRateFeed), true);
  }

  /// @dev mirrors lib/v2-matching/scripts/deploy-all.s.sol — minus the UNLICENSED LiquidateModule.
  function _deployMatchingStack() internal {
    // fee recipient subaccount, owned by the deployer under the SRM. Also registered
    // on the SRM itself: BaseManager._payFee silently skips OI fees while
    // feeRecipientAcc == 0 (see BaseManager.sol), so without this call the configured
    // OI_FEE_BPS/MIN_OI_FEE would never be charged.
    feeRecipientSubAccount = subAccounts.createAccount(deployer, IManager(address(srm)));
    srm.setFeeRecipient(feeRecipientSubAccount);

    matching = new Matching(ISubAccounts(address(subAccounts)));

    depositModule = new DepositModule(matching);
    withdrawalModule = new WithdrawalModule(matching);
    transferModule = new TransferModule(matching);
    tradeModule = new TradeModule(matching, IAsset(address(cash)), feeRecipientSubAccount);
    rfqModule = new RfqModule(matching, IAsset(address(cash)), feeRecipientSubAccount);

    matching.setAllowedModule(address(depositModule), true);
    matching.setAllowedModule(address(withdrawalModule), true);
    matching.setAllowedModule(address(transferModule), true);
    matching.setAllowedModule(address(tradeModule), true);
    matching.setAllowedModule(address(rfqModule), true);

    matching.setTradeExecutor(tradeExecutor, true);

    subAccountCreator = new SubAccountCreator(ISubAccounts(address(subAccounts)), matching);
    settlementUtils = new LyraSettlementUtils();
  }

  /// @dev 1-of-1 signer set for anvil; signer/threshold are env-configurable for other chains
  function _configureFeed(BaseLyraFeed feed, uint64 heartbeat) internal {
    feed.setHeartbeat(heartbeat);
    feed.addSigner(feedSigner, true);
    feed.setRequiredSigners(1);
  }

  function _writeDeploymentsJson() internal {
    string memory k = "deployment";

    vm.serializeUint(k, "chainId", block.chainid);
    vm.serializeAddress(k, "deployer", deployer);
    vm.serializeAddress(k, "feedSigner", feedSigner);
    vm.serializeAddress(k, "tradeExecutor", tradeExecutor);

    vm.serializeAddress(k, "btcb", btcb);
    vm.serializeAddress(k, "usdt", usdt);

    vm.serializeAddress(k, "subAccounts", address(subAccounts));
    vm.serializeAddress(k, "interestRateModel", address(rateModel));
    vm.serializeAddress(k, "cashAsset", address(cash));
    vm.serializeAddress(k, "securityModule", address(securityModule));
    vm.serializeUint(k, "securityModuleSubAccount", securityModule.accountId());
    vm.serializeAddress(k, "dutchAuction", address(auction));
    vm.serializeAddress(k, "srmViewer", address(srmViewer));
    vm.serializeAddress(k, "standardManager", address(srm));
    vm.serializeAddress(k, "stableFeed", address(stableFeed));
    vm.serializeAddress(k, "optionSettlementHelper", address(optionSettlementHelper));

    vm.serializeAddress(k, "btcSpotFeed", address(btcSpotFeed));
    vm.serializeAddress(k, "btcForwardFeed", address(btcForwardFeed));
    vm.serializeAddress(k, "btcVolFeed", address(btcVolFeed));
    vm.serializeAddress(k, "btcRateFeed", address(btcRateFeed));
    vm.serializeAddress(k, "btcOptionAsset", address(btcOption));
    vm.serializeAddress(k, "btcBaseAsset", address(btcBase));
    vm.serializeUint(k, "btcMarketId", btcMarketId);

    vm.serializeAddress(k, "matching", address(matching));
    vm.serializeAddress(k, "depositModule", address(depositModule));
    vm.serializeAddress(k, "withdrawalModule", address(withdrawalModule));
    vm.serializeAddress(k, "transferModule", address(transferModule));
    vm.serializeAddress(k, "tradeModule", address(tradeModule));
    vm.serializeAddress(k, "rfqModule", address(rfqModule));
    vm.serializeAddress(k, "subAccountCreator", address(subAccountCreator));
    vm.serializeAddress(k, "settlementUtils", address(settlementUtils));
    vm.serializeUint(k, "feeRecipientSubAccount", feeRecipientSubAccount);

    // EIP-712 domain of Matching (name "Matching", version "1.0" — see ActionVerifier.sol)
    vm.serializeBytes32(k, "matchingDomainSeparator", matching.domainSeparator());
    string memory json = vm.serializeBytes32(k, "actionTypehash", matching.ACTION_TYPEHASH());

    // deployments/ dir is checked into the repo (.gitkeep) — pinned forge-std has no vm.createDir
    string memory path =
      string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    vm.writeFile(path, json);
    console2.log("Deployment addresses written to:", path);
  }
}
