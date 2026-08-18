// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {Ownable2Step} from "openzeppelin/access/Ownable2Step.sol";
import {IERC721} from "openzeppelin/token/ERC721/IERC721.sol";

/**
 * @title TransferOwnership
 * @notice Hands every owned contract of a Hedge deployment over to a Gnosis Safe.
 *
 *         Every owned contract in this system is OpenZeppelin Ownable2Step (verified
 *         per contract — see OWNERSHIP.md), so this script only *initiates* the
 *         transfers: it calls transferOwnership(SAFE_ADDRESS) on each contract, which
 *         sets pendingOwner. The Safe must then execute acceptOwnership() on every
 *         contract to finish the handover — use the pre-built Transaction Builder
 *         batch in safe/accept-ownership-batch.json (regenerate per chain with
 *         safe/generate-accept-batch.sh). Until acceptance, the deployer EOA REMAINS
 *         owner and can cancel by calling transferOwnership(deployer) on itself.
 *
 *         The fee-recipient subaccount is an ERC-721 in SubAccounts owned directly by
 *         the deployer EOA (DeployAll: subAccounts.createAccount(deployer, srm)); its
 *         NFT is transferred to the Safe in the same run (single-step, plain
 *         transferFrom — no acceptance needed).
 *
 *         NOT owned / nothing to transfer (verified from vendored source):
 *         SubAccounts, InterestRateModel, OptionSettlementHelper, LyraSettlementUtils,
 *         SubAccountCreator, and the SecurityModule subaccount NFT (held by the
 *         SecurityModule contract itself, so it follows SecurityModule's owner).
 *
 * Usage (initiate transfers):
 *   SAFE_ADDRESS=0x... forge script script/TransferOwnership.s.sol \
 *     --rpc-url <rpc> --broadcast [--legacy --with-gas-price 200000000]
 *
 * Usage (read-only verification table, e.g. after the Safe accepted):
 *   SAFE_ADDRESS=0x... forge script script/TransferOwnership.s.sol \
 *     --sig "verify()" --rpc-url <rpc>
 *
 * Env:
 *   SAFE_ADDRESS    required — the Gnosis Safe receiving ownership
 *   PRIVATE_KEY     current owner (deployer) key; default anvil key 0 on 31337
 *   MARKET_NAMES    optional comma list of AddMarket sidecar markets to include,
 *                   e.g. "ETH" reads deployments/<chainId>-ETH.json
 *   ALLOW_EOA_SAFE  set true to allow a SAFE_ADDRESS with no code off-anvil
 *                   (anvil chainId 31337 always allows EOAs, for testing)
 */
