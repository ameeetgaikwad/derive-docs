# @hedge/rfq-engine

RFQ auction + execution service — the "sell order flow to market makers" core
of Hedge. Takers (covered-call sellers) open short auctions; connected
market makers stream back EIP-712-signed quotes targeting the on-chain
`RfqModule`; the best (highest-premium) quote wins; on taker accept the
service submits `Matching.verifyAndMatch` as the registered trade executor.

Everything protocol-facing is verified against the vendored pinned Solidity
(`protocol/lib/v2-matching`, see `protocol/PROVENANCE.md`):
`Matching.sol` (verifyAndMatch, trade-executor gating), `ActionVerifier.sol`
(EIP-712 domain `Matching`/`1.0`, Action typehash), `RfqModule.sol` /
`IRfqModule.sol` (RfqOrder / TakerOrder / FillData encodings, action ordering,
`orderHash = keccak256(abi.encode(trades))`), and
`StandardManager.sol` / `BasePortfolioViewer.sol` (SRM OI fee math used by the
maker collateral pre-check).

## Run

```sh
# from services/
pnpm install
pnpm --filter @hedge/rfq-engine build

# anvil defaults: RPC http://127.0.0.1:8545, chain 31337, executor = anvil key #0
pnpm --filter @hedge/rfq-engine dev      # tsx watch src/index.ts
# or after build:
pnpm --filter @hedge/rfq-engine start
```

Startup requires `protocol/deployments/<chainId>.json` (written by the deploy
script) and verifies on-chain that the executor key is registered via
`Matching.tradeExecutors` — it refuses to start otherwise.

### Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `CHAIN_ID` | `31337` | 31337 / 97 / 56 |
| `HOST` | `127.0.0.1` | listen address; keep loopback in dev, `0.0.0.0` only behind a reverse proxy |
| `RFQ_PORT` (or `PORT`) | `3030` | HTTP + WS listen port |
| `AUCTION_WINDOW_MS` | `3000` | quote-collection window per RFQ |
| `TAKER_ACCEPT_DEADLINE_MS` | `120000` | how long the taker has to accept after the auction closes with a winner; past it the RFQ expires and the maker is released |
| `WS_HEARTBEAT_MS` | `30000` | WS ping interval (maker + taker channels); a connection that misses a pong for one full interval is dropped. `0` disables |
| `MAKER_ALLOWLIST` | empty (open/dev) | comma-separated maker EOA addresses; when set, WS auth is refused (close code `4003`) for any other address |
| `TAKER_OPEN` | `true` | `false` rejects all RFQ creation (REST `403` / taker-WS error) |
| `RFQ_RATE_LIMIT_PER_MIN` | `30` | RFQ creations allowed per IP per minute (REST `POST /rfq` **and** taker-WS `create_rfq`); over-limit ⇒ `429` / WS error. `0` disables |
| `TRUST_PROXY` | `false` | trust the first `X-Forwarded-For` address for rate limiting; enable only when security groups/firewalls block direct container access |
| `STORE_PATH` | unset (in-memory) | path to a JSONL file for durable auctions + trade history (see Persistence) |
| `SUBACCOUNT_DIRECTORY_TABLE` | unset (disabled) | DynamoDB table for the focused Matching subaccount directory |
| `SUBACCOUNT_DIRECTORY_DEPLOYMENT_BLOCK` | `matchingDeploymentBlock` from deployments JSON | optional Matching event-scan origin override |
| `SUBACCOUNT_DIRECTORY_CONFIRMATIONS` | `6` (`0` on anvil) | blocks held behind the chain head before indexing |
| `SUBACCOUNT_DIRECTORY_CHUNK_SIZE` | `2000` | blocks read per indexer pass |
| `SUBACCOUNT_DIRECTORY_POLL_MS` | `15000` | non-overlapping indexer polling interval; minimum `1000` |
| `EXECUTOR_PRIVATE_KEY` | anvil key #0 (31337 only) | must be the registered trade executor (`tradeExecutor` in the deployments JSON) |
| `SATS_DEPLOYMENTS_DIR` | auto-discovered | override deployments dir |

### Production posture (TLS / exposure)

The engine deliberately does **not** terminate TLS in-process. Deploy it
bound to loopback (the default `HOST=127.0.0.1`) and front it with a
TLS-terminating reverse proxy (nginx / caddy / cloud LB):

