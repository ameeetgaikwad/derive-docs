// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockScaledToken} from "./mocks/MockScaledToken.sol";

/** @notice Deploys faucet-style RWA collateral on BSC testnet only. Never use on mainnet. */
contract DeployRwaMocks is Script {
  uint internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

  function run() external {
    require(block.chainid == 97 || block.chainid == 31337, "RWA mocks are testnet-only");
    uint deployerKey = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
    vm.startBroadcast(deployerKey);
    MockERC20 xaut = new MockERC20("Test Gold", "XAUt", 6);
    MockScaledToken spyb = new MockScaledToken("Test S&P 500", "SPYB", 1e18);
    MockScaledToken nvdab = new MockScaledToken("Test NVIDIA", "NVDAB", 1e18);
    MockScaledToken spcxb = new MockScaledToken("Test SpaceX", "SPCXB", 1e18);
    vm.stopBroadcast();

    string memory key = "rwaMocks";
    vm.serializeUint(key, "chainId", block.chainid);
    vm.serializeAddress(key, "xaut", address(xaut));
    vm.serializeAddress(key, "spyb", address(spyb));
    vm.serializeAddress(key, "nvdab", address(nvdab));
    string memory json = vm.serializeAddress(key, "spcxb", address(spcxb));
    string memory path = string.concat(
      vm.projectRoot(), "/deployments/", vm.toString(block.chainid), "-rwa-mocks.json"
    );
    vm.writeFile(path, json);
    console2.log("RWA mock addresses written to:", path);
  }
}
