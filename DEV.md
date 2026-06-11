# DEV — local runbook (frontend on sats-options, BSC testnet)

The frontend is a Next.js app that talks to the **sats-options** protocol on
**BSC testnet (chainId 97)** — addresses in `protocol/deployments/97.json`,
deployment notes in `protocol/TESTNET.md`. The user's EOA does everything:
regular transactions for setup (subaccount, approve, deposit, faucet mint) and
EIP-712 typed-data signatures for protocol Actions (the RFQ taker order).
No AA wallets, session keys, paymaster or bridging.

## What has to run

| Component | Purpose | Port |
|---|---|---|
| services/oracle-feeds | posts signed spot/forward/vol/rate to the on-chain feeds; runs settlement at expiry | — |
| services/rfq-engine | RFQ auction REST/WS + on-chain trade executor | 3030 |
| services/maker-bot | reference market maker that quotes the RFQs | — |
| frontend (`pnpm dev`) | the covered-call UI | 3000 |

All keys live in **`protocol/.env`** (testnet-only, never committed to the
frontend): `PRIVATE_KEY` (deployer = trade executor = feed poster),
`FEED_SIGNER_KEY`, `TESTNET_MAKER_KEY`, `TESTNET_TAKER_KEY`.
**Never put any private key in frontend code or `NEXT_PUBLIC_*` env vars.**

## 0. One-time

```sh
cd services && pnpm install && pnpm build      # builds shared + all services
cd ..       && pnpm install                    # frontend deps
```

## 1. oracle-feeds — post feeds for the expiries the UI shows

The frontend board is generated locally: **next 4 Fridays at 08:00 UTC**.
Feeds (forward/vol/rate) are per-expiry, so post for those expiries. Compute
them:

```sh
node -e '
const out=[];const d=new Date();const c=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),8));
c.setUTCDate(c.getUTCDate()+((5-c.getUTCDay()+7)%7));
while(out.length<4){const e=Math.floor(c/1000);if(e-Date.now()/1000>86400)out.push(e);c.setUTCDate(c.getUTCDate()+7);}
console.log(out.join(" "))'
```

One-shot snapshot (spot + forward + flat 60% IV surface + 5% rate per expiry;
`--expiry` is repeatable):

```sh
cd services
source ../protocol/.env
export CHAIN_ID=97 RPC_URL=$RPC_URL_97_THIRDWEB FEED_SIGNER_KEY
pnpm --filter @sats-options/oracle-feeds post -- \
  --spot 62790 --iv 0.6 --rate 0.05 \
  --expiry <fri1> --expiry <fri2> --expiry <fri3> --expiry <fri4>
```