- makers connect to `wss://rfq.example.com/maker`, takers to
  `https://rfq.example.com/rfq` + `wss://…/taker`; the proxy forwards to
  `http://127.0.0.1:3030` (remember to enable WebSocket upgrade forwarding,
  e.g. nginx `proxy_set_header Upgrade/Connection` + `proxy_read_timeout`
  above the heartbeat interval).
- only set `HOST=0.0.0.0` when the engine runs in a private network segment
  behind the proxy; never expose the plain-HTTP port publicly.
- per-IP rate limiting uses the socket peer by default. Prefer rate limiting at
  the proxy; otherwise set `TRUST_PROXY=true` only when network policy prevents
  clients from bypassing that proxy and forging `X-Forwarded-For`.
- set `MAKER_ALLOWLIST` to the onboarded maker addresses and `STORE_PATH`
  to a persistent volume.

### Smoke check

```sh
pnpm --filter @hedge/rfq-engine smoke    # build + vitest
```

The vitest suite spins the real server on an ephemeral port, registers fake
makers over WS (full signature handshake), runs a competing-quote auction to
best-quote selection and accept/execution with chain calls mocked, and pins
the exact `verifyAndMatch` calldata (including a frozen keccak256 of a fully
deterministic submission) against encodings re-derived from `RfqModule.sol`.
`test/hardening.test.ts` additionally covers the allowlist, cancel/replace,
connection dedupe, accept-deadline expiry, heartbeat drops, the fee-aware
collateral pre-check, rate limiting and JSONL restart recovery.

## API

### Subaccount directory

`GET /subaccounts?owner=0x...` returns active candidate IDs for the service's
configured chain and Matching deployment:

```json
{
  "data": {
    "chainId": 56,
    "matching": "0x...",
    "indexedThroughBlock": "115317999",
    "indexedThroughBlockHash": "0x...",
    "accounts": [{ "accountId": "42" }, { "accountId": "57" }]
  }
}
```

The projection consumes only `DepositedSubAccount` and
`WithdrewSubAccount`. It resumes from one block/hash checkpoint and rebuilds
from the Matching deployment block if that checkpoint is no longer canonical.
The endpoint returns `400` for an invalid owner and `503` while disabled,
unsynchronized, or unable to read storage; those states are never returned as
an empty successful list.

This API discovers candidates; it is not an authorization source. The web app
multicalls `Matching.subAccountToOwner`, `SubAccounts.manager`,
`SubAccounts.ownerOf`, and `SubAccounts.getAccountBalances` before displaying
an ID. No positions, balances, or trade history are indexed.

Authoritative event origins are stored beside each deployment:

| Deployment | Matching block |
| --- | ---: |
| BSC mainnet (`protocol/deployments/56.json`) | `107532774` |
| BSC mainnet staging (`protocol/deployments/staging/56.json`) | `115317084` |
| BSC testnet (`protocol/deployments/97.json`) | `123273721` |

### Taker — REST

- `POST /rfq` — open an auction.

  ```json
  {
    "subaccountId": "4",
    "instrument": { "asset": "BTC", "expiry": 1781712000, "strike": "110000", "isCall": true },
    "amount": "1",
    "direction": "sell"
  }
  ```

  `amount`/`strike` are human decimals; responses use 18dp integer strings.
  Returns `201 { rfq }` with `rfq.id`, `instrument.subId` (lyra-utils
  OptionEncoding) and `auctionEndsAt` (ms epoch). v1 is sell-only.
  `403` when `TAKER_OPEN=false`; `429` past the per-IP rate limit.

- `GET /rfq/:id` — auction state. After the window closes:

  ```json
  {
    "rfq": { "status": "closed", "acceptDeadlineAt": 1781712123456, ... },
    "quoteCount": 2,
    "bestQuote": {
      "maker": "0x…", "premium": "1500000000000000000000",
      "totalPremium": "1500000000000000000000",
      "orderHash": "0x…", "trades": [ { "asset": "0x…", "subId": "…", "price": "…", "amount": "…" } ],
      "actionExpiry": "…"
    },
    "execution": null
  }
  ```

  `rfq.acceptDeadlineAt` (ms epoch, nullable) is set when the auction closes
  with a winner; accept before it or the RFQ expires (`status: "expired"`,
  `error: "taker did not accept before the deadline"`).

