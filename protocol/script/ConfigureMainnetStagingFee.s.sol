// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {StandardManager} from "v2-core/src/risk-managers/StandardManager.sol";

/**
 * @title ConfigureMainnetStagingFee
 * @notice Reduces only the isolated chain-56 staging deployment's minimum OI
 *         fee so deliberately tiny real-asset smoke trades can exercise the
 *         normal percentage fee and margin path.
 *
 *         The 0.1% OI fee rate is not changed. This script refuses any manager,
 *         owner, chain, or current minimum other than the reviewed staging
 *         values, and is idempotent once the 0.01 USDT minimum is installed.
 *
 * Usage (simulate first, then add --broadcast):
 *   MAINNET_STAGING_FEE_CONFIRM=SET_HEDGE_MAINNET_STAGING_MIN_OI_FEE_0_01 \
 *   PRIVATE_KEY=<staging-deployer-key> \
 *     forge script script/ConfigureMainnetStagingFee.s.sol \
 *       --rpc-url "$RPC_URL_56" -vvvv
 */
contract ConfigureMainnetStagingFee is Script {
  uint256 public constant BSC_MAINNET_CHAIN_ID = 56;
  uint256 public constant EXPECTED_CURRENT_MIN_OI_FEE = 10e18;
  uint256 public constant STAGING_SMOKE_MIN_OI_FEE = 0.01e18;
  address public constant STAGING_STANDARD_MANAGER =
    0x7d77e5271B369971662A415795636559eFE43cE5;
  address public constant STAGING_OWNER =
    0x1DDAACC770033feCfcFE2a43e3C2a73b8fe3edFd;
  string public constant REQUIRED_CONFIRMATION =
    "SET_HEDGE_MAINNET_STAGING_MIN_OI_FEE_0_01";

  error WrongChain(uint256 expected, uint256 actual);
  error InvalidConfirmation();
  error InvalidOwnerKey();
  error DeploymentChainMismatch(uint256 actual);
  error DeploymentManagerMismatch(address actual);
  error DeploymentOwnerMismatch(address actual);
  error BroadcasterMismatch(address actual);
  error LiveOwnerMismatch(address actual);
  error UnexpectedCurrentMinOIFee(uint256 actual);
  error PostConfigurationMismatch(uint256 actual);

  function run() external {
    _validateChain(block.chainid);
    _validateConfirmation(vm.envOr("MAINNET_STAGING_FEE_CONFIRM", string("")));

    uint256 ownerKey = vm.envOr("PRIVATE_KEY", uint256(0));
    if (ownerKey == 0) revert InvalidOwnerKey();
    address broadcaster = vm.addr(ownerKey);

    string memory defaultPath =
      string.concat(vm.projectRoot(), "/deployments/staging/56.json");
    string memory path = vm.envOr("STAGING_DEPLOYMENT_PATH", defaultPath);
    string memory json = vm.readFile(path);
    uint256 deploymentChainId = vm.parseJsonUint(json, ".chainId");
    address managerAddress = vm.parseJsonAddress(json, ".standardManager");
    address deploymentOwner = vm.parseJsonAddress(json, ".deployer");

    _validateDeployment(deploymentChainId, managerAddress, deploymentOwner, broadcaster);
    require(managerAddress.code.length > 0, "staging manager has no code");

    StandardManager manager = StandardManager(managerAddress);
    address liveOwner = manager.owner();
    if (liveOwner != STAGING_OWNER) revert LiveOwnerMismatch(liveOwner);

    uint256 current = manager.minOIFee();
    if (current == STAGING_SMOKE_MIN_OI_FEE) {
      console2.log("MAINNET STAGING MINIMUM OI FEE ALREADY CONFIGURED");
      console2.log("standardManager:", managerAddress);
      console2.log("minOIFee:", current);
      return;
    }
    if (current != EXPECTED_CURRENT_MIN_OI_FEE) {
      revert UnexpectedCurrentMinOIFee(current);
    }

    console2.log("chainId:", block.chainid);
    console2.log("standardManager:", managerAddress);
    console2.log("owner:", broadcaster);
    console2.log("current minOIFee:", current);
    console2.log("new minOIFee:", STAGING_SMOKE_MIN_OI_FEE);
    console2.log("OI fee rate remains unchanged at 0.1%");

    vm.startBroadcast(ownerKey);
    manager.setMinOIFee(STAGING_SMOKE_MIN_OI_FEE);
    vm.stopBroadcast();

    uint256 configured = manager.minOIFee();
    if (configured != STAGING_SMOKE_MIN_OI_FEE) {
      revert PostConfigurationMismatch(configured);
    }
    console2.log("MAINNET STAGING MINIMUM OI FEE CONFIGURED");
  }

  function _validateChain(uint256 chainId) internal pure {
    if (chainId != BSC_MAINNET_CHAIN_ID) revert WrongChain(BSC_MAINNET_CHAIN_ID, chainId);
  }

  function _validateConfirmation(string memory confirmation) internal pure {
    if (keccak256(bytes(confirmation)) != keccak256(bytes(REQUIRED_CONFIRMATION))) {
      revert InvalidConfirmation();
    }
  }

  function _validateDeployment(
    uint256 chainId,
    address manager,
    address deploymentOwner,
    address broadcaster
  ) internal pure {
    if (chainId != BSC_MAINNET_CHAIN_ID) revert DeploymentChainMismatch(chainId);
    if (manager != STAGING_STANDARD_MANAGER) revert DeploymentManagerMismatch(manager);
    if (deploymentOwner != STAGING_OWNER) revert DeploymentOwnerMismatch(deploymentOwner);
    if (broadcaster != STAGING_OWNER) revert BroadcasterMismatch(broadcaster);
  }
}
