#!/usr/bin/env bash
# Generates a Safe{Wallet} Transaction Builder batch JSON containing one
# acceptOwnership() call for every Ownable2Step contract of a Hedge deployment.
#
# Run this AFTER script/TransferOwnership.s.sol has initiated the transfers
# (it sets pendingOwner = Safe on every owned contract). Import the resulting
# JSON into the Safe web app -> Apps -> Transaction Builder -> "Upload batch",
# review, and execute as ONE batched Safe transaction.
#
# Schema: Safe Transaction Builder BatchFile (version 1.0) — verified against
# the tx-builder app source (safe-global/safe-react-apps, models.ts):
#   { version, chainId, createdAt, meta{...}, transactions[{to, value, data,
#     contractMethod{inputs,name,payable}, contractInputsValues}] }
# meta.checksum is optional; the Transaction Builder recomputes/validates on
# import and accepts files without it.
#
# Usage:
#   ./generate-accept-batch.sh <chainId> [safeAddress] [-o output.json]
# Examples:
#   ./generate-accept-batch.sh 97                       # -> safe/accept-ownership-batch.json
#   ./generate-accept-batch.sh 56 0xSafe...             # mainnet, stamps createdFromSafeAddress
#   ./generate-accept-batch.sh 31337 -o /tmp/batch.json # anvil validation run
#
# Reads deployments/<chainId>.json plus every AddMarket sidecar
# deployments/<chainId>-*.json. Requires jq.

set -euo pipefail

PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CHAIN_ID="${1:?usage: generate-accept-batch.sh <chainId> [safeAddress] [-o out.json]}"
shift
SAFE_ADDRESS=""
OUT="$PROTO_DIR/safe/accept-ownership-batch.json"
while [ $# -gt 0 ]; do
  case "$1" in
    -o) OUT="$2"; shift 2 ;;
    *) SAFE_ADDRESS="$1"; shift ;;
  esac
done

DEPLOYMENTS="$PROTO_DIR/deployments/$CHAIN_ID.json"
[ -f "$DEPLOYMENTS" ] || { echo "error: $DEPLOYMENTS not found" >&2; exit 1; }

# Every Ownable2Step contract written by DeployAll (see OWNERSHIP.md for the
# per-contract verification). btcPythSpotFeed is optional (added out-of-band
# on testnet; absent on fresh anvil deploys). NOT here: subAccounts,
# interestRateModel, optionSettlementHelper, settlementUtils, subAccountCreator
# (no owner), and the fee-recipient subaccount NFT (single-step ERC-721 —
# already moved by TransferOwnership.s.sol, nothing for the Safe to accept).
CORE_KEYS='[
  "cashAsset", "securityModule", "dutchAuction", "standardManager", "srmViewer",
  "stableFeed",
  "btcSpotFeed", "btcForwardFeed", "btcVolFeed", "btcRateFeed",
  "btcSettlementFeed", "btcOptionAsset", "btcBaseAsset", "btcPythSpotFeed",
  "matching", "depositModule", "withdrawalModule", "transferModule",
  "tradeModule", "rfqModule"
]'

ZERO="0x0000000000000000000000000000000000000000"

# addresses from the main deployments file (skip optional keys that are absent or zero)
ADDRS=$(jq -c --argjson keys "$CORE_KEYS" --arg zero "$ZERO" \
  '[.[$keys[]] | select(. != null and . != $zero)]' "$DEPLOYMENTS")

# AddMarket sidecars: signed feeds/assets plus the selected external spot and
# settlement adapters; provider-specific keys are optional/possibly zero.
for sidecar in "$PROTO_DIR/deployments/$CHAIN_ID"-*.json; do
  [ -f "$sidecar" ] || continue
  MORE=$(jq -c --arg zero "$ZERO" '[.spotFeed, .forwardFeed, .volFeed, .rateFeed,
    .settlementFeed, .pythSpotFeed, .chainlinkSpotFeed, .optionAsset, .baseAsset]
    | map(select(. != null and . != $zero))' "$sidecar")
  ADDRS=$(jq -cn --argjson a "$ADDRS" --argjson b "$MORE" '$a + $b')
  echo "included sidecar market: $sidecar" >&2
done

jq -n \
  --arg chainId "$CHAIN_ID" \
  --arg safe "$SAFE_ADDRESS" \
  --argjson createdAt "$(date +%s)000" \
  --argjson addrs "$ADDRS" '
{
  version: "1.0",
  chainId: $chainId,
  createdAt: $createdAt,
  meta: {
    name: ("Hedge: accept ownership (chain " + $chainId + ")"),
    description: "acceptOwnership() on every Ownable2Step Hedge contract. Run after script/TransferOwnership.s.sol set pendingOwner to this Safe. See protocol/OWNERSHIP.md.",
    txBuilderVersion: "1.18.0",
    createdFromSafeAddress: $safe,
    createdFromOwnerAddress: ""
  },
  transactions: ($addrs | map({
    to: .,
    value: "0",
    data: null,
    contractMethod: { inputs: [], name: "acceptOwnership", payable: false },
    contractInputsValues: null
  }))
}' > "$OUT"

echo "wrote $(jq '.transactions | length' "$OUT") acceptOwnership() calls -> $OUT" >&2