- `POST /rfq/:id/accept` — execute against the winning quote. Body is the
  taker's signed EIP-712 Action (domain `Matching`/`1.0` at the Matching
  address, type `Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)`)
  whose `data` is `abi.encode(TakerOrder{ orderHash, maxFee })` with
  `orderHash` taken from `bestQuote.orderHash`:

  ```json
  { "action": { "subaccountId": "4", "nonce": "…", "module": "<rfqModule>", "data": "0x…", "expiry": "…", "owner": "0x…", "signer": "0x…" }, "signature": "0x…" }
  ```

  Returns `200 { txHash, status, blockNumber, fill }` after the receipt, where
  `fill` summarizes maker/taker subaccounts, amount, premium and fees.
  `409` on validation failure (including a passed accept deadline), `502` on
  execution failure.

- `GET /health`

### Taker — WS `/taker`

`{"type":"create_rfq","request":{…same as POST /rfq…}}` → `rfq_created`, then
`rfq_update` pushes on close/execution/failure/expiry. `{"type":"subscribe","rfqId":"…"}`
to follow an existing RFQ. `create_rfq` is subject to the same `TAKER_OPEN` /
per-IP rate-limit gating as REST (refusals come back as `{"type":"error"}`).

### Maker — WS `/maker` (Rysk-V12-style MM interface)

All frames are JSON discriminated by `type`; bigints are 18dp decimal strings.

#### Session

1. On connect the server sends `{"type":"auth_challenge","challenge":"…"}`.
2. Maker replies `{"type":"auth","address":"0x…","signature":"0x…"}` where the
   signature is a personal-message (EIP-191) signature of the challenge string
   by `address`. Server answers `auth_ok` and replays all open RFQs.
   - If `MAKER_ALLOWLIST` is set and the address is not on it, the server
     sends `{"type":"error","message":"auth failed: address not allowlisted"}`
     and closes with code **4003**.
   - **One live connection per maker address**: when the same address
     authenticates on a new socket, the old socket receives
     `{"type":"superseded","message":"…"}` and is closed with code **4000**.
     A superseded client must NOT auto-reconnect (it would supersede the new
     session right back).
3. **Heartbeat**: the server sends protocol-level WS pings every
   `WS_HEARTBEAT_MS` (default 30 s) and terminates a connection that has
   neither ponged nor sent any frame for one full interval. Standard WS
   stacks (browsers, Node/undici, `ws`) answer pings automatically — no
   app-level keepalive message exists or is needed.

#### Quoting

4. Every new RFQ is broadcast as `{"type":"rfq_open","rfq":{…}}` with the
   instrument (`optionAsset`, `subId`, 18dp `strike`/`amount`),
   `auctionEndsAt` and `acceptDeadlineAt` (null while open).
5. Maker submits `{"type":"quote","rfqId":"…","action":{…},"signature":"0x…"}`
   — a fully signed Action targeting `RfqModule` whose `data` is
   `abi.encode(RfqOrder{ maxFee, trades })` with exactly one trade:
   `{ asset: optionAsset, subId, price: premium (18dp), amount: +rfqAmount }`
   (the maker buys what the taker sells; cash `price*amount` flows maker → taker).
   - Server replies `{"type":"quote_ack","rfqId","quoteId"}` or
     `{"type":"quote_rejected","rfqId","reason"}`.
   - **Replace**: a second quote from the same maker on the same RFQ replaces
     the previous one (only the latest is kept). The ack then carries
     `replacedQuoteId`: `{"type":"quote_ack","rfqId","quoteId","replacedQuoteId"}`.
6. **Cancel**: `{"type":"cancel","quoteId":"…"}` withdraws a live quote while
   its auction is still open. Server replies
   `{"type":"cancel_ack","rfqId","quoteId"}` or
   `{"type":"cancel_rejected","quoteId","reason"}` (unknown/foreign quote, or
   the auction already closed — the winning quote is locked in).

#### Auction results

7. `{"type":"rfq_closed","rfqId","bestQuoteId"}` to every maker when the
   window ends. The winner's socket additionally gets `won: true` and
   `acceptDeadlineAt` (ms epoch — the taker must accept before it).
8. `{"type":"rfq_executed","rfqId","txHash","fill":{…}}` after a successful
   on-chain execution. `fill` is the realized fill report:

   ```json
   { "quoteId": "…", "instrument": "BTC-20260619-110000-C", "maker": "0x…",
     "makerSubaccountId": "11", "takerSubaccountId": "4",
     "amount": "1000000000000000000", "premium": "1500000000000000000000",
     "totalPremium": "1500000000000000000000", "makerFee": "0", "takerFee": "0",
     "blockNumber": "12345678" }
   ```