Then keep them fresh with the daemon (feeds have an on-chain heartbeat — a
stale spot makes `getSpot` revert and the UI will show "No on-chain spot
price" and fall back to defaults for IV):

```sh
SPOT_PRICE=62790 pnpm --filter @sats-options/oracle-feeds daemon -- \
  --interval 60 --expiry <fri1> --expiry <fri2> --expiry <fri3> --expiry <fri4>
```

(Use `PRICE_SOURCE=chainlink CHAINLINK_AGGREGATOR=0x5741306c21795FdCBb9b265Ea0255F499DFe515C`
for a live BTC/USD price instead of `SPOT_PRICE`.)

Settlement after an expiry passes (anyone can call it; needs the feed signer):

```sh
pnpm --filter @sats-options/oracle-feeds settle -- \
  --expiry <epoch> --price <BTC fix> --subaccounts <makerSub>,<takerSub>
```

## 2. rfq-engine

```sh
cd services
source ../protocol/.env
CHAIN_ID=97 RPC_URL=$RPC_URL_97_THIRDWEB \
EXECUTOR_PRIVATE_KEY=$PRIVATE_KEY \
RFQ_PORT=3030 AUCTION_WINDOW_MS=8000 \
pnpm --filter @sats-options/rfq-engine dev
```

It refuses to start unless the executor key is registered via
`Matching.tradeExecutors` (the deployer key is). CORS is open by design —
the browser calls it directly.

## 3. maker-bot

```sh
cd services
source ../protocol/.env
# one-time: create the maker subaccount + deposit USDT cash
# (the smoke-test maker 0x5c9C... already has subaccount 5 with 150k USDT,
#  recorded in services/maker-bot/maker-state.97.json if you ran setup before;
#  otherwise:)
CHAIN_ID=97 RPC_URL=$RPC_URL_97_THIRDWEB PRIVATE_KEY=$TESTNET_MAKER_KEY \
DEPOSIT_USDT=100000 pnpm --filter @sats-options/maker-bot setup

# run the quoting bot
CHAIN_ID=97 RPC_URL=$RPC_URL_97_THIRDWEB PRIVATE_KEY=$TESTNET_MAKER_KEY \
RFQ_ENGINE_WS=ws://127.0.0.1:3030/maker \
pnpm --filter @sats-options/maker-bot dev
```

If you skipped `setup` but the maker already has a subaccount, pass
`MAKER_SUBACCOUNT_ID=<id>`. The bot prices with Black-76 off the on-chain
feeds (`MAKER_BID_RATIO=0.95` by default) — make sure step 1 ran or set
`FORWARD_PRICE`/`IV` overrides.

## 4. frontend

```sh
# repo root — optional .env.local:
#   NEXT_PUBLIC_RFQ_ENGINE_URL=http://localhost:3030   (default)
#   NEXT_PUBLIC_BSC_TESTNET_RPC_URL=https://bsc-testnet.bnbchain.org  (default)
#   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...  (only needed for WalletConnect wallets)
pnpm dev
```

Open http://localhost:3000, connect an EOA on BSC testnet (the UI prompts to
switch/add the chain), then:

1. **Gas**: get tBNB from https://www.bnbchain.org/en/testnet-faucet.
2. **Collateral**: "Get test BTCB" in the header mints 1 mock BTCB
   (`MockERC20.mint` is unrestricted on testnet — see `protocol/TESTNET.md`).
3. Pick expiry + strike (premiums/APR shown are **indicative**: Black-76
   computed client-side from the on-chain spot/forward/vol/rate feeds; if an
   expiry has no feed data yet the UI falls back to 60% IV / forward=spot).
4. Enter an amount and hit the CTA. The flow runs:
   `Matching.createSubAccount(SRM)` (one-time tx) → BTCB `approve` +
   `WrappedERC20Asset.deposit` (txs) → RFQ auction (live best quote +
   countdown) → wallet EIP-712 signature over the TakerOrder Action →
   engine executes `Matching.verifyAndMatch` → BscScan link shown.
5. Positions (short calls, BTCB collateral, USDT cash incl. premium) are read
   on-chain from `SubAccounts.getAccountBalances`; settlement status from
   `LyraForwardFeed.getSettlementPrice`. The subaccount id is persisted in
   localStorage per address and re-verified on-chain on every load.

## Testnet quirks (from protocol/TESTNET.md)

- BSC testnet nodes mishandle EIP-1559 fee fields from forge — the services
  force **legacy txs with gasPrice 0.2 gwei** on chain 97
  (`services/shared/src/clients.ts`). Browser wallets build their own txs and
  are generally fine; if MetaMask stalls, set the gas to legacy/0.2 gwei.
- Public RPCs are flaky; prefer the thirdweb endpoint (`RPC_URL_97_THIRDWEB`
  in `protocol/.env`) with retries. The frontend RPC is overridable via
  `NEXT_PUBLIC_BSC_TESTNET_RPC_URL`.
- The on-chain **OI fee** (`max(0.1% x forward, 10)` USDT per side) is charged
  by the SRM on top of the premium — expect subaccount cash to move by
  premium minus fee (it can go negative; that's borrowing against the BTCB,
  margin-checked by the SRM).
- Mock BTCB/USDT mints are unrestricted; real BTCB/USDT on mainnet.

## Checks

```sh
pnpm build   # Next build + typecheck — must pass clean
pnpm lint
pnpm test    # vitest: EIP-712 domain/typehash vs deployments/97.json,
             # subId encoding vs the live smoke trade, board generation
```
