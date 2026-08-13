// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/console2.sol";

import {IERC20Metadata} from "openzeppelin/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC165} from "openzeppelin/utils/introspection/IERC165.sol";
import {SubAccounts} from "v2-core/src/SubAccounts.sol";
import {StandardManager} from "v2-core/src/risk-managers/StandardManager.sol";
import {SRMPortfolioViewer} from "v2-core/src/risk-managers/SRMPortfolioViewer.sol";

import {IScaledUiToken} from "../src/interfaces/IScaledUiToken.sol";
import {MarketDeployerBase} from "./MarketDeployerBase.sol";

/**
 * @title AddMainnetStagingRwaMarket
 * @notice Adds exactly one reviewed RWA market to the isolated chain-56 staging stack.
 *         The script never touches the older deployments/56.json stack and writes only
 *         a staging sidecar. The operator must merge that sidecar into the staging
 *         manifest with enabled=false before a separate activation step.
 *
 * Deployment order is intentionally fixed: XAU (market 2), SPY (3), NVDA (4).
 * This makes retries safe and prevents an accidental duplicate market registration.
 */
contract AddMainnetStagingRwaMarket is MarketDeployerBase {
    uint256 internal constant BSC_MAINNET_CHAIN_ID = 56;
    string internal constant REQUIRED_CONFIRMATION = "ADD_HEDGE_MAINNET_STAGING_RWA_CHAIN_56";
    address internal constant STAGING_PYTH = 0xdF21D137Aadc95588205586636710ca2890538d5;

    // Conservative pre-production aggregate position caps, expressed in display units.
    uint256 internal constant XAU_UI_POSITION_CAP = 0.05e18;
    uint256 internal constant SPY_UI_POSITION_CAP = 0.5e18;
    uint256 internal constant NVDA_UI_POSITION_CAP = 1e18;

    error WrongChain(uint256 expected, uint256 actual);
    error InvalidConfirmation();
    error InvalidDeployerKey();
    error InvalidMarket(string marketId);
    error WrongMarketSequence(uint256 expectedLastMarketId, uint256 actualLastMarketId);
    error DeploymentAuthorityMismatch();
    error FeedSignerMismatch();
    error BorrowingEnabled();
    error InvalidMultiplier();

    function run() external {
        if (block.chainid != BSC_MAINNET_CHAIN_ID) {
            revert WrongChain(BSC_MAINNET_CHAIN_ID, block.chainid);
        }
        if (
            keccak256(bytes(vm.envOr("MAINNET_STAGING_RWA_CONFIRM", string(""))))
                != keccak256(bytes(REQUIRED_CONFIRMATION))
        ) revert InvalidConfirmation();

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (deployerKey == 0) revert InvalidDeployerKey();
        address deployer = vm.addr(deployerKey);
        string memory marketId = vm.envOr("MARKET_ID", string(""));
        (uint256 expectedMarketId, uint256 uiPositionCap) = _stagingMarketConfig(marketId);
        MarketConfig memory cfg = getMarketConfigById(marketId);
        cfg = _applyStagingManifest(cfg);

        string memory deploymentPath = string.concat(vm.projectRoot(), "/deployments/staging/56.json");
        string memory deploymentJson = vm.readFile(deploymentPath);
        SubAccounts subAccounts = SubAccounts(vm.parseJsonAddress(deploymentJson, ".subAccounts"));
        StandardManager srm = StandardManager(vm.parseJsonAddress(deploymentJson, ".standardManager"));
        SRMPortfolioViewer srmViewer = SRMPortfolioViewer(vm.parseJsonAddress(deploymentJson, ".srmViewer"));
        feedSigner = vm.parseJsonAddress(deploymentJson, ".feedSigner");

        if (srm.owner() != deployer || srmViewer.owner() != deployer) {
            revert DeploymentAuthorityMismatch();
        }
        if (vm.envOr("FEED_SIGNER", feedSigner) != feedSigner) revert FeedSignerMismatch();
        if (srm.borrowingEnabled()) revert BorrowingEnabled();
        uint256 expectedPrevious = expectedMarketId - 1;
        if (srm.lastMarketId() != expectedPrevious) {
            revert WrongMarketSequence(expectedPrevious, srm.lastMarketId());
        }

        address underlying = _reviewedUnderlying(cfg);
        cfg.optionCap = _rawPositionCap(underlying, cfg.scaledUi, uiPositionCap);
        cfg.baseCap = cfg.optionCap;
        console2.log("chainId:          ", block.chainid);
        console2.log("deployer:         ", deployer);
        console2.log("feedSigner:       ", feedSigner);
        console2.log("market:           ", cfg.name);
        console2.log("expectedMarketId: ", expectedMarketId);
        console2.log("underlying:       ", underlying);
        console2.log("rawPositionCap:   ", cfg.optionCap);

        vm.startBroadcast(deployerKey);
        MarketDeployment memory deployed = _deployAndRegisterMarket(subAccounts, srm, srmViewer, underlying, cfg);
        vm.stopBroadcast();
        if (deployed.marketId != expectedMarketId) {
            revert WrongMarketSequence(expectedMarketId, deployed.marketId);
        }

        _writeStagingSidecar(cfg, underlying, deployed, uiPositionCap);
    }

    function _stagingMarketConfig(string memory marketId)
        internal
        pure
        returns (uint256 expectedMarketId, uint256 uiPositionCap)
    {
        bytes32 id = keccak256(bytes(marketId));
        if (id == keccak256("XAU")) return (2, XAU_UI_POSITION_CAP);
        if (id == keccak256("SPY")) return (3, SPY_UI_POSITION_CAP);
        if (id == keccak256("NVDA")) return (4, NVDA_UI_POSITION_CAP);
        revert InvalidMarket(marketId);
    }

    function _reviewedUnderlying(MarketConfig memory cfg) internal view returns (address token) {
        token = cfg.underlyingDefault;
        require(token != address(0) && token.code.length > 0, "staging token has no code");
        require(IERC20Metadata(token).decimals() == cfg.underlyingDecimals, "staging token decimals mismatch");
        require(
            keccak256(bytes(IERC20Metadata(token).symbol())) == keccak256(bytes(cfg.underlyingSymbol)),
            "staging token symbol mismatch"
        );
        if (cfg.scaledUi) {
            require(IERC165(token).supportsInterface(SCALED_UI_AMOUNT_INTERFACE_ID), "missing ERC-8056 core");
            require(IERC165(token).supportsInterface(SCALED_UI_PENDING_INTERFACE_ID), "missing ERC-8056 pending");
        }
    }

    function _applyStagingManifest(MarketConfig memory cfg) internal returns (MarketConfig memory) {
        string memory path = string.concat(vm.projectRoot(), "/deployments/staging/markets/56.json");
        string memory json = vm.readFile(path);
        require(vm.parseJsonUint(json, ".chainId") == BSC_MAINNET_CHAIN_ID, "staging manifest chain mismatch");
        uint256 length = vm.parseJsonUint(json, ".marketCount");
        bool found;
        for (uint256 i = 0; i < length; i++) {
            string memory base = string.concat(".markets[", vm.toString(i), "]");
            if (keccak256(bytes(vm.parseJsonString(json, string.concat(base, ".id")))) != keccak256(bytes(cfg.name))) {
                continue;
            }
            found = true;
            require(
                vm.parseJsonUint(json, string.concat(base, ".collateral.decimals")) == cfg.underlyingDecimals,
                "staging collateral decimals mismatch"
            );
            require(
                vm.parseJsonBool(json, string.concat(base, ".collateral.scaledUi")) == cfg.scaledUi,
                "staging scaledUi mismatch"
            );
            require(
                keccak256(bytes(vm.parseJsonString(json, string.concat(base, ".collateral.symbol"))))
                    == keccak256(bytes(cfg.underlyingSymbol)),
                "staging collateral symbol mismatch"
            );
            cfg.underlyingDefault = vm.parseJsonAddress(json, string.concat(base, ".collateral.address"));
            cfg.pythPriceId = vm.parseJsonBytes32(json, string.concat(base, ".pythPriceId"));
            break;
        }
        require(found, "market missing from staging manifest");
        require(cfg.underlyingDefault != address(0), "staging collateral address missing");
        require(cfg.pythPriceId != bytes32(0), "staging Pyth price id missing");
        return cfg;
    }

    function _rawPositionCap(address underlying, bool scaledUi, uint256 uiCap) internal view returns (uint256) {
        if (!scaledUi) return uiCap;
        uint256 multiplier = IScaledUiToken(underlying).uiMultiplier();
        if (multiplier == 0) revert InvalidMultiplier();
        uint256 rawCap = uiCap * 1e18 / multiplier;
        if (rawCap == 0) revert InvalidMultiplier();
        return rawCap;
    }

    function _writeStagingSidecar(
        MarketConfig memory cfg,
        address underlying,
        MarketDeployment memory m,
        uint256 uiPositionCap
    ) internal {
        string memory key = "market";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeString(key, "name", cfg.name);
        vm.serializeUint(key, "marketId", m.marketId);
        vm.serializeAddress(key, "underlying", underlying);
        vm.serializeAddress(key, "spotFeed", address(m.spotFeed));
        vm.serializeAddress(key, "forwardFeed", address(m.forwardFeed));
        vm.serializeAddress(key, "volFeed", address(m.volFeed));
        vm.serializeAddress(key, "rateFeed", address(m.rateFeed));
        vm.serializeAddress(key, "settlementFeed", address(m.settlementFeed));
        vm.serializeAddress(key, "liveSettlementFeed", m.liveSettlementFeed);
        vm.serializeAddress(key, "pythSpotFeed", address(m.pythSpotFeed));
        vm.serializeAddress(key, "scaledSpotFeed", address(m.scaledSpotFeed));
        vm.serializeAddress(key, "multiplierRegistry", address(m.multiplierRegistry));
        vm.serializeAddress(key, "benchmarkSettlementFeed", address(m.benchmarkSettlementFeed));
        vm.serializeAddress(key, "liveSpotFeed", m.liveSpotFeed);
        vm.serializeAddress(key, "optionAsset", address(m.option));
        vm.serializeBytes32(key, "pythPriceId", cfg.pythPriceId);
        vm.serializeAddress(key, "chainlinkAggregator", cfg.chainlinkAggregator);
        vm.serializeUint(key, "underlyingDecimals", cfg.underlyingDecimals);
        vm.serializeBool(key, "scaledUi", cfg.scaledUi);
        vm.serializeUint(key, "uiPositionCap", uiPositionCap);
        vm.serializeUint(key, "rawPositionCap", cfg.optionCap);
        string memory output = vm.serializeAddress(key, "baseAsset", address(m.base));

        string memory path = string.concat(vm.projectRoot(), "/deployments/staging/56-", cfg.name, ".json");
        vm.writeFile(path, output);
        console2.log("Staging market sidecar written to:", path);
    }

    function _pythAddress() internal pure override returns (address) {
        return STAGING_PYTH;
    }
}
