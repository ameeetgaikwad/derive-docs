# @hedge/maker-bot

Reference market-maker bot for Hedge. It is the counterparty in the v1
covered-call flow: it listens for RFQ broadcasts from the rfq-engine, prices
BTC options with Black-76, applies a configurable spread, and responds with a
fully EIP-712-signed maker `RfqModule` Action that the engine can pass straight
into `Matching.verifyAndMatch` as `actions[0]`.

## Quick start (anvil)

```sh
pnpm install                      # from services/
pnpm --filter @hedge/maker-bot build

# one-time self-setup: create a subaccount under Matching (SRM-managed) and
# deposit USDT cash so the maker can pay premiums and pass SRM margin
PRIVATE_KEY=0x... DEPOSIT_USDT=100000 pnpm --filter @hedge/maker-bot setup

# run the quoting bot
PRIVATE_KEY=0x... pnpm --filter @hedge/maker-bot dev
```

Smoke check (no chain needed):

```sh
pnpm --filter @hedge/maker-bot smoke
# = build + vitest (Black-76 vs numeric-integration reference, signing round-trip)
#   + an offline `price` CLI invocation
```

## Commands

| Command | What it does |
|---|---|
| `maker-bot` (default) | Connect to the rfq-engine maker WS and auto-quote RFQs. |
| `maker-bot --setup` | `Matching.createSubAccount(StandardManager)` then `USDT.approve` + `CashAsset.deposit` (the SubAccounts+approve path the vendored integration tests use — no trade-executor permission needed). Persists the subaccount id to `maker-state.<chainId>.json`. |
| `maker-bot price --forward 100000 --strike 110000 --days 7 --vol 0.6 [--rate 0] [--put]` | Offline Black-76 sanity check; prints theo/bid/ask JSON. |

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PRIVATE_KEY` | — (required) | Maker EOA key; owns the subaccount and signs Actions. |
| `CHAIN_ID` | `31337` | 31337 anvil / 97 BSC testnet / 56 BSC. |
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint. |
| `RFQ_ENGINE_WS` | `ws://127.0.0.1:3030/maker` | rfq-engine maker channel. |
| `MAKER_BID_RATIO` | `0.95` | Bid = ratio × Black-76 theo when the maker buys (covered-call flow). |
| `MAKER_ASK_RATIO` | `1.05` | Ask = ratio × theo when the maker sells. |
| `MAKER_MAX_FEE` | `0` | Max matching fee signed into the RfqOrder, 18dp decimal. |
| `DEPOSIT_USDT` | `100000` | USDT (token units) deposited by `--setup`. |
| `MAKER_SUBACCOUNT_ID` | — | Overrides the state file. |
| `MAKER_STATE_FILE` | `maker-state.<chainId>.json` | Where `--setup` records the subaccount. |
| `FORWARD_PRICE`, `SPOT_PRICE`, `IV`, `RATE` | — | Legacy BTC pricing overrides. When `FORWARD_PRICE`/`SPOT_PRICE` **and** `IV` are set, BTC on-chain feeds are not queried. |
| `FORWARD_PRICE_<MARKET>`, `SPOT_PRICE_<MARKET>`, `IV_<MARKET>`, `RATE_<MARKET>` | — | Market-isolated overrides, for example `SPOT_PRICE_NVDA` and `IV_NVDA`. Unqualified price/IV overrides never apply to RWA markets. |
| `QUOTE_TTL_SEC` | `300` | Signed Action validity. |

Pricing inputs without overrides come from the deployed feeds (addresses from
`protocol/deployments/<chainId>.json`): `LyraForwardFeed.getForwardPrice(expiry)`
(falls back to `LyraSpotFeed.getSpot()` if the expiry has no forward data),
`LyraVolFeed.getVol(strike, expiry)`, `LyraRateFeed.getInterestRate(expiry)`
(falls back to `RATE`, default 0).

## WS protocol (rfq-engine maker channel)

The bot speaks the protocol implemented by `services/rfq-engine/src/server.ts`
(wire types mirrored from `services/rfq-engine/src/types.ts`). All
protocol-shaped code lives in **one module**, `src/transport.ts`, so wire
changes stay a local adaptation. JSON frames discriminated by `type`; bigints
as decimal strings.

