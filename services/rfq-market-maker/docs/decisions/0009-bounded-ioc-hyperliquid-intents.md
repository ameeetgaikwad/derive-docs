# ADR 0009: Bounded IOC Hyperliquid intents

- Status: Accepted
- Date: 2026-08-14
- Implementation: Directional book simulation, tick rounding, deterministic client IDs, expiry, reduce-only flags, and plan outputs exist. No venue adapter exists.

## Context

A “market order” convenience call can be an aggressive limit with a broad default slippage allowance. A passive or GTC hedge may remain open after its risk context expires. Displayed liquidity can disappear before submission, and ambiguous responses can cause duplicate orders.

## Decision

Plan explicit IOC limit orders whose entire desired quantity is visible inside an oracle-relative adverse-slippage cap. Derive the limit from directional L2, round in executable direction without crossing the cap, use deterministic 128-bit client order IDs, explicit reduce-only behavior, and a short local expiry intended to map to venue `expiresAfter`.

If a position crosses zero, plan a reduce-only close before a non-reduce-only open and reconcile between them. Partial/rejected/unknown results cause state reconciliation and residual replanning, never an unbounded price chase.

## Consequences

- IOC prevents an unfilled remainder from resting, while the limit bounds execution price.
- Full displayed depth at decision time does not guarantee a full fill; the coordinator must handle partial/zero execution.
- Deterministic client IDs aid lookup/deduplication but do not make blind retries safe.
- The current digest includes network, lowercased account, coin, correlation ID, portfolio revision, and sequence but omits price, size, side, and snapshot; production must bind a unique correlation ID to one immutable intent or hash the complete canonical intent before submission.
- Tick/lot and asset metadata must be loaded and verified for the live venue.
- Current margin estimation retains all reported margin, adds incremental opening margin and projected-position stress, and permits a strictly position-reducing reduce-only order even when existing margin is above policy. Opening/increasing/cross-zero exposure remains gated. This is still a placeholder rather than authoritative Hyperliquid full-account margining.

## Rejected alternatives

- **SDK convenience market order with default slippage:** rejected because implementation defaults are not approved risk limits.
- **Unpriced market order:** rejected because it leaves tail execution unbounded.
- **GTC hedge order:** rejected because it can rest after the state/price context changes.
- **Post-only hedge:** rejected as the default emergency delta response because it may not fill while risk grows.
- **Automatically widen/retry until filled:** rejected because it bypasses the approved loss/collateral boundary.

## Revisit when

Alternative execution—sliced IOC, short-lived GTC, TWAP, maker-first, or venue routing—requires measured size/latency/impact benefit, bounded failure behavior, idempotent reconciliation, and risk approval. The emergency policy may differ but remains explicitly capped and audited.
