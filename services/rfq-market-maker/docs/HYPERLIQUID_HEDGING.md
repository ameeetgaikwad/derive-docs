# Hyperliquid hedging

Last reviewed: 2026-08-14. The package creates plans only. It has no Hyperliquid client, SDK, signer, or network code and cannot place an order.

## Why and when to hedge

A filled long call usually has positive BTC delta. Its first-order hedge is therefore a short BTC perpetual. The hedge reduces local directional exposure; it does not remove gamma, vega, theta, jump, volatility-surface, funding, basis, liquidity, margin, liquidation, settlement, or operational risk.

The only permitted hedge trigger is an **authoritative, maker-attributable confirmed option fill**. Do not hedge on:

- seeing an RFQ;
- generating or submitting a quote;
- receiving a quote acknowledgement;
- learning that the quote won an auction;
- a generic execution broadcast that is not filtered to the exact maker, subaccount, RFQ, quote, legs, and transaction;
- a timeout or inferred venue state.

Hedging an unfilled quote creates a naked perpetual position. Hedging the same fill twice creates an equally serious duplicate exposure.

## Portfolio target, not fill-by-fill inversion

The planner uses aggregate delta from confirmed, attributable option positions:

```text
target signed Hyperliquid position = -confirmed option delta
effective signed Hyperliquid position = current position + pending signed order quantity
residual = target - effective
```

Positive Hyperliquid position and order quantity mean long/buy; negative mean short/sell. A fill-by-fill `opposite side` rule is unsafe because existing inventory, partial hedges, prior fills, manual risk reduction, lot rounding, and corrections may make the correct order smaller, zero, or reversed.

`crossVenueDeltaBeta` converts Black-76 forward delta into hedge-reference units using the explicit v0 approximation:

```text
hedge delta per option underlying = forward delta * (option forward / hedge oracle) * beta
```

Accordingly, `confirmedOptionDeltaUnderlying` at the planner boundary means the aggregate result of that conversion for confirmed positions. It is hedge-equivalent delta, not raw Black-76 forward delta; the current name is less explicit than the required production schema.

Beta is an approved model parameter, not a free tuning knob. It needs empirical estimation, confidence bounds, and stress behavior before live use.

## Current planner algorithm

`planHyperliquidHedge` returns `NOOP`, `BLOCKED`, or `PLAN`.

1. Validate finite inputs, a non-negative safe-integer portfolio revision, non-empty correlation ID, and the effective shadow policy.
2. Compute target, effective position, and residual.
3. Block on **any** non-zero pending signed order quantity; even one that appears to reach target must be reconciled as fill/cancel state first.
4. Bind venue/network/account/coin to policy, then require non-empty snapshot identity, healthy/fresh/non-future/sufficiently confident data, positive oracle/mark, finite positive internally consistent account equity/margin, bounded mark/oracle divergence, and a finite positive two-sided non-crossed book inside the spread limit.
5. Only after those health/book/account checks, return `NOOP/WITHIN_DELTA_BAND` if residual is inside the no-trade band and current margin use is still inside the collateral-usage cap.
6. Round residual to the nearest configured lot. Return `NOOP/BELOW_ONE_LOT` if it rounds below one lot.
7. Block an outside-band rounded order below the configured minimum notional.
8. Walk the appropriate L2 side for the full rounded quantity inside an oracle-relative adverse-slippage cap.
9. Round the limit price in executable direction—buy up, sell down—and block if tick rounding crosses the slippage boundary.
10. Estimate projected stressed margin against independent Hyperliquid equity.
11. Return one IOC order intent, or two intents when a position would cross zero.

The planner rejects the whole book if any supplied level is non-positive/non-finite, either side is empty, or best bid is not below best ask. The lower-level simulator then sorts the validated directional levels by execution priority. A production snapshot builder must additionally validate sequence, precision, duplicate aggregation, and source continuity.

## Order intent

Each `PlannedIocOrder` contains:

- deterministic sequence number;
- 128-bit hexadecimal client order ID derived from SHA-256 of network, lowercased account address, coin, correlation ID, portfolio revision, and sequence;
- bound venue (`HYPERLIQUID`), network, account address, and coin;
- side, quantity, and limit price;
- explicit `reduceOnly` flag;
- `IOC` time in force;
- local `expiresAtMs`.

Hyperliquid documents IOC as canceling the unfilled portion rather than resting and accepts a 128-bit hexadecimal client order ID (`cloid`). Its exchange endpoint also supports an action-level `expiresAfter`. A live adapter must verify current venue metadata and encoding immediately before signing, set both bounded price and expiry, and persist the exact request before submission.

Deterministic client IDs are an idempotency/reconciliation key, not proof that a retry is harmless. On an unknown response, query by client ID plus open orders, order status, fills, and clearinghouse position before deciding whether another order is needed.

