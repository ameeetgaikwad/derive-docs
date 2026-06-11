# sats-options — Market-Maker Integration Guide (BSC Testnet)

**Audience:** integration engineers at trading firms running quoting bots against sats-options retail
covered-call flow.

**Status:** live on BSC testnet (chainId **97**) as of 2026-06-11. Mainnet (BSC, 56) not yet deployed.
Everything in this document is derived from the code in this repository
(`services/rfq-engine`, `services/maker-bot`, `services/shared`) and the vendored on-chain settlement
contracts (`protocol/lib/v2-matching`, `protocol/lib/v2-core`). Where a capability is missing it is
marked **not yet implemented** rather than speculated.

---

## Table of contents

1. [Overview](#1-overview)
2. [Onboarding: keys, subaccounts, collateral](#2-onboarding-keys-subaccounts-collateral)
3. [The wire protocol](#3-the-wire-protocol)
4. [Signing: EIP-712 Actions and RfqModule orders](#4-signing-eip-712-actions-and-rfqmodule-orders)
5. [Pricing inputs, settlement, fees](#5-pricing-inputs-settlement-fees)
6. [Risk and operational notes](#6-risk-and-operational-notes)
7. [Runbook: quoting on testnet in 30 minutes](#7-runbook-quoting-on-testnet-in-30-minutes)
8. [Appendix A: the executed testnet trade, step by step](#appendix-a-worked-example--the-live-testnet-trade)
9. [Appendix B: testnet address book](#appendix-b-testnet-address-book-chainid-97)

---

## 1. Overview

sats-options is an on-chain options protocol on BNB Chain, forked from Derive v2. The v1 product is
**fully-collateralized BTC covered calls sold by retail takers to market makers via RFQ**:

- **What you are buying.** Retail users ("takers") deposit BTCB into a subaccount and sell European
  BTC call options against it (covered calls). You, the maker, **buy** those calls and pay the
  premium in USDT. v1 RFQ direction is `"sell"` only — the taker always sells, the maker always
  buys. Puts and maker-sells are planned but **not yet implemented** (the engine rejects any other
  direction with `v1 supports direction "sell" only (covered calls sold to makers)`).
- **Auction model.** Every RFQ is a short **sealed-bid, first-price auction**. The rfq-engine
  broadcasts the RFQ to all authenticated makers, collects signed quotes for a fixed window
  (`AUCTION_WINDOW_MS`, default 3,000 ms; the live smoke test ran 8,000 ms), and selects the
  **highest per-unit premium** (ties broken by earliest arrival). Competitor quotes are not revealed
  during the window. If you win, you pay exactly the premium you quoted (first-price).
- **Atomic on-chain settlement.** When the taker accepts the winning quote, the engine (a registered
  *trade executor*) submits a single `Matching.verifyAndMatch` transaction pairing your signed maker
  order with the taker's signed accept. Option and cash legs move atomically inside the
  `SubAccounts` ledger; margin (SRM) checks run in the same transaction. There is no off-chain
  settlement, novation, or counterparty credit — your signed EIP-712 order *is* the trade.
- **Instruments.** European, cash-settled-at-expiry BTC options collateralized by physical BTCB on
  the taker side, premiums and settlement in USDT (the protocol's cash asset). All protocol amounts
  use **18 decimals** (BTCB and BSC USDT are natively 18-decimal tokens).
- **Instrument naming:** `BTC-<YYYYMMDD>-<strike>-C|P`, e.g. `BTC-20260619-69000-C`.

Components you interact with:

| Component | What it is | Where |
|---|---|---|
| rfq-engine | WS/REST auction service + on-chain executor | `services/rfq-engine` |
| maker-bot | Reference maker implementation (this is what you adapt) | `services/maker-bot` |
| shared SDK | TypeScript signing/encoding library (`@sats-options/shared`) | `services/shared` |
| Protocol contracts | Matching + RfqModule + SubAccounts + SRM + feeds | `protocol/`, addresses in `protocol/deployments/97.json` |

---

## 2. Onboarding: keys, subaccounts, collateral

### 2.1 What you need

1. **One EOA private key.** In v1 this single key does everything: authenticates your WS session,
   owns your subaccount, and signs quotes. The protocol contracts support session keys
   (`ActionVerifier.registerSessionKey`), but the rfq-engine **rejects** quotes with
   `signer != owner` (`v1 requires signer == owner (no session keys)`), so plan for a single hot key
   for now.
2. **tBNB for gas** — only needed for setup transactions (subaccount creation, approvals, deposits)
   and any direct withdrawals. Quoting itself is gasless for you: trades are submitted on-chain by
   the engine's executor key. Use any BSC testnet faucet; the whole smoke-test setup cost
   ~0.02 tBNB per participant.
3. **USDT cash collateral** in a Matching subaccount (see below).

### 2.2 Testnet mocks (free money)

Both testnet tokens are open-mint mocks — `MockERC20.mint(address,uint256)` is **unrestricted**:

| Token | Address (97) | Decimals |
|---|---|---|
| Mock USDT | `0x9896AF08d261E52a629EF58cBebd32E8e0AA8eA9` | 18 |
| Mock BTCB | `0x32fCF6a260Cdd2A3dc79cD0d4aD6B6c46bF6798A` | 18 |

```sh
cast send 0x9896AF08d261E52a629EF58cBebd32E8e0AA8eA9 \
  "mint(address,uint256)" $MAKER_ADDR 200000ether \
  --rpc-url https://bsc-testnet.bnbchain.org --private-key $PK \
  --legacy --gas-price 200000000
```

(Note the `--legacy --gas-price 200000000` — see [§6.5](#65-bsc-testnet-legacy-gas-quirk).)

### 2.3 Creating a subaccount under Matching

The protocol's account model: `SubAccounts` is an ERC-721 ledger; each subaccount NFT holds asset
balances and is risk-checked by its manager (the **StandardManager / SRM**). To trade through the
RFQ system your subaccount NFT must be **deposited into the Matching contract**, which records you
as the off-chain owner (`Matching.subAccountToOwner[id] == your EOA`). The engine verifies this
on-chain for every quote.

The easy path is `maker-bot --setup`, which performs exactly (verified in
`services/maker-bot/src/setup.ts`):

1. `Matching.createSubAccount(standardManager)` → creates the subaccount with the NFT held by
   Matching and you recorded as owner. Returns your `subaccountId`.
2. `USDT.approve(cashAsset, amount)`
3. `CashAsset.deposit(subaccountId, amount)` → pulls USDT from your EOA and credits 18dp "cash" to
   the subaccount. Deposit is permissionless for any recipient account.

It persists the subaccount id to `maker-state.<chainId>.json` (overridable with
`MAKER_SUBACCOUNT_ID` / `MAKER_STATE_FILE`). You can equally do these three calls yourself — no
permission from us is required for any of them.

### 2.4 Margin: what buying a call requires

Manager: SRM (StandardManager), address `0x4d55A929e184fc366664C11526E3B54aB70340B5`.

- A **long call is fully paid-for**: it requires no maintenance margin of its own. Your constraint
  is that after paying `premium + fees`, your subaccount must still pass the SRM **initial margin**
  check (≥ 0) in the trade transaction.
- USDT cash is the natural collateral. A negative cash balance is a borrow against other collateral
  (the taker side does exactly this — see Appendix A), but as a USDT-only maker you simply need
  enough cash.
- The engine additionally pre-checks **off-chain at quote time** that your cash balance covers
  `price * amount / 1e18 + maxFee` and rejects the quote otherwise (`insufficient maker cash: ...`).
  Note this pre-check does **not** include the on-chain OI fee (see [§5.3](#53-fees-you-pay)) — the
  on-chain margin check does, so keep a buffer.

Useful reads for monitoring (all 18dp):

```text
SubAccounts.getBalance(subaccountId, cashAsset, 0)            // signed cash balance
SubAccounts.getBalance(subaccountId, btcOptionAsset, subId)   // option position
StandardManager.getMargin(subaccountId, true)                 // initial margin (SRM)
```

---

## 3. The wire protocol

Source of truth: `services/rfq-engine/src/server.ts` and `src/types.ts`. Wire format is JSON; **all
bigints travel as decimal strings**; all on-chain quantities are 18dp integers; timestamps named
`*At` are **milliseconds** epoch, `expiry` fields are **unix seconds**.

### 3.1 Endpoints

| Channel | Path | Who |
|---|---|---|
| Maker WS | `ws://<host>:<port>/maker` | you |
| Taker WS | `ws://<host>:<port>/taker` | retail frontend |
| REST | `POST /rfq`, `GET /rfq/:id`, `POST /rfq/:id/accept`, `GET /health` | takers / status polling |

Default port **3030** (`RFQ_PORT`/`PORT` env on the engine). The maker-bot default is
`RFQ_ENGINE_WS=ws://127.0.0.1:3030/maker`.

> **Deployment caveat (current code):** the server binds `127.0.0.1` by default and the production
> entrypoint does not expose a host override or TLS. A public `wss://` maker endpoint is **not yet
> implemented** — external makers currently connect via whatever tunnel/proxy we stand up. Ask us
> for the current testnet hostname.

`GET /rfq/:id` and `GET /health` are unauthenticated; makers may poll RFQ status over REST too
(the response shape is in §3.6).

### 3.2 Auth handshake (maker WS)

Immediately on connect the server sends a challenge:

```json
{ "type": "auth_challenge",
  "challenge": "sats-options rfq-engine maker auth 1c1f7b3e-83b7-4d54-9f3e-0db1b15c2f11 1781770000000" }
```

The challenge is `sats-options rfq-engine maker auth <uuid> <ms-timestamp>`, unique per connection.
You sign it as an **EIP-191 personal message** (`personal_sign` / viem `account.signMessage` — *not*
EIP-712) with the EOA that owns your subaccount, and reply:

```json
{ "type": "auth", "address": "0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8", "signature": "0x..." }
```

On success:

```json
{ "type": "auth_ok", "address": "0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8" }
```

…followed immediately by a **replay of every currently-open RFQ** as individual `rfq_open` frames,
so reconnects never miss live auctions. On failure you get
`{ "type": "error", "message": "auth failed: bad signature" }` and remain unauthenticated (the
socket is not closed). Sending a quote before authenticating yields
`{ "type": "error", "message": "authenticate first" }`.

There is **no maker allowlist** in the current code: any address with a valid signature can
authenticate and quote. Whitelisting/KYC gating is **not yet implemented**.

Re-authenticate on every reconnect (new challenge each time). The reference client
(`services/maker-bot/src/transport.ts`) reconnects with exponential backoff (1 s doubling to 30 s).
There is no application-level ping/heartbeat — detect dead connections yourself.

### 3.3 RFQ broadcast

Every new auction is pushed to all authenticated makers:

```jsonc
{
  "type": "rfq_open",
  "rfq": {
    "id": "501329a3-aa90-45cd-8607-f37f8439971d",   // UUID, key for everything that follows
    "takerSubaccountId": "6",                        // the retail seller's subaccount
    "direction": "sell",                             // v1: always "sell" (taker sells, you buy)
    "instrument": {
      "name": "BTC-20260619-69000-C",
      "currency": "BTC",
      "optionAsset": "0xD0dD8DcA596540F615e66E07F49d40647D8bC6eD", // BTC OptionAsset contract
      "expiry": "1781856000",                        // unix SECONDS, 2026-06-19 08:00 UTC
      "strike": "69000000000000000000000",           // 18dp (69,000)
      "isCall": true,
      "subId": "39614110892406511198553831168"       // lyra-utils OptionEncoding (see §4.5)
    },
    "amount": "1000000000000000000",                 // 18dp option size (1.0)
    "createdAt": 1781770000000,                      // ms epoch
    "auctionEndsAt": 1781770008000,                  // ms epoch — quotes accepted STRICTLY before this
    "status": "open"                                 // open|closed|expired|executing|executed|failed
  }
}
```

### 3.4 Quote submission

A quote is nothing but your **fully signed EIP-712 Action targeting RfqModule** (construction in
§4). One message:

```jsonc
{
  "type": "quote",
  "rfqId": "501329a3-aa90-45cd-8607-f37f8439971d",
  "action": {
    "subaccountId": "5",                              // YOUR maker subaccount
    "nonce": "1781770003123456",                      // unique per (owner, nonce) — see §4.4
    "module": "0x2769E33b2169C83304cEa0c5C8fbC5a1707E305D",  // RfqModule
    "data": "0x...",                                  // abi.encode(RfqOrder{maxFee, trades[]}) — §4.3
    "expiry": "1781770368",                           // unix seconds; must outlive auctionEndsAt
    "owner": "0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8",
    "signer": "0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8"   // v1: must equal owner
  },
  "signature": "0x..."                                // 65-byte EIP-712 signature, §4.2
}
```

The server replies with exactly one of:

```json
{ "type": "quote_ack", "rfqId": "501329a3-...", "quoteId": "8a2b4c..." }
{ "type": "quote_rejected", "rfqId": "501329a3-...", "reason": "<human-readable reason>" }
```

**Validation, in the exact order the engine runs it** (`services/rfq-engine/src/quotes.ts` —
rejection `reason` strings shown):

1. RFQ exists and is `open`; clock strictly before `auctionEndsAt`
   (`unknown rfq ...`, `rfq ... is closed`, `auction window closed`).
2. Action shape: `action.module` == RfqModule; `action.owner` == your authenticated WS address;
   `signer == owner`; `subaccountId != 0`; `action.expiry` in the future **and**
   `>= ceil(auctionEndsAt/1000)` (`action.expiry must outlive the auction window`).
3. `action.data` ABI-decodes as `RfqOrder` with **exactly one trade**, and that trade matches the
   RFQ exactly: `trade.asset == instrument.optionAsset`, `trade.subId == instrument.subId`,
   `trade.amount == +rfq.amount` (positive — you receive what the taker sells), `trade.price > 0`.
4. EIP-712 signature recovers to `action.signer` (`invalid EIP-712 signature`).
5. On-chain reads: `Matching.subAccountToOwner(action.subaccountId)` must equal your address
   (`subaccount N is not deposited into Matching by 0x...`), and your cash balance must cover
   `trade.price * trade.amount / 1e18 + maxFee` (`insufficient maker cash: balance X < required Y`).
6. After the chain reads, the window is re-checked — a quote that straddles the close is rejected
   with `auction window closed`. Budget your latency: RPC round-trips happen inside the window.

Notes:

- You may submit **multiple quotes** for the same RFQ (e.g. to improve your bid). All admitted
  quotes are kept and the best wins; there is **no cancel/replace** message — a submitted quote
  cannot be withdrawn (it dies only with its `action.expiry`). The reference bot quotes once per RFQ.
- Quotes are sealed: nothing about competitor quotes is sent to you while the auction is open.

### 3.5 Auction close, win/loss, execution

When the window ends, **every** authenticated maker receives:

```jsonc
{ "type": "rfq_closed",
  "rfqId": "501329a3-...",
  "bestQuoteId": "8a2b4c...",   // null if zero valid quotes arrived (RFQ status -> "expired")
  "won": true                    // present ONLY on the winning maker's socket; absent otherwise
}
```

- Winner selection: highest per-unit `trade.price`; ties broken by earliest `receivedAt`.
- Losers are **not** told the winning premium, only the winning `quoteId`. There is no explicit
  `lost` flag — infer loss from the absence of `won`.
- If your quote won, the RFQ moves to `closed` and waits for the taker to accept. The taker signs a
  `TakerOrder{orderHash, maxFee}` over the hash of *your* trades and POSTs it to
  `/rfq/:id/accept`; the engine then submits `Matching.verifyAndMatch` on-chain. On success all
  authenticated makers receive:

```json
{ "type": "rfq_executed", "rfqId": "501329a3-...", "txHash": "0x2d5d7c88..." }
```

**Gaps in the current notification surface (not yet implemented):**

- There is **no taker-accept deadline** and **no notification if the taker never accepts**. Your
  signed quote simply ages out at `action.expiry` (the engine refuses to execute against an expired
  maker action: `winning maker quote has expired`). Size your quote TTL accordingly (§6.3).
- If execution **fails on-chain** (revert), the engine emits an internal `rfq_failed` event that is
  pushed to taker subscribers only — **makers get no message**. Poll `GET /rfq/:id` if you need
  resolution; a reverted execution does *not* burn your nonce, so the action technically remains
  valid until expiry.
- No fill report with realized fees is pushed to the maker; the on-chain
  `RFQTradeCompleted`/`FeeCharged` events and the REST status response are the records.

### 3.6 REST status (useful for reconciliation)

`GET /rfq/:id` → `200`:

```jsonc
{
  "rfq": { /* PublicRfq as in §3.3, status reflects lifecycle */ },
  "quoteCount": 1,
  "bestQuote": {                      // null until the window closes with >=1 quote
    "quoteId": "8a2b4c...",
    "maker": "0x5c9C...",
    "makerSubaccountId": "5",
    "premium": "378586807763808053551",        // per-unit, 18dp
    "totalPremium": "378586807763808053551",   // premium*amount/1e18
    "orderHash": "0xda4e1328...",              // keccak256(abi.encode(trades)) — what the taker signs
    "trades": [ { "asset": "0xD0dD...", "subId": "3961411089...", "price": "3785868...", "amount": "1000000000000000000" } ],
    "actionExpiry": "1781770368"
  },
  "execution": { "txHash": "0x2d5d...", "status": "success", "blockNumber": "112792281" },  // null pre-execution
  "error": null                       // set when status === "failed"
}
```

Error codes: `404` unknown RFQ; accept returns `409` on validation failure, `502` on on-chain
failure, `200` on success.

### 3.7 RFQ lifecycle state machine

```text
open ──window ends, ≥1 quote──> closed ──taker accepts──> executing ──mined ok──> executed
  │                                                            └──reverted/error──> failed
  └──window ends, 0 quotes──> expired
```

---

## 4. Signing: EIP-712 Actions and RfqModule orders

Everything you sign is one struct: the Matching **Action**. The engine and the chain verify the
same signature; what varies per use-case is the `data` payload.

### 4.1 Domain (real testnet values — verify these)

```jsonc
{
  "name": "Matching",
  "version": "1.0",
  "chainId": 97,
  "verifyingContract": "0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285"   // Matching
}
```

Expected domain separator (cross-check your implementation, and/or call
`Matching.domainSeparator()` on-chain):

```text
0x4cc5ab9a5a9e3993fe20da61e691a365b4b67a1339557e5b0437ba83097c84b5
```

### 4.2 The Action struct

Type string (typehash `0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17`):

```text
Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)
```

Struct hash, exactly as `ActionVerifier._getActionHash` computes it:

```text
keccak256(abi.encode(
  ACTION_TYPEHASH, subaccountId, nonce, module, keccak256(data), expiry, owner, signer))
```

Digest: `keccak256(0x1901 || domainSeparator || structHash)` — i.e. standard
`eth_signTypedData_v4`. Any EIP-712 library that hashes `bytes` members as `keccak256(data)` (they
all should) produces the right digest. Signature verification on-chain goes through OpenZeppelin
`SignatureChecker`, so EOA ECDSA signatures and ERC-1271 contract signatures both work at the
contract level — but remember the engine requires `signer == owner` EOA in v1.

| Field | Meaning |
|---|---|
| `subaccountId` | Your maker subaccount (deposited into Matching) |
| `nonce` | Any uint you have never used before (per owner, per module) — see §4.4 |
| `module` | `RfqModule` = `0x2769E33b2169C83304cEa0c5C8fbC5a1707E305D` |
| `data` | `abi.encode(RfqOrder)` — §4.3 |
| `expiry` | Unix seconds. On-chain: `block.timestamp > expiry` reverts `OV_ActionExpired`. Off-chain: must outlive the auction window |
| `owner` | Your EOA (must equal `Matching.subAccountToOwner[subaccountId]`) |
| `signer` | Your EOA (v1: == owner) |

### 4.3 RfqModule order encoding (what your signature commits to)

The maker action's `data` is the ABI encoding of (from `IRfqModule` / `RfqModule.sol`):

```solidity
struct TradeData { address asset; uint subId; uint price; int amount; }
struct RfqOrder  { uint maxFee; TradeData[] trades; }
// encoding: abi.encode(RfqOrder) == abi.encode((uint256,(address,uint256,uint256,int256)[]))
```

For a v1 covered-call quote, `trades` has exactly one entry:

```text
asset  = instrument.optionAsset            (BTC OptionAsset)
subId  = instrument.subId                  (verbatim from the RFQ broadcast)
price  = your per-unit premium, 18dp uint  (always positive)
amount = +rfq.amount, 18dp int             (positive: YOU receive the option)
```

The taker signs the mirror-image `TakerOrder`:

```solidity
struct TakerOrder { bytes32 orderHash; uint maxFee; }
// orderHash MUST equal keccak256(abi.encode(makerOrder.trades))
// i.e. keccak256 of abi.encode((address,uint256,uint256,int256)[]) over your trades array
```

**On-chain fill semantics** (`RfqModule.executeAction`, the contract your signature ultimately
authorizes; the module receives `[makerAction, takerAction]` in that exact order and an
executor-supplied `FillData{makerAccount, makerFee, takerAccount, takerFee, managerData}`):

1. Both nonces are checked-and-invalidated (`BM_NonceAlreadyUsed` on reuse).
2. `fill.makerAccount`/`fill.takerAccount` must equal the signed `subaccountId`s
   (`RFQM_SignedAccountMismatch`) — the executor cannot redirect the fill to other accounts.
3. `fill.makerFee <= makerOrder.maxFee` and `fill.takerFee <= takerOrder.maxFee`
   (`RFQM_FeeTooHigh`) — the executor cannot charge you more module-fee than you signed for.
   **The engine currently always sets `makerFee = takerFee = 0`.**
4. `takerOrder.orderHash == keccak256(abi.encode(makerOrder.trades))` (`RFQM_InvalidTakerHash`) —
   the taker provably agreed to *your exact* trades; neither side's price/size can be altered.
5. For each trade: the asset position moves **taker → maker** for `amount`, and cash
   `price × amount` (18dp decimal mul) moves **maker → taker**. Module fees (zero today) move to
   the fee-recipient subaccount.
6. All transfers are submitted as one `SubAccounts.submitTransfers` batch — the SRM margin check
   and OI fee (§5.3) run here, atomically. Any failure reverts the whole trade.

So your signature authorizes **exactly one thing**: "transfer at most
`price×amount` USDT (+ up to `maxFee`) out of subaccount `subaccountId` in exchange for exactly
`amount` of option `(asset, subId)`, any time before `expiry`, once." Nothing else. It can only be
exercised through `Matching.verifyAndMatch`, which only registered trade executors can call, and
only paired with a taker who signed over the hash of your exact trades.

### 4.4 Nonce and expiry semantics

- **Nonces are not sequential.** Any never-before-used `uint256` per `(owner, module)` works;
  modules store `usedNonces[owner][nonce]`. A nonce is burned **only when the action executes
  on-chain**. Losing quotes never touch the chain, so their nonces stay unused — that is fine, just
  never reuse a nonce you may have outstanding. The SDK default is
  `Date.now() * 1000 + rand(0..999)` (`generateNonce()` in `services/shared/src/actions.ts`).
- **Expiry is your only kill switch.** There is no on-chain cancel for a signed action and no
  off-chain quote-cancel message. An admitted losing quote remains executable *in principle* until
  expiry (in practice the engine only ever executes the winning quote, but treat TTL as your risk
  bound). Keep it short: the reference bot uses `QUOTE_TTL_SEC=300` and clamps to
  `max(auctionEnd + 60s, now + TTL)`.

### 4.5 Option subId encoding

`subId` arrives verbatim in the RFQ broadcast; you only need to encode it yourself if you derive
instruments independently. Per lyra-utils `OptionEncoding` (ported in
`services/shared/src/instruments.ts`):

```text
uint96 subId = expiry | (strike/1e10) << 32 | isCall << 95
  expiry: unix seconds (uint32)
  strike: 18dp, must be a multiple of 1e10 (8-decimal granularity)
  isCall: bit 95
```

Worked: `BTC-20260619-69000-C` → `1781856000 | (69000e18/1e10)<<32 | 1<<95`
= `39614110892406511198553831168`. ✔ (matches the live trade)

### 4.6 TypeScript: build and sign a quote with `@sats-options/shared`

This is the exact path the reference bot takes (`services/maker-bot/src/quoter.ts`):

```ts
import { privateKeyToAccount } from "viem/accounts";
import {
  buildAction, encodeRfqOrder, hashRfqTrades, signAction,
  type RfqTradeData,
} from "@sats-options/shared";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const MATCHING  = "0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285";
const RFQ_MODULE = "0x2769E33b2169C83304cEa0c5C8fbC5a1707E305D";
const CHAIN_ID = 97;

// From the rfq_open broadcast:
const rfq = /* parsed PublicRfq */;

const trades: RfqTradeData[] = [{
  asset: rfq.instrument.optionAsset,     // BTC OptionAsset
  subId: BigInt(rfq.instrument.subId),
  price: 378_586807763808053551n,        // your premium, 18dp ($378.5868...)
  amount: BigInt(rfq.amount),            // +1e18: you receive the option
}];

const action = buildAction({
  subaccountId: 5n,                      // your maker subaccount
  module: RFQ_MODULE,
  data: encodeRfqOrder({ maxFee: 0n, trades }),
  owner: account.address,                // signer defaults to owner
  expiry: BigInt(Math.ceil(rfq.auctionEndsAt / 1000) + 300),
});                                      // nonce auto-generated

const signature = await signAction({
  action, signer: account, chainId: CHAIN_ID, matchingAddress: MATCHING,
});

ws.send(JSON.stringify({
  type: "quote",
  rfqId: rfq.id,
  action: {                              // bigints -> decimal strings on the wire
    subaccountId: action.subaccountId.toString(),
    nonce: action.nonce.toString(),
    module: action.module,
    data: action.data,
    expiry: action.expiry.toString(),
    owner: action.owner,
    signer: action.signer,
  },
  signature,
}));

// hashRfqTrades(trades) === the orderHash the taker will sign — useful for reconciliation.
```

Or skip the plumbing entirely and use `buildSignedQuote()` from
`services/maker-bot/src/quoter.ts`, which prices with Black-76 from the on-chain feeds and returns
`{ action, signature, orderHash, trades }` ready to send.

### 4.7 Implementing from scratch (Python / Rust / anything)

No SDK required. You need: (a) `eth_signTypedData_v4`-style EIP-712 signing, (b) ABI encoding,
(c) EIP-191 personal-sign for the WS challenge. Full typed-data document for the Action:

```json
{
  "types": {
    "EIP712Domain": [
      { "name": "name", "type": "string" },
      { "name": "version", "type": "string" },
      { "name": "chainId", "type": "uint256" },
      { "name": "verifyingContract", "type": "address" }
    ],
    "Action": [
      { "name": "subaccountId", "type": "uint256" },
      { "name": "nonce", "type": "uint256" },
      { "name": "module", "type": "address" },
      { "name": "data", "type": "bytes" },
      { "name": "expiry", "type": "uint256" },
      { "name": "owner", "type": "address" },
      { "name": "signer", "type": "address" }
    ]
  },
  "primaryType": "Action",
  "domain": {
    "name": "Matching", "version": "1.0", "chainId": 97,
    "verifyingContract": "0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285"
  },
  "message": { "...": "Action fields; data = abi.encode(RfqOrder) hex" }
}
```

ABI types for `action.data`:

- Maker `RfqOrder`: `abi.encode( (uint256 maxFee, (address asset, uint256 subId, uint256 price, int256 amount)[] trades) )`
  — a single tuple parameter containing a dynamic array, standard head/tail encoding.
- `orderHash = keccak256( abi.encode( (address,uint256,uint256,int256)[] trades ) )` — note: the
  **bare array**, not wrapped in the order tuple.
- Taker `TakerOrder`: `abi.encode( (bytes32 orderHash, uint256 maxFee) )`.

Validate your implementation against the live chain: `Matching.domainSeparator()` must return the
value in §4.1, and `Matching.getActionHash(action)` (a public pure helper on the contract) must
match your struct hash. Python example with `eth-account`:

```python
from eth_account import Account
from eth_account.messages import encode_typed_data, encode_defunct
from eth_abi import encode
from eth_utils import keccak

acct = Account.from_key(PRIVATE_KEY)

# WS auth: EIP-191 personal sign of the challenge string
sig = acct.sign_message(encode_defunct(text=challenge)).signature.hex()

# Quote: encode RfqOrder, then sign the Action as typed data
trades = [(OPTION_ASSET, sub_id, price_18dp, amount_18dp)]
rfq_order = encode(
    ["(uint256,(address,uint256,uint256,int256)[])"], [(max_fee, trades)])
order_hash = keccak(encode(["(address,uint256,uint256,int256)[]"], [trades]))

action = {
    "subaccountId": 5, "nonce": nonce, "module": RFQ_MODULE,
    "data": rfq_order, "expiry": expiry, "owner": acct.address, "signer": acct.address,
}
signed = acct.sign_message(encode_typed_data(full_message={
    "types": {...as above...}, "primaryType": "Action",
    "domain": {"name": "Matching", "version": "1.0", "chainId": 97,
               "verifyingContract": MATCHING},
    "message": action,
}))
```

---

## 5. Pricing inputs, settlement, fees

### 5.1 On-chain feeds (the protocol's marks)

The SRM margins and settlement run off Lyra-style signed feeds, posted by our `oracle-feeds`
service (testnet: 1-of-1 signer `0xdE50B8E965aD2B8E25f45a19FD87A2d2c737782F` — testnet only). You
can read them directly; all return 18dp values plus a confidence:

| Feed | Address (97) | Read |
|---|---|---|
| BTC spot | `0x69662A47C3C2626EB75a8c861C48a0a87Cb01b2C` | `getSpot() -> (uint price, uint conf)` |
| BTC forward | `0x86b7148B69F3eFad27Af6d0d892d063D6a6C9e05` | `getForwardPrice(uint64 expiry) -> (uint, uint)` |
| BTC vol (SVI surface) | `0x5a892364cFBd8e725eC1e7af25855005C0E0f0aE` | `getVol(uint128 strike, uint64 expiry) -> (uint, uint)` |
| BTC rate | `0x11C394e92592d08B43fE957c1A80f4c1F012d15D` | `getInterestRate(uint64 expiry) -> (int, uint)` |
| USDT/USD stable | `0x2Eeb9512F40c1964eCA5dc156D8e2479dA632116` | `getSpot() -> (uint, uint)` |

The reference bot (`services/maker-bot/src/pricing.ts`) prices Black-76 on
`forward`/`vol`/`rate` exactly from these reads, falling back to `getSpot()` when an expiry has no
forward data yet. Price with your own marks by all means — but note margin and the OI fee are
computed from *these* feeds, and the engine's cash pre-check uses your quoted premium. On testnet
the surface is currently a flat 60% IV SVI fit and feeds update only when posted, so don't expect
live-market dynamics.

ABIs for all feeds ship in `services/shared/src/abis/`.

### 5.2 Settlement at expiry

- Options are **European, cash-settled in USDT** against the on-chain settlement price; the taker's
  BTCB stays in their subaccount as collateral (it is not delivered to you).
- Sequence (implemented in `services/oracle-feeds/src/settlement.ts`, mirroring the vendored
  integration tests): at/after expiry the forward feed receives settlement data fixing the expiry
  price; then **anyone** may call `StandardManager.settleOptions(optionAsset, subaccountId)` per
  account. Our oracle-feeds service runs this (`oracle-feeds settle --expiry ... --price ...
  --subaccounts ...`), but you can settle your own subaccount permissionlessly once the fix is
  posted.
- Your long call settles to `max(F_settle − K, 0) × size` credited as cash; the short side is
  debited the same. Until you call/see settlement, the expired position just sits in the
  subaccount.
- The fix on testnet comes from the forward feed's settlement-window TWAP aggregates posted by the
  feed signer; there is no external settlement auction yet.

### 5.3 Fees you pay

Two layers exist; only one is non-zero today:

1. **Matching/module fee (`FillData.makerFee`)** — capped by the `maxFee` you sign. **The engine
   currently always submits 0.** Sign `maxFee: 0` and you are guaranteed zero module fee
   (`RFQM_FeeTooHigh` protects you on-chain).
2. **SRM OI fee** — charged by the StandardManager inside the trade transaction whenever a trade
   **increases open interest** in a subId (every new covered call does), per side, in cash, to the
   fee-recipient subaccount (id **3** on testnet). From the vendored code
   (`BasePortfolioViewer.getAssetOIFee`, `BaseManager._payFee`):

   ```text
   fee = |amount| × forwardPrice(expiry) × OIFeeRateBPS     (all 18dp decimal math)
   charged = max(fee, minOIFee)        per participant, only if subId OI increased
   ```

   **As currently deployed on testnet** (`protocol/script/DeployAll.s.sol`):
   `OIFeeRateBPS = 0.1e18` and `minOIFee = 10e18`, i.e.
   **`max(0.10 × forward notional, 10 USDT)` per side**. Despite the parameter's "BPS" name it is a
   plain 18dp decimal multiplier — the deployed value is **10% of forward notional**, which on the
   live smoke trade meant a 6,279 USDT fee against a 378.59 USDT premium (see Appendix A). **Be
   aware: this rate is a placeholder and is under review** — it is obviously not an economic rate
   and will change before any real money flows; do not hard-code it. Read the current values
   on-chain: `SRMPortfolioViewer.OIFeeRateBPS(btcOptionAsset)` (viewer:
   `0xbC9ae813B45Fa950AabE2E82eAB023Dd45a36486`) and `StandardManager.minOIFee()`.

   The OI fee is **not** included in the engine's off-chain cash pre-check, but it *is* part of the
   on-chain margin transaction — your subaccount must absorb `premium + OI fee` and still pass IM.

Gas: zero for quoting and fills (the executor pays); you pay gas only for your own
deposits/withdrawals.

---

## 6. Risk and operational notes

### 6.1 What the executor can and cannot do with your signature

The rfq-engine's executor key (`tradeExecutor` in the deployments file, currently
`0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB`) is the only address that can call
`Matching.verifyAndMatch`. Given your signed quote it **can**: execute your exact trades, once,
before expiry, paired with a taker who signed your trades' hash, charging you a module fee of at
most your signed `maxFee` (currently always 0). It **cannot**: change price, size, asset or subId;
execute twice (nonce); pick a different maker/taker subaccount than signed
(`RFQM_SignedAccountMismatch`); withdraw or transfer anything else from your subaccount (each
module only does its one job, and your signature binds `module = RfqModule`); or survive your
`expiry`. A malicious executor's worst case is *not executing* (censoring) or executing a quote you
wish had lost — both bounded by your own quoted price and TTL.

### 6.2 Self-custody and the escape hatch

Your subaccount NFT sits inside the Matching contract with your EOA recorded as owner. You never
need our cooperation to leave (verified in `v2-matching/src/SubAccountsManager.sol`):

```text
Matching.requestWithdrawAccount(subaccountId)    // starts cooldown; only recorded owner
... wait WITHDRAW_COOLDOWN = 30 minutes ...
Matching.completeWithdrawAccount(subaccountId)   // NFT transferred back to your EOA
```

After that you hold the subaccount NFT directly and can manage balances against `SubAccounts` /
`CashAsset.withdraw` yourself, fully outside the off-chain system. (While inside Matching, cash
withdrawals go through the WithdrawalModule via a signed action routed by the executor — the
escape hatch above is the trust-minimized path.)

### 6.3 Quote TTLs

- Engine constraint: `action.expiry >= ceil(auctionEndsAt / 1000)` or the quote is rejected.
- Your constraint: expiry is the only thing that kills a signed quote (no cancel). The taker-accept
  step has **no deadline**, so a winning quote can be accepted any time before your expiry —
  including after the market has moved. The reference bot uses
  `expiry = max(auctionEnd + 60 s, now + QUOTE_TTL_SEC)` with `QUOTE_TTL_SEC = 300`. Treat the TTL
  as a free option you are short to the taker and price it accordingly (or keep it tight).

### 6.4 Margin monitoring

Keep your subaccount's cash comfortably above your worst-case
`Σ(open quotes: premium + OI fee)`. Monitor with the reads in §2.4. Long-only call buying cannot be
liquidated in v1 economics (no negative exposure), but a failed IM check makes your *fills revert*,
which burns goodwill and shows up as `rfq_failed` on our side. Remember the engine validates your
cash **at quote time** against premium+maxFee only — concurrent wins across simultaneous auctions
can over-commit your balance; the engine does not reserve balances across open quotes.

### 6.5 BSC-testnet legacy-gas quirk

BSC testnet public nodes mishandle EIP-1559 fee fields (the chain reports a zero base fee), so
1559-typed transactions fail with `insufficient funds: have 0`. **Every transaction you send on
chain 97 must be a legacy transaction with an explicit gasPrice of 0.2 gwei** (`200000000` wei).

- `cast`/`forge`: `--legacy --with-gas-price 200000000` (and prefer `--retries 12 --delay 5`,
  public RPCs are flaky).
- viem: use `makeWalletClient` from `@sats-options/shared` — it forces
  `{ type: "legacy", gasPrice: 200000000n }` on every write on chain 97 and retries
  `nonce too low` errors caused by load-balanced lagging nodes.
- This applies only to *your* setup/withdrawal transactions; fills are sent by our executor, which
  already does this.

### 6.6 Engine availability semantics

- The RFQ store is **in-memory**: if the engine restarts, open auctions and historical RFQ state
  are gone (the WS replay after `auth_ok` covers only RFQs the current process knows). Reconcile
  fills from chain events (`RFQTradeCompleted` on RfqModule), not from the engine.
- Auth is per-connection; always re-run the handshake after reconnect.
- One WS connection per maker process is the supported pattern; multiple connections from the same
  address are not deduplicated (each gets every broadcast — guard against double-quoting; note
  duplicate quotes are *both* admitted).

---

## 7. Runbook: get quoting on testnet in 30 minutes

Prereqs: Node 22, pnpm, foundry's `cast`, a fresh EOA key, ~0.05 tBNB from a faucet.

```sh
# 0. Clone + install (5 min)
git clone <this repo> && cd derive/services
pnpm install
pnpm --filter @sats-options/shared build
pnpm --filter @sats-options/maker-bot build

# 1. Env — every maker-bot command reads these
export CHAIN_ID=97
export RPC_URL=https://bsc-testnet.bnbchain.org     # or your thirdweb endpoint
export PRIVATE_KEY=0x<your maker key>
export RFQ_ENGINE_WS=ws://<engine-host>:3030/maker   # ask us for the current testnet host

# 2. Mint yourself collateral (mocks are open-mint) (2 min)
cast send 0x9896AF08d261E52a629EF58cBebd32E8e0AA8eA9 \
  "mint(address,uint256)" $(cast wallet address $PRIVATE_KEY) 200000ether \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --legacy --gas-price 200000000

# 3. One-time setup: subaccount under Matching + 150k USDT cash (3 txs, ~2 min)
DEPOSIT_USDT=150000 pnpm --filter @sats-options/maker-bot setup
# -> "[setup] done: subaccount=<N> cash=150000 USDT"; id persisted to maker-state.97.json

# 4. Sanity-check pricing offline (no chain, no WS)
pnpm --filter @sats-options/maker-bot exec maker-bot price \
  --forward 62790 --strike 69000 --days 8 --vol 0.6 --rate 0.05
# -> { theo: ~398, bid: ~378 (0.95x), ask: ~418 (1.05x) }

# 5. Run the bot
pnpm --filter @sats-options/maker-bot dev
# [maker-bot] chain=97 owner=0x... subaccount=N
# [transport] authenticated as 0x...
# ...waits for rfq_open, prices off the on-chain feeds, quotes automatically

# 6. (optional) Trigger a test auction yourself from a second, taker-side subaccount:
curl -s -X POST http://<engine-host>:3030/rfq -H 'content-type: application/json' -d '{
  "subaccountId": "<takerSubId>",
  "instrument": { "asset": "BTC", "expiry": 1781856000, "strike": "69000", "isCall": true },
  "amount": "1", "direction": "sell" }'
# watch the bot log: quoted ... -> auction closed ... WON -> executed on-chain tx=0x...
```

Tuning knobs (env): `MAKER_BID_RATIO` (default 0.95 × theo), `MAKER_ASK_RATIO` (1.05, unused until
maker-sell flow ships), `MAKER_MAX_FEE` (default `"0"`), `QUOTE_TTL_SEC` (300), and pricing
overrides `FORWARD_PRICE`/`SPOT_PRICE`/`IV`/`RATE` (when forward-or-spot **and** IV are set, the
chain feeds are not queried at all — handy for dry runs).

**Adapting it:** the only protocol-shaped code in the bot is `src/transport.ts` (WS framing + auth)
and `src/quoter.ts` (order encoding + signing). Replace `src/pricing.ts`/`src/black76.ts` with your
own pricer and keep the other two; or port §3/§4 of this doc to your stack and use
`scripts/fake-engine.mjs` (a one-shot local engine that runs the handshake, broadcasts one RFQ, and
prints your quote) as a conformance test for your client.

---

## Appendix A: worked example — the live testnet trade

The first end-to-end covered-call on BSC testnet (2026-06-11), exactly as recorded in
`protocol/TESTNET.md` and asserted on-chain. Fill tx:
[`0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3`](https://testnet.bscscan.com/tx/0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3)
(`Matching.verifyAndMatch`, block 112792281).

**Setup.**
Maker EOA `0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8` ran `maker-bot --setup` → subaccount **5**,
deposited **150,000 USDT** cash. Taker EOA `0x5Deb87Dd07734d0cDc553BE1502825934514be0e` created
subaccount **6** via `Matching.createSubAccount(SRM)` and deposited **1 BTCB** via
`WrappedERC20Asset.deposit` (the covered-call collateral).

**Feeds** (signed by `0xdE50...782F`): BTC spot **62,790** (CoinGecko, cross-checked vs Chainlink
63,200.785, ~0.7% apart); forward(1781856000) = 62,790; rate = 5%; flat 60% IV SVI surface;
USDT stable = 1.0.

**Step 1 — RFQ.** Taker opened RFQ `501329a3-aa90-45cd-8607-f37f8439971d`: sell **1×
BTC-20260619-69000-C** (strike 69,000 ≈ 110% of spot; expiry `1781856000` = 2026-06-19 08:00 UTC;
subId `39614110892406511198553831168` per §4.5). Auction window: 8 s.

**Step 2 — Quote.** maker-bot priced Black-76 on the on-chain feeds:
F = 62,790, K = 69,000, T ≈ 8/365 y, σ = 0.60, r = 0.05 → **theo ≈ 398.51 USDT**; bid =
0.95 × theo = **378.586807763808053551 USDT**. It signed an Action (subaccount 5, module
RfqModule) whose data decoded to:

```text
RfqOrder { maxFee: 0, trades: [{
  asset:  0xD0dD8DcA596540F615e66E07F49d40647D8bC6eD,   // BTC OptionAsset
  subId:  39614110892406511198553831168,
  price:  378586807763808053551,                         // 378.5868... 18dp
  amount: 1000000000000000000 }] }                       // +1.0 (maker receives)
```

`orderHash = keccak256(abi.encode(trades)) = 0xda4e1328cc4e60399d45385c8e2ba93a8f255da3bcbaebf0be81c3b887adcdbd`.
It was the only quote (1 quote, 8 s window) → won.

**Step 3 — Accept + execution.** Taker signed
`TakerOrder{ orderHash: 0xda4e1328..., maxFee: 0 }` in their own Action (subaccount 6) and POSTed
it to `/rfq/:id/accept`. The engine submitted `verifyAndMatch([makerAction, takerAction],
[sig_m, sig_t], FillData{ makerAccount: 5, makerFee: 0, takerAccount: 6, takerFee: 0,
managerData: 0x })` as a legacy tx at 0.2 gwei.

**Step 4 — On-chain effects** (all asserted post-trade):

| Ledger move | Amount |
|---|---|
| Option `subId 3961…` taker → maker | 1.0 (taker −1, maker +1) |
| Cash maker → taker (premium) | 378.586807763808053551 USDT |
| OI fee, **each side** → fee-recipient subaccount 3 | `max(0.1 × 62,790, 10)` = **6,279 USDT** (12,558 total) |

Resulting balances: maker cash `150,000 − 378.5868… − 6,279 = 143,342.413192236191946449`;
taker cash `+378.5868… − 6,279 = −5,900.413192236191946449` (a borrow against their 1 BTCB —
exactly why the OI fee rate is flagged as a placeholder in §5.3). SRM initial margin passed for
both: taker IM 29,333.99 ≥ 0, maker IM 143,342.41 ≥ 0.

**Step 5 — Settlement (scheduled).** At expiry (2026-06-19 08:00 UTC) the ops side runs
`oracle-feeds settle --expiry 1781856000 --price <BTC fix> --subaccounts 5,6`. If BTC fixes above
69,000 the maker's long call is credited `(F_settle − 69,000) × 1` in cash and the taker debited
the same; OTM it expires worthless and the taker keeps the full premium (minus that OI fee).

---

## Appendix B: testnet address book (chainId 97)

Canonical source: `protocol/deployments/97.json`. RPC: `https://bsc-testnet.bnbchain.org`
(or thirdweb w/ key). Explorer: https://testnet.bscscan.com.

| Contract | Address |
|---|---|
| Matching (EIP-712 verifying contract) | `0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285` |
| RfqModule (`action.module` for quotes) | `0x2769E33b2169C83304cEa0c5C8fbC5a1707E305D` |
| SubAccounts | `0x99cE5Aa19B39a023A62cD70fe68712825Ad8cAD0` |
| StandardManager (SRM) | `0x4d55A929e184fc366664C11526E3B54aB70340B5` |
| SRM portfolio viewer | `0xbC9ae813B45Fa950AabE2E82eAB023Dd45a36486` |
| CashAsset (USDT cash) | `0x5d9e4EbD7E28deEF6f9A1a89Ed7Ce8608EE9074F` |
| BTC OptionAsset | `0xD0dD8DcA596540F615e66E07F49d40647D8bC6eD` |
| BTCB base asset (wrapped collateral) | `0xc17EbE645aca587d7D2077097D797133FE2a633e` |
| Mock BTCB (open mint) | `0x32fCF6a260Cdd2A3dc79cD0d4aD6B6c46bF6798A` |
| Mock USDT (open mint) | `0x9896AF08d261E52a629EF58cBebd32E8e0AA8eA9` |
| DepositModule / WithdrawalModule | `0x955E509aAe4e39A97B1E4Fe7FAa1f52182827Fc0` / `0x99179e96af7E7691Fc723da83Fabc15f61a724D4` |
| BTC spot / forward / vol / rate feeds | `0x69662A47…01b2C` / `0x86b7148B…9e05` / `0x5a892364…f0aE` / `0x11C394e9…d15D` (full addresses in §5.1) |
| Stable (USDT/USD) feed | `0x2Eeb9512F40c1964eCA5dc156D8e2479dA632116` |
| Trade executor / deployer / feed poster | `0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB` |
| Feed signer (testnet 1-of-1) | `0xdE50B8E965aD2B8E25f45a19FD87A2d2c737782F` |
| Fee recipient subaccount | `3` |
| Matching domain separator | `0x4cc5ab9a5a9e3993fe20da61e691a365b4b67a1339557e5b0437ba83097c84b5` |
| Action typehash | `0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17` |