9. `{"type":"rfq_failed","rfqId","reason"}` — sent to the **winning maker**
   when execution reverts or errors after the taker accepted.
10. `{"type":"rfq_expired","rfqId","reason"}` — sent to the **winning maker**
    when the taker fails to accept before `acceptDeadlineAt`; the RFQ moves to
    `status: "expired"` and the maker's reserved collateral is released.

#### Quote admission checks (in order)

auction open; module/owner/signer shape (v1: `signer == owner`, no session
keys); action expiry outlives the window; RfqOrder decodes and matches the
RFQ instrument exactly; EIP-712 signature recovers to the signer; on-chain
that the maker subaccount is deposited into Matching under the maker address
and its cash balance covers

```
premium*amount + maxFee + estimated SRM OI fee + cash already reserved by the
maker's other live quotes
```

The OI fee is computed exactly like `StandardManager._chargeAllOIFee` →
`BasePortfolioViewer.getAssetOIFee`:
`|amount| * forwardPrice / 1e18 * OIFeeRateBPS[optionAsset] / 1e18`, floored
at `StandardManager.minOIFee()` when non-zero. `OIFeeRateBPS` (from the
deployed `srmViewer`), the forward price (per-currency forward feed) and
`minOIFee` are **read live on every quote** — governance can change them at
any time. A quote is rejected (`quote_rejected`) when the feed read fails
("cannot estimate SRM OI fee …"). Reserved cash is tracked per maker
subaccount across all open auctions plus won-awaiting-accept quotes and is
released on cancel/replace/loss/execution/failure/deadline-expiry.

## RFQ lifecycle

```
open ──window ends──▶ closed (winner, acceptDeadlineAt set) ──accept──▶ executing ──▶ executed
  │                      │                                                     └────▶ failed
  └─ no quotes ─▶ expired└─ deadline passes ─▶ expired (maker released, rfq_expired)
```

## Persistence (`STORE_PATH`)

`STORE_PATH=/var/lib/hedge/rfq.jsonl` switches the store from in-memory to an
append-only JSONL log + in-memory index (no native deps; safe against torn
final lines). Every RFQ/quote mutation is appended; on boot the engine
replays the log and then `recover()`s:

- open auctions whose window is still running are re-armed (close timer +
  maker collateral reservations rebuilt);
- open auctions whose window elapsed while down are closed normally (best
  quote selected, accept deadline armed);
- closed auctions past their accept deadline are expired; still-live ones get
  their deadline timer re-armed;
- RFQs caught in `executing` are marked `failed` with
  "engine restarted during execution — verify on-chain state manually" (the
  engine never blindly resubmits);
- executed/failed/expired RFQs are kept as durable trade history.

The in-memory store remains the default (tests, dev). The log is never
compacted in v1 — rotate the file offline if it grows.

## Execution path

On accept, the service builds the `RfqModule` action pair per the vendored
`RfqModule.executeAction` semantics — `[makerAction, takerAction]`, fill data
`FillData{ makerAccount, makerFee: 0, takerAccount, takerFee: 0, managerData: 0x }`
— and submits `Matching.verifyAndMatch(actions, signatures, actionData)` from
the executor key, waiting for the receipt.

## Architecture / swappability

- `store.ts` — `RfqStore` interface; `InMemoryRfqStore` (default) and
  `JsonlRfqStore` (durable, `STORE_PATH`).
- `chain.ts` — `ChainReader` (collateral/ownership/OI-fee reads) and
  `TxSubmitter` (verifyAndMatch) interfaces with viem implementations; tests
  inject fakes.
- `auction.ts` — transport-agnostic `AuctionEngine` (event emitter): windows,
  best-quote selection, cancel/replace, accept deadlines, collateral
  reservations, restart recovery.
- `server.ts` — HTTP/WS front-end only: auth/allowlist, heartbeats,
  connection dedupe, rate limiting, fan-out.
- `executor.ts` — pure `buildRfqExecution` (calldata) + `Executor` (submit).
- `subaccount-directory.ts` — canonical event projection, checkpoint/reorg
  handling, and read model interfaces.
- `dynamodb-subaccount-directory.ts` — durable account/checkpoint adapter.
- `viem-subaccount-directory.ts` / `subaccount-directory-worker.ts` — Matching
  log reader and non-overlapping poll loop.