The current ID digest scopes identity to network/account/coin and covers correlation ID, portfolio revision, and sequence, but not price, size, side, market snapshot, or a full intent hash. Therefore production must make correlation identity unique per immutable persisted intent or derive the client ID from the complete canonical intent. Reusing one ID for a changed payload is prohibited.

## Position crossing

If the desired trade changes the sign of an existing perpetual position, the planner emits:

1. a reduce-only IOC quantity equal to the current position; then
2. a non-reduce-only IOC for the projected position on the other side.

Both are currently plans with the same directional limit. A production coordinator must execute/reconcile this sequence safely. It must not assume the first filled in full or submit the second from stale state. After every response or fill, recalculate the portfolio target from confirmed option inventory and authoritative current/pending hedge state.

## Partial fills and replanning

The quote gate requires enough displayed depth for a full initial hedge, but a submitted IOC can still partially fill because the book changes. Required production handling:

1. Persist `HEDGE_INTENT` before signing/submission.
2. Persist acknowledgement or unknown outcome without changing assumed filled position.
3. Consume order updates and fills, deduplicated by venue identity.
4. Reconcile position, open orders, fills, fees, funding, and client-order status through an independent query.
5. Record only confirmed filled quantity in hedge inventory.
6. Recompute target/residual from the newest confirmed option delta and current/pending perp state.
7. Retry only if data, collateral, expiry, slippage, attempt count, and operational policy still pass.

Attempts need bounded count/notional/time, exponential backoff for transport failures, and no backoff that lets an unsafe position silently persist. An unhedged confirmed delta outside emergency tolerance is an alert requiring an explicit runbook; the system must not remove the price cap merely to make the alert disappear.

## Margin and liquidation

The planner's margin estimate is deliberately conservative but simple:

- retain all venue-reported current margin usage;
- add configured initial margin only for an increase in absolute position;
- add a stress-move buffer for the entire projected absolute position;
- require it to fit below a configured fraction of Hyperliquid account equity.

This is not a replica of Hyperliquid margining. Production must source current asset metadata, leverage and margin mode, maintenance requirements, open-order effects, mark/oracle state, account equity, withdrawable collateral, liquidation distance, and any portfolio/cross-margin interactions. The hedge account should be dedicated or its unrelated risks explicitly modeled.

Because reported current margin is never subtracted, unrelated-position margin is not erased. A move strictly toward zero without crossing is classified as pure risk reduction and may produce a reduce-only IOC even when existing margin use is already above the collateral-usage cap; opening, increasing, or crossing-zero exposure remains blocked by projected margin. A within-band `NOOP` is also blocked when current margin already breaches policy. The planner rejects non-finite, non-positive, or internally inconsistent equity/margin; production adapters/signers must repeat validation against authoritative full-account data.

The option and hedge venues have fragmented collateral. A rally can make a long call economically valuable while the short perpetual loses cash and approaches liquidation before the option settles or its collateral can be transferred. Margin sizing must survive that path without relying on cross-venue netting.

## Funding

Current quote economics charges the adverse side of observed hourly funding plus a stress rate for an assumed holding period; it never credits favorable funding. Production must reconcile actual funding cash flows, model regime changes and sign conventions, and include funding in P&L and daily-loss controls.

Funding is a carrying cost, not a reason to reverse the delta hedge automatically. Any alternative hedge instrument or funding-aware optimization needs a separate decision record and risk approval.

## Why bounded IOC

IOC limit orders bound price and avoid leaving a passive hedge order after the decision context expires. The current planner chooses its cap from actual directional L2 depth and an oracle-relative slippage policy.

The official Python SDK's convenience `market_open` implementation has historically constructed an aggressive IOC limit order with a default slippage parameter. Production must not rely on a convenience default as risk policy. Pin and review the SDK/encoding version, supply an explicit planner-derived limit, verify asset/size/price precision, and test response parsing against current official schemas.

## Pre-live adapter requirements

- Restricted API wallet and isolated signer; master key not present in the service process.
- Persistent, monotonic nonce management consistent with Hyperliquid's current API-wallet rules.
- Correct account/vault/subaccount selection and independent account allowlist.
- Runtime metadata lookup for asset index, lot/size decimals, and price significant-figure rules.
- Exact fixed-point formatting and conservative rounding.
- IOC, reduce-only, `cloid`, and `expiresAfter` encoding verified from pinned official docs/SDK.
- Durable intent-before-action state and unknown-response reconciliation.
- WebSocket reconnect with snapshots plus REST/info backfill; sequence/gap detection.
- Reconciliation of `l2Book`, `orderUpdates`, `userFills`, funding, open orders, and clearinghouse state.
- Rate-limit budgets that reserve capacity for emergency reconciliation and risk reduction.
- Venue/testnet integration tests, fault injection, and a manual emergency procedure.

Primary links are collected in [References](REFERENCES.md).
