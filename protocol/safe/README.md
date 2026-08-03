# Safe handover artifacts

Tooling for moving Hedge contract ownership from the deployer EOA to a Gnosis Safe.
Full inventory, runbook and rollback notes: [`../OWNERSHIP.md`](../OWNERSHIP.md).

## Files

| File | What |
|---|---|
| `accept-ownership-batch.json` | Safe **Transaction Builder** batch for chain **97**: one `acceptOwnership()` call per Ownable2Step contract (19 on testnet). Import → review → execute as ONE Safe transaction. |
| `generate-accept-batch.sh` | Regenerates the batch for any chain from `deployments/<chainId>.json` (+ every `deployments/<chainId>-*.json` AddMarket sidecar). Requires `jq`. |

## Flow

```sh
# 1. initiate the two-step transfers (deployer key; sets pendingOwner = Safe everywhere,
#    and moves the fee-recipient subaccount NFT, which is single-step):
SAFE_ADDRESS=0x... forge script script/TransferOwnership.s.sol \
  --rpc-url <rpc> --broadcast --legacy --with-gas-price 200000000

# 2. regenerate the acceptance batch for the chain:
./safe/generate-accept-batch.sh 97 0x<safeAddress>        # writes accept-ownership-batch.json

# 3. Safe web app -> Apps -> Transaction Builder -> upload the JSON ->
#    simulate -> collect signatures -> execute (one batched tx).

# 4. verify the end state (all rows DONE):
SAFE_ADDRESS=0x... forge script script/TransferOwnership.s.sol --sig "verify()" --rpc-url <rpc>
```

The batch JSON follows the Transaction Builder `BatchFile` v1.0 schema
(`{version, chainId, createdAt, meta, transactions[{to, value, data,
contractMethod, contractInputsValues}]}`); `meta.checksum` is optional and
recomputed by the app on import. Addresses are passed through EIP-55
checksummed from the deployments JSON (forge writes them checksummed).

`chainId` in the file must match the Safe's chain or the app refuses the
import — always regenerate per chain, never hand-edit addresses.