contract TransferOwnership is Script {
  // anvil well-known account #0 — dev default only (matches DeployAll)
  uint internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

  struct Target {
    string name;
    address addr;
  }

  Target[] internal targets;
  IERC721 internal subAccounts;
  uint internal feeRecipientSubAccount;

  // ---------------------------------------------------------------------------
  // Entry points
  // ---------------------------------------------------------------------------

  function run() external {
    address safe = vm.envAddress("SAFE_ADDRESS");
    uint ownerKey = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
    address broadcaster = vm.addr(ownerKey);

    require(safe != address(0), "SAFE_ADDRESS is zero");
    require(safe != broadcaster, "SAFE_ADDRESS equals the current owner key");
    if (block.chainid != 31337 && !vm.envOr("ALLOW_EOA_SAFE", false)) {
      // a real Safe is a contract; catches fat-fingered / not-yet-deployed addresses
      require(safe.code.length > 0, "SAFE_ADDRESS has no code (set ALLOW_EOA_SAFE=true to override)");
    }

    _collectTargets();

    console2.log("chainId:    ", block.chainid);
    console2.log("broadcaster:", broadcaster);
    console2.log("safe:       ", safe);
    console2.log("targets:    ", targets.length);
    console2.log("");

    vm.startBroadcast(ownerKey);

    for (uint i = 0; i < targets.length; i++) {
      Ownable2Step c = Ownable2Step(targets[i].addr);
      address owner = c.owner();
      if (owner == safe) {
        console2.log(string.concat("skip (already owned by safe):   ", targets[i].name));
        continue;
      }
      if (c.pendingOwner() == safe) {
        console2.log(string.concat("skip (already pending to safe): ", targets[i].name));
        continue;
      }
      require(owner == broadcaster, string.concat(targets[i].name, ": broadcaster is not the current owner"));
      c.transferOwnership(safe); // Ownable2Step: sets pendingOwner, owner unchanged
      console2.log(string.concat("transferOwnership -> safe:      ", targets[i].name));
    }

    // fee-recipient subaccount NFT (single-step ERC-721 transfer).
    // transferFrom (not safeTransferFrom) on purpose: works for EOA test safes and
    // for real Safes regardless of fallback-handler configuration.
    address nftOwner = subAccounts.ownerOf(feeRecipientSubAccount);
    if (nftOwner == broadcaster) {
      subAccounts.transferFrom(broadcaster, safe, feeRecipientSubAccount);
      console2.log("feeRecipientSubAccount NFT transferred to safe");
    } else if (nftOwner == safe) {
      console2.log("skip (already owned by safe):   feeRecipientSubAccount NFT");
    } else {
      revert("feeRecipientSubAccount NFT is held by neither broadcaster nor safe");
    }

    vm.stopBroadcast();

    console2.log("");
    bool allDone = _printVerification(safe);
    console2.log("");
    if (allDone) {
      console2.log("HANDOVER COMPLETE: the Safe owns every owned contract.");
    } else {
      console2.log("TRANSFERS INITIATED. All owned contracts are Ownable2Step:");
      console2.log("the Safe must now execute acceptOwnership() on every PENDING row.");
      console2.log("Import safe/accept-ownership-batch.json into the Safe Transaction");
      console2.log("Builder (regenerate per chain: safe/generate-accept-batch.sh).");
    }
  }

  /// @dev read-only verification table; reverts if any contract points at neither
  ///      the Safe (owner) nor pending-to-Safe. Run with --sig "verify()".
  function verify() external {
    address safe = vm.envAddress("SAFE_ADDRESS");
    _collectTargets();
    console2.log("chainId:", block.chainid);
    console2.log("safe:   ", safe);
    console2.log("");
    bool ok = _printVerification(safe);
    require(ok || _allPendingOrDone(safe), "verification failed: see MISMATCH rows above");
  }

  // ---------------------------------------------------------------------------
  // Target collection (deployments/<chainId>.json + optional market sidecars)
  // ---------------------------------------------------------------------------

  function _collectTargets() internal {
    string memory path =
      string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    string memory json = vm.readFile(path);

    subAccounts = IERC721(vm.parseJsonAddress(json, ".subAccounts"));
    feeRecipientSubAccount = vm.parseJsonUint(json, ".feeRecipientSubAccount");

    // ---- core (all verified Ownable2Step) ----
    _add(json, "cashAsset");
    _add(json, "securityModule");
    _add(json, "dutchAuction");
    _add(json, "standardManager");
    _add(json, "srmViewer");
    _add(json, "stableFeed");

    // ---- BTC market ----
    _add(json, "btcSpotFeed");
    _add(json, "btcForwardFeed");
    _add(json, "btcVolFeed");
    _add(json, "btcRateFeed");
    _add(json, "btcOptionAsset");
    _add(json, "btcBaseAsset");
    // Optional keys: PythSpotFeed is deployed/wired out-of-band on testnet (key absent on
    // older/anvil deploys); AnchoredSettlementFeed (btcSettlementFeed) is written by newer
    // DeployAll runs and may be the zero address on plain anvil (signed fallback).
    _addOptional(json, "btcPythSpotFeed");
    _addOptional(json, "btcSettlementFeed");

    // ---- matching stack ----
    _add(json, "matching");
    _add(json, "depositModule");
    _add(json, "withdrawalModule");
    _add(json, "transferModule");
    _add(json, "tradeModule");
    _add(json, "rfqModule");

    // ---- AddMarket sidecar markets (deployments/<chainId>-<NAME>.json) ----
    string memory marketNames = vm.envOr("MARKET_NAMES", string(""));
    string[] memory names = _split(marketNames, bytes1(","));
    for (uint i = 0; i < names.length; i++) {
      string memory mPath =
        string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), "-", names[i], ".json");
      string memory mJson = vm.readFile(mPath);
      _addAs(mJson, "spotFeed", string.concat(names[i], ".spotFeed"));
      _addAs(mJson, "forwardFeed", string.concat(names[i], ".forwardFeed"));
      _addAs(mJson, "volFeed", string.concat(names[i], ".volFeed"));
      _addAs(mJson, "rateFeed", string.concat(names[i], ".rateFeed"));
      _addOptionalAs(mJson, "settlementFeed", string.concat(names[i], ".settlementFeed"));
      _addOptionalAs(mJson, "pythSpotFeed", string.concat(names[i], ".pythSpotFeed"));
      _addOptionalAs(mJson, "chainlinkSpotFeed", string.concat(names[i], ".chainlinkSpotFeed"));
      _addAs(mJson, "optionAsset", string.concat(names[i], ".optionAsset"));
      _addAs(mJson, "baseAsset", string.concat(names[i], ".baseAsset"));
    }
  }

  function _add(string memory json, string memory key) internal {
    _addAs(json, key, key);
  }

  function _addAs(string memory json, string memory key, string memory label) internal {
    targets.push(Target({name: label, addr: vm.parseJsonAddress(json, string.concat(".", key))}));
  }

  /// @dev key may be absent (older deployments JSON) or the zero address (feature disabled)
  function _addOptional(string memory json, string memory key) internal {
    _addOptionalAs(json, key, key);
  }

  function _addOptionalAs(string memory json, string memory key, string memory label) internal {
    if (!_hasKey(json, key)) return;
    address addr = vm.parseJsonAddress(json, string.concat(".", key));
    if (addr == address(0)) return;
    targets.push(Target({name: label, addr: addr}));
  }

  // ---------------------------------------------------------------------------
  // Verification table
  // ---------------------------------------------------------------------------

  /// @return allDone true iff the Safe is the *accepted* owner of everything
  function _printVerification(address safe) internal view returns (bool allDone) {
    allDone = true;
    console2.log("=== post-transfer verification ===============================================");
    console2.log(
      string.concat(_pad("contract", 26), _pad("owner()", 44), _pad("pendingOwner()", 44), "status")
    );
    for (uint i = 0; i < targets.length; i++) {
      Ownable2Step c = Ownable2Step(targets[i].addr);
      address owner = c.owner();
      address pending = c.pendingOwner();
      string memory status;
      if (owner == safe) {
        status = "DONE";
      } else if (pending == safe) {
        status = "PENDING (safe must acceptOwnership)";
        allDone = false;
      } else {
        status = "MISMATCH";
        allDone = false;
      }
      console2.log(
        string.concat(
          _pad(targets[i].name, 26), _pad(vm.toString(owner), 44), _pad(vm.toString(pending), 44), status
        )
      );
    }
    // fee-recipient subaccount NFT (single-step; no pending state)
    address nftOwner = subAccounts.ownerOf(feeRecipientSubAccount);
    console2.log(
      string.concat(
        _pad(string.concat("feeRecipient subacc #", vm.toString(feeRecipientSubAccount)), 26),
        _pad(vm.toString(nftOwner), 44),
        _pad("-", 44),
        nftOwner == safe ? "DONE" : "MISMATCH"
      )
    );
    if (nftOwner != safe) allDone = false;
    console2.log("==============================================================================");
  }

  /// @dev acceptable end-state for run(): everything DONE or PENDING-to-safe,
  ///      and the NFT (which has no pending state) already moved.
  function _allPendingOrDone(address safe) internal view returns (bool ok) {
    ok = true;
    for (uint i = 0; i < targets.length; i++) {
      Ownable2Step c = Ownable2Step(targets[i].addr);
      if (c.owner() != safe && c.pendingOwner() != safe) ok = false;
    }
    if (subAccounts.ownerOf(feeRecipientSubAccount) != safe) ok = false;
  }

  // ---------------------------------------------------------------------------
  // string helpers (pinned forge-std has no keyExists / string split cheatcodes)
  // ---------------------------------------------------------------------------

  function _hasKey(string memory json, string memory key) internal pure returns (bool) {
    return _indexOf(bytes(json), bytes(string.concat('"', key, '"'))) >= 0;
  }

  function _indexOf(bytes memory haystack, bytes memory needle) internal pure returns (int) {
    if (needle.length == 0 || haystack.length < needle.length) return -1;
    for (uint i = 0; i <= haystack.length - needle.length; i++) {
      bool found = true;
      for (uint j = 0; j < needle.length; j++) {
        if (haystack[i + j] != needle[j]) {
          found = false;
          break;
        }
      }
      if (found) return int(i);
    }
    return -1;
  }

  function _split(string memory s, bytes1 sep) internal pure returns (string[] memory) {
    bytes memory b = bytes(s);
    if (b.length == 0) return new string[](0);
    uint parts = 1;
    for (uint i = 0; i < b.length; i++) {
      if (b[i] == sep) parts++;
    }
    string[] memory out = new string[](parts);
    uint start = 0;
    uint idx = 0;
    for (uint i = 0; i <= b.length; i++) {
      if (i == b.length || b[i] == sep) {
        bytes memory part = new bytes(i - start);
        for (uint j = start; j < i; j++) {
          part[j - start] = b[j];
        }
        out[idx++] = string(part);
        start = i + 1;
      }
    }
    return out;
  }

  function _pad(string memory s, uint width) internal pure returns (string memory) {
    bytes memory b = bytes(s);
    if (b.length >= width) return string.concat(s, " ");
    bytes memory out = new bytes(width);
    for (uint i = 0; i < width; i++) {
      out[i] = i < b.length ? b[i] : bytes1(" ");
    }
    return string(out);
  }
}
