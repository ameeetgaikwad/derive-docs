# ADR 0008: Hedge confirmed portfolio delta to a target

- Status: Accepted
- Date: 2026-08-14
- Implementation: A pure planner computes target and intents. No fill ingestion, portfolio accounting, or execution exists.

## Context

The naive rule “after an option trade, place the opposite perpetual trade” fails with existing inventory, multiple fills, partial hedges, pending orders, lot rounding, corrections, and cross-venue delta conversion. Hedging a quote before fill creates naked risk.

## Decision

Generate hedge demand only from confirmed, maker-attributable option positions. Aggregate their **cross-venue hedge-equivalent underlying delta**—not raw Black-76 forward delta—and target the negative signed Hyperliquid position:

```text
target = -confirmedHedgeEquivalentOptionDelta
residual = target - (confirmedPerpPosition + pendingSignedOrderQuantity)
```

Reservations do not enter confirmed option delta. Pending signed order quantity affects the displayed effective position only for reconciliation diagnostics; it is not a fill, confirmed position, cash flow, P&L, or authoritative margin state. Any non-zero pending quantity blocks another plan—even if it appears to reach target—until reconciliation.

## Consequences

- A long call normally produces a sell/short hedge; an always-long hedge rule is wrong.
- Each confirmed fill or hedge fill advances portfolio state and causes target recomputation rather than mechanical inversion.
- Accurate canonical Greeks, fill attribution, current positions, and pending-order reconciliation are mandatory.
- Delta neutrality remains approximate and leaves gamma/vega/theta/jump/basis/funding/margin risks.
- Beta, lot rounding, and no-trade band introduce residual risk that must be measured.

## Rejected alternatives

- **Hedge on RFQ receipt, quote, acknowledgement, or auction win:** rejected because no confirmed option position exists.
- **Hedge each fill by a fixed percentage independently:** rejected because portfolio interactions and prior hedges are ignored.
- **Use raw forward delta directly as BTC perpetual quantity:** rejected because forward/reference units and approved cross-venue beta matter.
- **Assume pending order fully filled:** rejected because IOC can reject or partially fill.
- **Net live quote reservations into hedge target:** rejected because unaccepted quotes would create naked perpetuals.

## Revisit when

Gamma/vega hedging, futures-tenor hedges, spot hedges, or optimization across instruments require a new ADR, executable-liquidity and collateral models, and evidence that operational complexity improves risk-adjusted outcomes.
