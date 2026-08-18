# ADR 0005: Fail closed on market-data uncertainty

- Status: Accepted
- Date: 2026-08-14
- Implementation: Health, observed/received freshness, future skew, confidence, IV bounds, mark/oracle divergence, and directional depth gates exist; live adapters and complete runtime binding do not.

## Context

An apparently profitable quote based on stale IV or an unavailable hedge is often an adverse-selection opportunity for the taker. Silent fallback values can keep a process available while making its economic state unknowable.

## Decision

Decline a quote or block a hedge when required data is unhealthy, stale, future-dated beyond skew, low confidence, invalid, internally divergent, or lacks executable depth. Preserve source and timing metadata. Do not silently substitute a constant, last-good value, or lower-quality source.

A fallback is allowed only as a separately approved complete source with explicit identity, confidence, timestamp, mapping, and arbitration. Runtime shadow checks now bind hedge venue/network/account/coin, snapshot/source identity, book validity/spread, account values, and price/basis relationships. Live adapters/signers must repeat those checks against authoritative metadata and raw source continuity.

## Consequences

- The service will miss trades during source or venue problems.
- Adapters need precise health/confidence and gap semantics rather than a boolean hardcoded for convenience.
- Redundancy improves availability only after validating source independence and disagreement behavior.
- Exposure may still need emergency handling when data is bad; quote halt does not imply risk disappears.

## Rejected alternatives

- **Use last known price/IV:** rejected because age and market regime are precisely the risk.
- **Fallback without lowering confidence:** rejected because it hides provenance and quality.
- **Quote wider when hedge depth is absent:** rejected because a wider theoretical spread does not create executable collateralized liquidity after a fill.
- **Trust TypeScript literal types for venue/coin:** rejected because they are erased at runtime.

## Revisit when

An alternative data source may be enabled after replay, outage, manipulation, timestamp, divergence, and failover tests demonstrate conservative behavior and policy/model versions record the switch.
