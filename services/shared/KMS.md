# AWS KMS signing for Hedge services

The feed-signer and trade-executor keys can live in AWS KMS instead of raw
`*_PRIVATE_KEY` env vars. `@hedge/shared` provides:

- `createKmsAccount({ keyId })` — a viem `LocalAccount` (source `"kms"`) backed
  by `kms:Sign` (ECDSA_SHA_256, MessageType DIGEST) with DER decoding, EIP-2
  low-s normalization and recovery-id derivation. Supports `sign`,
  `signMessage`, `signTypedData` (BaseLyraFeed FeedData + Matching Action) and
  `signTransaction` (including the chain-97 forced-legacy / 0.2 gwei path in
  `clients.ts`).
- `resolveAccount({ role, privateKey })` — returns a KMS account when
  `<ROLE>_KMS_KEY_ID` is set, else falls back to the raw key. Every service
  adopts KMS by env var alone.

> Status 2026-07-01: no AWS credentials were configured on the dev machine
> (`aws sts get-caller-identity` fails), so the keys below have **not** been
> created yet. Run the commands, then fill in the ARN/address table at the
> bottom.

## 1. Create the keys

Two separate keys — one per role — so IAM/CloudTrail can distinguish feed
posting from trade execution and each can be rotated/revoked independently.
Must be `ECC_SECG_P256K1` (secp256k1) + `SIGN_VERIFY`; KMS cannot import or
export these keys' private material.

```sh
# feed signer
FEED_KEY_ARN=$(aws kms create-key \
  --key-spec ECC_SECG_P256K1 \
  --key-usage SIGN_VERIFY \
  --description "Hedge oracle-feeds EIP-712 feed signer" \
  --tags TagKey=Project,TagValue=hedge \
  --query KeyMetadata.Arn --output text)
aws kms create-alias --alias-name alias/hedge-feed-signer --target-key-id "$FEED_KEY_ARN"

# trade executor
EXEC_KEY_ARN=$(aws kms create-key \
  --key-spec ECC_SECG_P256K1 \
  --key-usage SIGN_VERIFY \
  --description "Hedge rfq-engine trade executor" \
  --tags TagKey=Project,TagValue=hedge \
  --query KeyMetadata.Arn --output text)
aws kms create-alias --alias-name alias/hedge-executor --target-key-id "$EXEC_KEY_ARN"
```

Derive the Ethereum addresses with the shared code (any service env with AWS
credentials):

```sh
cd services
node --input-type=module -e '
import { createKmsAccount } from "@hedge/shared";
for (const alias of ["alias/hedge-feed-signer", "alias/hedge-executor"]) {
  const account = await createKmsAccount({ keyId: alias });
  console.log(alias, account.address);
}'
```

Sanity check (sign typed data + verify recovery, no chain needed):

```sh
node --input-type=module -e '
import { recoverTypedDataAddress } from "viem";
import { createKmsAccount } from "@hedge/shared";
const account = await createKmsAccount({ keyId: "alias/hedge-feed-signer" });
const domain = { name: "LyraSpotFeed", version: "1", chainId: 97, verifyingContract: "0x69662A47C3C2626EB75a8c861C48a0a87Cb01b2C" };
const types = { FeedData: [
  { name: "data", type: "bytes" }, { name: "deadline", type: "uint256" }, { name: "timestamp", type: "uint64" },
]};
const message = { data: "0x1234", deadline: 2000000000n, timestamp: 1750000000n };
const signature = await account.signTypedData({ domain, types, primaryType: "FeedData", message });
const recovered = await recoverTypedDataAddress({ domain, types, primaryType: "FeedData", message, signature });
console.log(account.address, recovered, recovered === account.address ? "OK" : "MISMATCH");'
```

## 2. IAM policy (minimal)

Grant each service principal `kms:Sign` + `kms:GetPublicKey` on its key only
(replace the ARNs; aliases are not valid in `Resource`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "HedgeKmsSignOnly",
      "Effect": "Allow",
      "Action": ["kms:Sign", "kms:GetPublicKey"],
      "Resource": [
        "arn:aws:kms:<region>:<account>:key/<feed-signer-key-id>",
        "arn:aws:kms:<region>:<account>:key/<executor-key-id>"
      ]
    }
  ]
}
```

Ideally split into two policies — oracle-feeds gets only the feed-signer key,
rfq-engine only the executor key. No `kms:CreateKey`, `kms:ScheduleKeyDeletion`,
`kms:PutKeyPolicy` etc. for service principals; key administration stays with a
separate admin role.

**CloudTrail:** every `kms:Sign` call is logged (principal, key ARN, time,
source IP) in CloudTrail's management events at no extra cost — you get an
audit trail of every feed print and every trade execution signature for free.
Consider a CloudWatch alarm on `Sign` calls from unexpected principals.

## 3. Env vars per service

Credentials come from the standard AWS chain (env vars, shared config,
IMDS/IRSA role — nothing key-specific in the service env beyond the key id).

| Service | Env | Effect |
|---|---|---|
| rfq-engine | `EXECUTOR_KMS_KEY_ID=alias/hedge-executor` | executor account from KMS (raw `EXECUTOR_PRIVATE_KEY` ignored) |
| rfq-engine | `EXECUTOR_KMS_REGION` (optional) | region override, else standard AWS chain |
| oracle-feeds | `FEED_SIGNER_KMS_KEY_ID=alias/hedge-feed-signer` | feed-signer account from KMS (once wired — see below) |
| oracle-feeds | `FEED_SIGNER_KMS_REGION` (optional) | region override |
| any | `AWS_REGION` / `AWS_PROFILE` / role creds | standard AWS credential/region chain |

`<ROLE>_KMS_KEY_ID` accepts a key id, key ARN, `alias/...` name or alias ARN.

### oracle-feeds wiring (pending — do not edit while the other agent is mid-flight)

`services/oracle-feeds/src/env.ts` `getFeedSignerAccount(chainId)` currently
returns `privateKeyToAccount(FEED_SIGNER_KEY)`. Replace it with (async):

```ts
import { resolveAccount } from "@hedge/shared";

