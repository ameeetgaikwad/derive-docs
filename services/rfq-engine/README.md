# @sats-options/rfq-engine

RFQ auction + execution service — the "sell order flow to market makers" core
of sats-options. Takers (covered-call sellers) open short auctions; connected
market makers stream back EIP-712-signed quotes targeting the on-chain
`RfqModule`; the best (highest-premium) quote wins; on taker accept the
service submits `Matching.verifyAndMatch` as the registered trade executor.

Everything protocol-facing is verified against the vendored pinned Solidity
(`protocol/lib/v2-matching`, see `protocol/PROVENANCE.md`):
`Matching.sol` (verifyAndMatch, trade-executor gating), `ActionVerifier.sol`
(EIP-712 domain `Matching`/`1.0`, Action typehash), `RfqModule.sol` /
`IRfqModule.sol` (RfqOrder / TakerOrder / FillData encodings, action ordering,
`orderHash = keccak256(abi.encode(trades))`).

## Run

```sh
# from services/
pnpm install
pnpm --filter @sats-options/rfq-engine build

# anvil defaults: RPC http://127.0.0.1:8545, chain 31337, executor = anvil key #0
pnpm --filter @sats-options/rfq-engine dev      # tsx watch src/index.ts
# or after build:
pnpm --filter @sats-options/rfq-engine start
```

Startup requires `protocol/deployments/<chainId>.json` (written by the deploy
script) and verifies on-chain that the executor key is registered via
`Matching.tradeExecutors` — it refuses to start otherwise.

### Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `CHAIN_ID` | `31337` | 31337 / 97 / 56 |
| `RFQ_PORT` (or `PORT`) | `3030` | HTTP + WS listen port |
| `AUCTION_WINDOW_MS` | `3000` | quote-collection window per RFQ |
| `EXECUTOR_PRIVATE_KEY` | anvil key #0 (31337 only) | must be the registered trade executor (`tradeExecutor` in the deployments JSON) |
| `SATS_DEPLOYMENTS_DIR` | auto-discovered | override deployments dir |

### Smoke check

```sh
pnpm --filter @sats-options/rfq-engine smoke    # build + vitest
```

The vitest suite spins the real server on an ephemeral port, registers fake
makers over WS (full signature handshake), runs a competing-quote auction to
best-quote selection and accept/execution with chain calls mocked, and pins
the exact `verifyAndMatch` calldata (including a frozen keccak256 of a fully
deterministic submission) against encodings re-derived from `RfqModule.sol`.

## API

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

- `GET /rfq/:id` — auction state. After the window closes:

  ```json
  {
    "rfq": { "status": "closed", ... },
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
  `409` on validation failure, `502` on execution failure.

- `GET /health`

### Taker — WS `/taker`

`{"type":"create_rfq","request":{…same as POST /rfq…}}` → `rfq_created`, then
`rfq_update` pushes on close/execution. `{"type":"subscribe","rfqId":"…"}` to
follow an existing RFQ.

### Maker — WS `/maker` (Rysk-V12-style MM interface)

1. On connect the server sends `{"type":"auth_challenge","challenge":"…"}`.
2. Maker replies `{"type":"auth","address":"0x…","signature":"0x…"}` where the
   signature is a personal-message (EIP-191) signature of the challenge string
   by `address`. Server answers `auth_ok` and replays all open RFQs.
3. Every new RFQ is broadcast as `{"type":"rfq_open","rfq":{…}}` with the
   instrument (`optionAsset`, `subId`, 18dp `strike`/`amount`) and
   `auctionEndsAt`.
4. Maker submits `{"type":"quote","rfqId":"…","action":{…},"signature":"0x…"}`
   — a fully signed Action targeting `RfqModule` whose `data` is
   `abi.encode(RfqOrder{ maxFee, trades })` with exactly one trade:
   `{ asset: optionAsset, subId, price: premium (18dp), amount: +rfqAmount }`
   (the maker buys what the taker sells; cash `price*amount` flows maker → taker).
5. Server replies `quote_ack` or `quote_rejected` (reason included), then
   `rfq_closed` (with `won: true` on the winner's socket) and `rfq_executed`.

Quote admission checks (in order): auction open; module/owner/signer shape
(v1: `signer == owner`, no session keys); action expiry outlives the window;
RfqOrder decodes and matches the RFQ instrument exactly; EIP-712 signature
recovers to the signer; on-chain that the maker subaccount is deposited into
Matching under the maker address and its cash balance covers
`premium*amount + maxFee`.

## Execution path

On accept, the service builds the `RfqModule` action pair per the vendored
`RfqModule.executeAction` semantics — `[makerAction, takerAction]`, fill data
`FillData{ makerAccount, makerFee: 0, takerAccount, takerFee: 0, managerData: 0x }`
— and submits `Matching.verifyAndMatch(actions, signatures, actionData)` from
the executor key, waiting for the receipt.

## Architecture / swappability

- `store.ts` — `RfqStore` interface; v1 ships `InMemoryRfqStore`.
- `chain.ts` — `ChainReader` (collateral/ownership reads) and `TxSubmitter`
  (verifyAndMatch) interfaces with viem implementations; tests inject fakes.
- `auction.ts` — transport-agnostic `AuctionEngine` (event emitter).
- `server.ts` — HTTP/WS front-end only.
- `executor.ts` — pure `buildRfqExecution` (calldata) + `Executor` (submit).