```jsonc
// engine -> maker, on connect
{ "type": "auth_challenge", "challenge": "Hedge rfq-engine maker auth <uuid> <ts>" }

// maker -> engine: EIP-191 personal-sign of the challenge string
{ "type": "auth", "address": "0x..", "signature": "0x.." }

// engine -> maker, then replays all currently-open RFQs as rfq_open
{ "type": "auth_ok", "address": "0x.." }

// engine -> maker. direction "sell" = the taker sells, so the maker's signed
// trade amount must be exactly +amount (maker receives the option).
{ "type": "rfq_open", "rfq": { "id": "..", "takerSubaccountId": "2", "direction": "sell",
  "instrument": { "name": "BTC-20260617-110000-C", "currency": "BTC",
    "optionAsset": "0x..", "expiry": "..", "strike": "110000000...000", "isCall": true, "subId": ".." },
  "amount": "1000000000000000000", "createdAt": 0, "auctionEndsAt": 0, "status": "open" } }

// maker -> engine: only the signed RfqModule Action — the engine decodes
// RfqOrder{maxFee,trades[]} from action.data, validates it against the RFQ
// (asset/subId/amount/price, maker cash on-chain) and uses it as actions[0]
// in Matching.verifyAndMatch. action.expiry must outlive auctionEndsAt.
{ "type": "quote", "rfqId": "..",
  "action": { "subaccountId": "4", "nonce": "..", "module": "0x<rfqModule>", "data": "0x..",
              "expiry": "..", "owner": "0x..", "signer": "0x.." },
  "signature": "0x.." }

// maker -> engine: withdraw a live quote while its auction is open.
// Re-sending a quote for the same rfq REPLACES the previous one instead.
{ "type": "cancel", "quoteId": ".." }

// engine -> maker results:
//   {"type":"quote_ack","rfqId":"..","quoteId":"..","replacedQuoteId":".."}  (replacedQuoteId on replace)
//   {"type":"quote_rejected","rfqId":"..","reason":".."}
//   {"type":"cancel_ack","rfqId":"..","quoteId":".."} | {"type":"cancel_rejected","quoteId":"..","reason":".."}
//   {"type":"rfq_closed","rfqId":"..","bestQuoteId":"..","won":true,"acceptDeadlineAt":1781712123456}
//       (won/acceptDeadlineAt only on the winner's socket)
//   {"type":"rfq_executed","rfqId":"..","txHash":"0x..","fill":{quoteId,instrument,amount,premium,totalPremium,makerFee,takerFee,blockNumber,..}}
//   {"type":"rfq_failed","rfqId":"..","reason":".."}      (winner only: execution reverted/errored)
//   {"type":"rfq_expired","rfqId":"..","reason":".."}     (winner only: taker missed the accept deadline)
//   {"type":"superseded","message":".."}                  (a newer connection authed for this address;
//                                                          socket then closes with code 4000 — do NOT reconnect)
```

Liveness: the engine sends protocol-level WS pings (default every 30 s) and
drops connections that miss a pong for a full interval. Node's global
WebSocket answers pings automatically, so the bot needs no explicit keepalive.
The engine may also enforce a maker address allowlist (`MAKER_ALLOWLIST`):
non-allowlisted addresses get an auth error and close code 4003.

A one-shot fake engine for manual / e2e testing lives at
`scripts/fake-engine.mjs`: it runs the auth handshake, verifies the
heartbeat pong, broadcasts a single covered-call RFQ (default: 1x BTC call,
strike 110000, 7 days, asset from `protocol/deployments/31337.json`), prints
the received quote, replies `quote_ack` + `rfq_closed{won,acceptDeadlineAt}` +
`rfq_executed{fill}` and exits 0.

```sh
node scripts/fake-engine.mjs &                          # PORT=3030 by default
PRIVATE_KEY=0x... FORWARD_PRICE=100000 IV=0.6 pnpm dev  # bot quotes it
```

## Pricing

Black-76 on the forward (`src/black76.ts`):

```
call = e^(-rT) * (F·N(d1) − K·N(d2)),   d1 = (ln(F/K) + σ²T/2)/(σ√T),  d2 = d1 − σ√T
```

`N(·)` uses the Abramowitz–Stegun 7.1.26 erf approximation (|err| ≤ 1.5e-7).
Tests validate against an independent Simpson-rule integration of the
risk-neutral payoff (see `test/black76.test.ts`), including the spec case
F=100000, K=110000, T=7/365, σ=0.6, r=0 within 1% (actual agreement ~1e-5).

## Protocol details verified against vendored source

- Action typehash/domain (`Matching`, `1.0`): `v2-matching/src/ActionVerifier.sol` (via shared).
- `RfqOrder{maxFee,trades[]}` / `TakerOrder{orderHash,maxFee}` encodings and
  `actions[0]=maker` ordering: `v2-matching/src/modules/RfqModule.sol`.
- Setup path (`createSubAccount` + permissionless `CashAsset.deposit`):
  `v2-matching/src/SubAccountsManager.sol`, `v2-core/src/assets/CashAsset.sol`,
  mirrored from `v2-matching/test/shared/MatchingBase.t.sol` and
  `src/periphery/SubAccountCreator.sol`.
