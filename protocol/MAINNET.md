# BSC MAINNET deployment (chainId 56) — launch runbook

Status: **NOT DEPLOYED** — config verified + full deploy simulated 2026-07-01; the
deployer is not funded yet. Nothing has been broadcast to chain 56.

Companion docs: [`TESTNET.md`](TESTNET.md) (the live chain-97 stack this reproduces),
[`../services/shared/KMS.md`](../services/shared/KMS.md) (KMS key inventory).

## ⚠️ Warnings — read before broadcasting

- **Admin is a hot key until Safe handover.** Every owned contract (SRM, viewer, cash,
  assets, feeds, Matching, PythSpotFeed, AnchoredSettlementFeed) is owned by the
  deployer EOA from deploy until the `TransferOwnership` flow to the Gnosis Safe is
  executed and accepted (see [Ownership transfer](#7-ownership-transfer-to-the-safe-later)).
  A compromised deployer key before handover can repoint feeds, raise caps and drain.
- **`PythSpotFeed` and `AnchoredSettlementFeed` are UNAUDITED** in-house contracts
  (GPL-3.0-or-later, `protocol/src/`). They are unit-tested and live on testnet, but
  have not had an external diff-audit against the vendored Derive code. This is real
  money from the first deposit.
- **`protocol/.env` footgun.** Foundry auto-loads `protocol/.env`, whose
  `BTCB_ADDRESS`/`USDT_ADDRESS` point at the **testnet mocks** and would override the
  baked-in mainnet constants (shell env beats dotenv, dotenv beats constants). The
  simulation of 2026-07-01 caught exactly this — the deploy command below therefore
  sets both explicitly. The `require(decimals()==18)` guards revert on a no-code
  address, but do not rely on that alone.
- **KMS caveat** (from KMS.md): the KMS keys were created with root credentials;
  create the scoped IAM role and remove root access keys from the dev machine before
  running mainnet services.

## 1. Verified addresses (chain 56)

Every address was cross-checked against an official source **and** read back on-chain
on 2026-07-01 via `https://56.rpc.thirdweb.com/<key>` (`cast chain-id` = 56).

| What | Address | Official source | On-chain read (2026-07-01) |
|---|---|---|---|
| BTCB (base asset underlying) | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | bscscan.com/token/0x7130… — "Binance-Peg BTCB Token", verified source | `symbol()`="BTCB", `name()`="BTCB Token", `decimals()`=18 |
| USDT (cash asset) | `0x55d398326f99059fF775485246999027B3197955` | bscscan.com/token/0x55d3… — "Binance-Peg BSC-USD" | `symbol()`="USDT", `name()`="Tether USD", `decimals()`=18 |
| Pyth price feeds contract | `0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594` | docs.pyth.network/price-feeds/contract-addresses/evm → "BNB Smart Chain Mainnet" | `getValidTimePeriod()`=60; `getPriceUnsafe(BTC id)` = 60,755.95 e-8, publishTime 1782943292 (fresh, live) |
| Pyth `Crypto.BTC/USD` price id | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | hermes.pyth.network/v2/price_feeds?query=btc/usd → symbol `Crypto.BTC/USD` | (id, not a contract) — **identical to testnet**: Pyth price ids are chain-agnostic |
| Chainlink BTC/USD proxy | `0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf` | Chainlink reference data directory for docs.chain.link (feeds-bsc-mainnet.json): name "BTC / USD", 8 decimals | `description()`="BTC / USD", `decimals()`=8, `latestRoundData()` answer 60,747.22 e-8, updatedAt 1782943869 — 0.014% from Pyth at the same time |
| Chainlink ETH/USD proxy (config entry 1, not launching) | `0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e` | same directory: name "ETH / USD", 8 decimals | `description()`="ETH / USD", `decimals()`=8 |
| Pyth `Crypto.ETH/USD` price id | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | hermes.pyth.network/v2/price_feeds?query=eth/usd | (id) — chain-agnostic |

Note: the Chainlink directory also lists newer 18-decimal "shared server" BTC/USD and
ETH/USD variants (`0x14Aed…`, `0x06159…`). We deliberately use the long-standing
8-decimal push proxies above — `AnchoredSettlementFeed` binary-searches their deep
round history, and both contracts scale by `decimals()` so the 8-dec feeds are fully
supported.

All four contract addresses + both price ids are **baked into
`script/MarketDeployerBase.sol`** as `BSC_MAINNET_*` constants (selected when
`block.chainid == 56`), with `BTCB_ADDRESS` / `USDT_ADDRESS` / `PYTH_ADDRESS` env
overrides retained. The ETH market config entry has no baked-in underlying — adding
ETH on 56 requires `WETH_ADDRESS` (BSC's canonical "ETH" is Binance-Peg ETH; verify it
first).

## 2. Launch parameters

Caps are the **standard values from the vendored Derive mainnet config**
(`lib/v2-core/scripts/config-mainnet.sol`, `getSRMCaps`) — the same values the testnet
deployment uses:

| Param | Value | Source / note |
|---|---|---|
| BTC OptionAsset total position cap | `100_000e18` | `Config.getSRMCaps("BTC")` |
| BTCB base asset total position cap | `5e18` | `Config.getSRMCaps("BTC")` |
| ETH option / base caps (entry 1) | `2_000_000e18` / `250e18` | `Config.getSRMCaps("ETH")` |
| OI fee rate (`SRMPortfolioViewer.OIFeeRateBPS`) | `0.001e18` (0.1% of forward notional per side) | `MarketDeployerBase.OI_FEE_BPS` — the 10% test value bug is fixed at source (TESTNET.md "OI fee fix") |
| Min OI fee (`BaseManager.minOIFee`) | `10e18` | 10 USDT floor per side — see below |
| Margin / oracle-contingency / auction / IRM params | identical to testnet | inlined from `config-mainnet.sol` in the deploy scripts |

Caps remain **owner-adjustable post-deploy** via
`OptionAsset.setTotalPositionCap(srm, cap)` and
`WrappedERC20Asset.setTotalPositionCap(srm, cap)` (deployer EOA now, Safe after
handover).

**minOIFee units (verified in vendored source):** `BaseManager._payFee` transfers
`max(fee, minOIFee)` as a **CashAsset subaccount balance adjustment**, and CashAsset
converts all ERC-20 flows to 18-decimal internal units
(`stableAmount.to18Decimals(stableDecimals)` — `CashAsset.sol:179`). So `minOIFee` is
always 18-decimal *cash* (USD) units regardless of the token's decimals; with BSC USDT
at 18 decimals it is also numerically identical to the token amount. `10e18` = 10 USDT
floor, same as testnet.

## 3. Gas policy (chain 56)

BSC mainnet validators enforce a minimum gas price (floor 0.05 gwei since the 2024
repricing) and the chain reports a zero EIP-1559 base fee, so fee estimation is
unreliable. Policy — consistent across deploy tooling and services:

- **Forge broadcasts:** `--legacy --with-gas-price 100000000` (0.1 gwei — 2x the
  floor for reliable inclusion).
- **Services:** `services/shared/src/clients.ts` forces every write on chain 56 to a
  legacy tx at `BSC_MAINNET_GAS_PRICE = 100_000_000n` (0.1 gwei), exactly like the
  chain-97 quirk handling (which stays at 0.2 gwei). Covered by
  `services/shared/test/clients.test.ts`.

## 4. Simulated deploy (2026-07-01)

Full `DeployAll` simulation against **real mainnet state** (real BTCB/USDT
`decimals()` constructor reads, real Chainlink aggregator + Pyth contract feeding the
`AnchoredSettlementFeed`/`PythSpotFeed` constructors):

```sh
cd protocol
BTCB_ADDRESS=0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c \
USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955 \
forge script script/DeployAll.s.sol \
  --rpc-url https://56.rpc.thirdweb.com/<key> \
  --legacy --with-gas-price 100000000 --retries 12 --delay 5   # NO --broadcast
```

Result: **script ran successfully** — 84 transactions, 25 contract creations
(core + BTC market incl. `AnchoredSettlementFeed` + `PythSpotFeed` + matching stack).

- Estimated total gas: **57,580,105**
- Estimated cost at 0.1 gwei: **0.00576 BNB**

(The dry run writes `deployments/56.json` with *predicted* addresses; that file and
the `broadcast/.../dry-run` artifacts were deleted — the real file is produced by the
broadcast run.)

First simulation attempt failed with `call to non-contract address 0x32fCF6…` — the
testnet mock BTCB from `protocol/.env` overriding the baked constant. That is the
`.env` footgun in the warnings above; the explicit env vars in the command are the fix.

**Estimated total launch cost** (deploy 0.0058 + feeds bootstrap ~0.0002 + smoke trade
setup/trade ~0.002 + margin for retries): **≲ 0.01 BNB**. Fund the deployer with
**0.05 BNB** for comfortable headroom, plus ~0.01 BNB to the KMS executor address for
trade execution gas.

## 5. Deploy sequence

### 5.0 Preconditions

- Deployer `0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB` funded with ≥ 0.05 BNB.
- KMS keys live (KMS.md): feed signer `0x7dFC96d1b08eF29a99957EF99BF68F631348C667`,
  executor `0x915949FeEBedE7196Ed5F35b5b23997be790171B`; executor funded ~0.01 BNB.
- `RPC_URL_56=https://56.rpc.thirdweb.com/<key>` exported.

### 5.1 Deploy — one command

`FEED_SIGNER`/`TRADE_EXECUTOR` are set to the **KMS addresses at deploy time**, so the
KMS signer is whitelisted on every signed feed and the KMS executor registered on
Matching from genesis — no separate registration txs needed:

```sh
cd protocol
PRIVATE_KEY=$MAINNET_DEPLOYER_KEY \
FEED_SIGNER=0x7dFC96d1b08eF29a99957EF99BF68F631348C667 \
TRADE_EXECUTOR=0x915949FeEBedE7196Ed5F35b5b23997be790171B \
BTCB_ADDRESS=0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c \
USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955 \
forge script script/DeployAll.s.sol \
  --rpc-url $RPC_URL_56 --broadcast --legacy --with-gas-price 100000000 \
  --retries 12 --delay 5
```

Writes `deployments/56.json` (includes `pyth`, `btcPythPriceId`, `btcPythSpotFeed`,
`btcChainlinkAggregator`, `btcSettlementFeed` — same keys the services consume on 97).
Unlike testnet, the SRM's live spot feed is the **PythSpotFeed from genesis** (the
chain-97 post-deploy `setOraclesForMarket` swap is baked into the deploy script); the
signed LyraSpotFeed is deployed and configured as fallback only.

Post-deploy sanity reads:

```sh
D=deployments/56.json
cast call $(jq -r .standardManager $D) "owner()(address)" --rpc-url $RPC_URL_56   # deployer
cast call $(jq -r .matching $D) "tradeExecutors(address)(bool)" 0x915949FeEBedE7196Ed5F35b5b23997be790171B --rpc-url $RPC_URL_56  # true
cast call $(jq -r .btcForwardFeed $D) "isSigner(address)(bool)" 0x7dFC96d1b08eF29a99957EF99BF68F631348C667 --rpc-url $RPC_URL_56  # true
```

### 5.2 Feeds bootstrap

Signed feeds (forward/vol/rate + USDT stable — these drive margining; spot margining
comes from Pyth, settlement from Chainlink):

```sh
cd services
CHAIN_ID=56 RPC_URL=$RPC_URL_56 \
FEED_SIGNER_KMS_KEY_ID=alias/hedge-feed-signer \
FEED_POSTER_KEY=$MAINNET_DEPLOYER_KEY \
pnpm --filter @hedge/oracle-feeds post
```

Pyth push (required whenever the on-chain Pyth price is > 60s stale — other BSC
protocols push BTC/USD frequently, but never assume):

```sh
CHAIN_ID=56 RPC_URL=$RPC_URL_56 FEED_SIGNER_KEY=<any funded key> \
  pnpm --filter @hedge/oracle-feeds pyth-push
```

Verify the live oracle stack:

```sh
cast call $(jq -r .btcPythSpotFeed $D) "getSpot()(uint256,uint256)" --rpc-url $RPC_URL_56
# expect (BTC price ~1e18-scaled, confidence ~0.999e18); confidence 0 = Chainlink breaker tripped
```

### 5.3 KMS registration / rotation (only if 5.1 was run without the KMS env)

```sh
# feed signer — repeat per signed feed in deployments/56.json
# (btcSpotFeed fallback, btcForwardFeed, btcVolFeed, btcRateFeed, stableFeed)
cast send <feedAddress> "addSigner(address,bool)" 0x7dFC96d1b08eF29a99957EF99BF68F631348C667 true \
  --private-key $MAINNET_DEPLOYER_KEY --legacy --gas-price 100000000 --rpc-url $RPC_URL_56

# executor
cast send $(jq -r .matching $D) "setTradeExecutor(address,bool)" 0x915949FeEBedE7196Ed5F35b5b23997be790171B true \
  --private-key $MAINNET_DEPLOYER_KEY --legacy --gas-price 100000000 --rpc-url $RPC_URL_56
```

### 5.4 Smoke trade — tiny size (0.01 BTCB ≈ $600 notional)

Mainnet variant of the chain-97 smoke (TESTNET.md "Live smoke trade"), with real
tokens and 0.01 size:

1. Fund a maker EOA (≥ 50 USDT + gas) and a taker EOA (0.01 BTCB + gas). Real funds —
   use fresh keys, not the testnet keys committed to `.env`.
2. Maker: `pnpm --filter @hedge/maker-bot dev -- --setup` with `CHAIN_ID=56` — creates
   a subaccount and deposits USDT cash.
3. Taker: create subaccount via Matching, approve + `WrappedERC20Asset.deposit` of
   `0.01e18` BTCB.
4. Post feeds (5.2) + pyth-push, then run one RFQ covered call
   (~110% strike, near expiry) for **0.01 contracts** through rfq-engine with the KMS
   executor.
5. Assert on-chain: option balances ±0.01, premium paid, OI fee = **10 USDT per side**
   (the `minOIFee` floor dominates: 0.1% × ~$600 = $0.60 < $10), taker cash ≈
   premium − 10.
6. After expiry: `fixSettlementPrice(expiry)` on `btcSettlementFeed` (permissionless)
   and `oracle-feeds settle --expiry <unix> --subaccounts <maker>,<taker>` —
   proves the anchored settlement path end-to-end on mainnet.

### 5.5 Services cutover

Each service env: `CHAIN_ID=56`, `RPC_URL=$RPC_URL_56`,
`DEPLOYMENTS_PATH=protocol/deployments/56.json`, KMS key ids per KMS.md §3. The shared
clients force legacy/0.1 gwei on 56 automatically — no service code changes needed.

## 6. What is NOT deployed

- **LiquidateModule** — UNLICENSED at the vendored pin (see PROVENANCE.md), same as
  testnet. Liquidations run through DutchAuction directly.
- **ETH market** — config entry 1 exists (verified mainnet aggregator baked in) but is
  not part of DeployAll; add later via
  `MARKET_INDEX=1 WETH_ADDRESS=<verified> forge script script/AddMarket.s.sol …`.

## 7. Ownership transfer to the Safe (LATER)

After the smoke trade proves the stack, hand every owned contract to the Gnosis Safe
using the existing tooling (initiates Ownable2Step transfers + moves the fee-recipient
subaccount NFT):

```sh
SAFE_ADDRESS=<bsc-mainnet safe> PRIVATE_KEY=$MAINNET_DEPLOYER_KEY \
forge script script/TransferOwnership.s.sol \
  --rpc-url $RPC_URL_56 --broadcast --legacy --with-gas-price 100000000
# then: Safe executes the accept-ownership batch (protocol/safe/, regenerate for 56)
# verify: SAFE_ADDRESS=... forge script script/TransferOwnership.s.sol --sig "verify()" --rpc-url $RPC_URL_56
```

Until the Safe has **accepted**, the deployer EOA remains owner of everything —
including `OptionAsset.setSettlementFeed`, the one owner power that can repoint
settlement (see AnchoredSettlementFeed trust model in TESTNET.md).

## LIVE (deployed 2026-07-01)

All 84 txs executed; addresses in `deployments/56.json`. Key contracts:
Matching `0xEAC4A53145969191833Eefd007A2255e0Cc0bD55`, RfqModule
`0x5d9e4EbD7E28deEF6f9A1a89Ed7Ce8608EE9074F`, SRM `0x8ACC382c9e7a22A63D16C92Ac5377D8F3550e2dA`,
PythSpotFeed `0x7AbcBc77B693b31B42F7f8F7ed31455130a5fd5B`, AnchoredSettlementFeed
`0x60DA363fc601650AaB4fB28852F3B878CcdA2277`.

Genesis state verified on-chain: RfqModule whitelisted, KMS executor
(`0x9159...171B`) registered, KMS feed signer (`0x7dFC...C667`) whitelisted on all
feeds and funded. Oracle bootstrap complete: Pyth push (getSpot $60,143 conf 0.9997,
Chainlink 0.014% away), signed fwd/rate/vol posted for expiries 1783065600,
1783670400, 1784275200, 1784880000 (flat 55% IV, 5% rate), USDT stable = 1.0
(`0x4a73f43d...b0db`).

Pending: real-BTCB smoke trade, Safe ownership handover, diff-audit of
PythSpotFeed + AnchoredSettlementFeed, services off-laptop (AWS), frontend
mainnet repoint.
