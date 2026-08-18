# ADR 0007: Reserve all live quotes with compare-and-swap

- Status: Accepted
- Date: 2026-08-14
- Implementation: Quote decisions propose exposure and an in-memory versioned ledger demonstrates CAS. Durable lifecycle is not implemented.

## Context

Every signed live quote can fill until definitively canceled or expired. Concurrent RFQs evaluated against the same portfolio can each pass alone and breach limits together. A taker-selection probability does not cap worst-case exposure.

## Decision

Treat every potentially live quote as fully fillable. Evaluate confirmed inventory plus all live reservations plus the candidate. Before a quote can be signed/sent, atomically commit its reservation against the portfolio/ledger revision used for evaluation. On conflict, discard the decision and recompute.

Keep the reservation until authoritative non-fill release or atomically promote it to exact confirmed position on fill. Unknown outcomes remain reserved. Replacement for the same stable RFQ identity may update rather than double count, but only transactionally.

Current shadow reservations include quoted premium plus caller-supplied protocol/OI fees and reserve independently worst delta/gamma/vega, maximum hedge notional, and stressed margin across a bounded spot/IV grid. Live content must additionally prove complete signed-fee/lifecycle cash capacity and approved jump/tail delta migration beyond that placeholder grid.

## Consequences

- Quoting capacity may be lower than an expected-fill model suggests.
- Concurrency becomes explicit and testable.
- The process needs durable transactions, lifecycle reconciliation, expiry/finality races, and single-writer fencing before live.
- Reservation estimates must be reconciled to actual signed terms and fills.
- In-memory CAS is illustrative only and losing it on restart is unsafe.

## Rejected alternatives

- **Reserve only after auction win or fill:** rejected because the maker can accumulate more binding quotes than its capacity before that point.
- **Discount reservations by fill probability:** rejected for hard limits because correlated taker selection can realize the tail.
- **Check risk independently in each worker:** rejected because stale concurrent views oversubscribe capacity.
- **Expire reservations using local time alone:** rejected because cancellation/fill/finality races and unknown venue outcomes remain.

## Revisit when

Protocol-enforced mutual exclusion could allow atomic grouped reservation after formal verification of that exclusivity and lifecycle. Statistical fill probability may influence price/capital charges, never bypass hard worst-case reservation without a new risk decision.