export async function getFeedSignerAccount(chainId: number) {
  return resolveAccount({
    role: "FEED_SIGNER", // -> FEED_SIGNER_KMS_KEY_ID / FEED_SIGNER_KMS_REGION
    privateKey:
      process.env.FEED_SIGNER_KEY ?? (chainId === 31337 ? ANVIL_KEY_0 : null),
  });
}
```

and `await` it at the call sites. The returned account satisfies the existing
`FeedSigner` interface (`address` + `signTypedData`), so `signFeedData` and the
posting path (`makeWalletClient`, which forces legacy/0.2 gwei on 97) work
unchanged. Note KMS signing adds one `kms:Sign` round-trip (~10-50 ms) per feed
signature — fine at current posting cadence.

## 4. On-chain adoption (owner calls)

Both setters are `onlyOwner` — today that is the deployer EOA
(`0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB` on 97), after handover the Gnosis
Safe (`protocol/safe/`). Testnet sends need `--legacy --gas-price 200000000`.

### (a) Feeds — whitelist the KMS feed-signer address

`BaseLyraFeed.addSigner(address signer, bool isWhitelisted)` (onlyOwner), on
**each** signed feed (spot fallback, forward, vol, rate, USDT stable feed — see
`protocol/deployments/<chainId>.json`):

```sh
# repeat per feed address
cast send <feedAddress> "addSigner(address,bool)" <kmsFeedSignerAddress> true \
  --private-key $OWNER_KEY --legacy --gas-price 200000000 --rpc-url $RPC_URL
# verify
cast call <feedAddress> "isSigner(address)(bool)" <kmsFeedSignerAddress> --rpc-url $RPC_URL
```

The old signer can be de-whitelisted with the same call and `false` once the
new key is live (feeds check `signers.length >= requiredSigners`, 1-of-1 today).

Gas note: the **signer** and the **poster** are independent. The KMS key only
signs EIP-712 payloads; `acceptData` can be broadcast by any funded key
(oracle-feeds' current poster). If you want the KMS key to also post
transactions, fund its derived address with a little BNB for gas.

### (b) Executor — register the KMS executor address

The setter is `Matching.setTradeExecutor(address,bool)` (onlyOwner) — note
singular, not `setTradeExecutors` (verified against
`protocol/lib/v2-matching/src/Matching.sol:29`):

```sh
cast send <matchingAddress> "setTradeExecutor(address,bool)" <kmsExecutorAddress> true \
  --private-key $OWNER_KEY --legacy --gas-price 200000000 --rpc-url $RPC_URL
# verify (rfq-engine also checks this at startup)
cast call <matchingAddress> "tradeExecutors(address)(bool)" <kmsExecutorAddress> --rpc-url $RPC_URL
```

The executor **does** send transactions (`verifyAndMatch`), so fund the KMS
executor address with BNB for gas. Keep the old executor registered until the
KMS engine is confirmed live, then `setTradeExecutor(old, false)`.

On chain 97, `<matchingAddress>` = `0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285`
(see `protocol/TESTNET.md`).

## 5. Key inventory (fill in after creation)

| Role | Alias | Key ARN | Derived address |
|---|---|---|---|
| feed signer | `alias/hedge-feed-signer` | _pending_ | _pending_ |
| trade executor | `alias/hedge-executor` | _pending_ | _pending_ |

## Live key inventory (created 2026-07-01, us-east-1, account 985539774899)

| Alias | KeyId | Derived address | On-chain status (testnet 97) |
|---|---|---|---|
| `alias/hedge-feed-signer` | `2a6784b6-dbaa-4ab5-87ec-d3afbb5ad518` | `0x7dFC96d1b08eF29a99957EF99BF68F631348C667` | whitelisted via `addSigner` on all 5 signed feeds; proved live (KMS-signed feed post, spot tx `0xf057cc95...`) |
| `alias/hedge-executor` | `0bff19af-7994-4802-a844-442411384bf7` | `0x915949FeEBedE7196Ed5F35b5b23997be790171B` | registered via `Matching.setTradeExecutor`; funded 0.005 tBNB |

The legacy raw-key signer/executor (testnet-only, in gitignored `protocol/.env`) remain
whitelisted in parallel for now; rotate them out once services run in AWS with an IAM
role. ⚠️ Keys were created with ROOT credentials — before mainnet: create the scoped IAM
role from §4, attach it to the service host, and remove root access keys from this machine.
