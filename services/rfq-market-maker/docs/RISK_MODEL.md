# Risk model

Last reviewed: 2026-08-14. Current values are shadow examples, not approved risk appetite.

## Principle: reserve before exposure can become real

An RFQ quote is an option granted to the taker during its valid window. The maker may not know which live quotes will be selected, so it must assume all can fill. The portfolio checked for a new quote is:

```text
confirmed position slices
+ every unreleased live, expired-but-unreconciled, or otherwise uncertain quote reservation
+ candidate reservation
```

Expected fill probabilities cannot discount hard exposure. Netting between mutually exclusive quotes is allowed only when exclusivity is cryptographically/protocol-enforced and represented atomically in the state model; it is not supported now.

## Exposure slice

Each confirmed position or reservation belongs to a UTC expiry-date bucket and carries:

| Measure | Aggregation | Purpose |
| --- | --- | --- |
| `netOptionDeltaUnderlying` | Signed sum, absolute limit | Unhedged first-order option exposure and hedge requirement |
| `netGammaUsdForOnePercentSquared` | Signed sum, currently diagnostic | Directional convexity |
| `grossGammaUsdForOnePercentSquared` | Sum of absolutes supplied per slice | Prevent offsetting long/short gamma from hiding inventory |
| `netVegaUsdPerVolPoint` | Signed sum, currently diagnostic | Directional IV exposure |
| `grossVegaUsdPerVolPoint` | Sum of absolutes | Aggregate and per-expiry volatility inventory |
| `grossOptionNotionalUsd` | Additive | Coarse size/capital proxy |
| `protocolCashOutflowUsd` | Additive | Quoted premium plus caller-supplied protocol/open-interest fees |
| `hedgeNotionalUsd` | Additive | Expected first-order hedge turnover/venue exposure |
| `hedgeInitialMarginUsd` | Additive | Stressed independent hedge collateral reservation |

For the current long-call-only product, gamma and vega are positive. The schema is prepared for signed inventory, but the current mandate must not be widened merely because a type can represent it.

The delta field remains option delta rather than netting the current perpetual position into it. Hedge state is reconciled separately; otherwise an already hedged option could appear to require no risk reservation even though the hedge might fail or be liquidated.

All state entering aggregation needs runtime validation for finiteness, allowed signs, range, unit, portfolio revision, source time, and freshness. `evaluateQuote` now invokes `validatePortfolioRiskState`, which rejects non-finite exposure/P&L, negative gross/cash/notional/margin measures, gross values below absolute net values, empty/duplicate reservation identities, and invalid reservation versions/expiries. It separately validates ledger and hedge-operational fields. This closes the direct `NaN` comparison failure in quote admission, but production still needs a strict decoded schema, durable portfolio-revision linkage, state freshness, and exact arithmetic at the coordinator/signer boundary.

## Candidate calculations

Let `q` be normalized option quantity and `H` the Hyperliquid oracle reference. Candidate measures include:

```text
currentOptionDelta = q * forwardDelta * (forward / H) * crossVenueBeta
scenario price multipliers = 1 - stressMove, 1, 1 + stressMove
scenario IV = observed IV - stress, observed IV, observed IV + stress (clipped)
reservedDelta/Gamma/Vega = independently greatest absolute scenario value
reservedHedgeNotional = maximum scenario abs(delta) * scenario hedge price
reservedHedgeMargin = reservedHedgeNotional * (initialMarginFraction + collateralStressMoveFraction)
grossOptionNotional = q * forward
currentVega = q * Black76VegaPerVolPoint
currentGamma1Percent = 0.5 * convertedSpotGamma * (spot * 1%)^2 * q
protocolCashOutflow = quotedTotalPremium + protocolAndOiFees
```

The scenario grid is a material improvement over reserving only current delta, and a no-trade-band quote still reserves stressed future hedge capacity. It remains a bounded placeholder: live stress must cover approved jumps and delta migration over the quote/finality/hedge horizon—for example a long call moving materially toward delta one. Cash reservation currently includes quoted premium plus the supplied protocol/OI total; the exact signed maximum fee and any exercise/settlement obligation must also be proven covered at the live intent boundary.

The gamma conversion assumes `dF/dS = beta * F/S` and squares this factor. It ignores the derivative of beta and forward/spot ratio, smile dynamics, discrete hedging, and jumps.

## Hard limits

The current engine emits one or more stable breach codes:

| Code | Bound |
| --- | --- |
| `DELTA_LIMIT` | Absolute aggregate net option delta |
| `GAMMA_LIMIT` | Aggregate gross gamma for a 1% move |
| `VEGA_LIMIT` | Aggregate gross vega per vol point |
| `EXPIRY_VEGA_LIMIT` | Gross vega within each UTC expiry date |
| `OPTION_NOTIONAL_LIMIT` | Aggregate gross option forward notional |
| `CASH_LIMIT` | Aggregate protocol cash outflow (quoted premium plus supplied protocol/OI fees) |
| `HEDGE_NOTIONAL_LIMIT` | Aggregate expected hedge notional |
| `HEDGE_MARGIN_LIMIT` | Aggregate stressed hedge margin reservation |
| `LIVE_QUOTE_LIMIT` | Number of live reservations plus candidate |
| `DAILY_DRAWDOWN_LIMIT` | `max(0, -realizedPnlTodayUsd)` |
| `QUOTING_HALTED` | Explicit operational halt flag |

Comparison includes a small floating-point tolerance in the shadow code. Live checks must use exact, conservative arithmetic without weakening the configured bound.

`maxDailyLossUsd` is only as sound as the caller's P&L. Production P&L must include realized option and hedge cash flows, fees, funding, settlements, transfers, and manual adjustments, with an explicit timezone/reset policy. An unreliable P&L feed must halt quoting.

## Reservation lifecycle

A quote decision proposes a reservation with:

- stable ID `rfq:<rfqId>`;
- the RFQ ID;
- the ledger version on which it was evaluated;
- acceptance expiry plus finality buffer;
- expiry bucket and full exposure.

Required production transitions are:

1. Reserve atomically before sending or signing the quote.
2. If quote submission definitively fails before exposure exists, release with an audited reason.
3. If the outcome is unknown, keep reserved and reconcile; do not infer failure from timeout.
4. If the quote expires/cancels without fill, release only after authoritative state and the finality/race window.
5. If filled, atomically remove the reservation and add the exact confirmed fill exposure. Partial fills, if protocol-supported, must promote only the filled part and retain the remainder correctly.
6. Reprice Greeks from the actual signed/fill terms and current canonical instrument data; do not blindly copy a stale quote estimate into accounting.

The in-memory ledger implements only versioned upsert/release and snapshots that conservatively retain every reservation until explicit release. It does not implement authoritative terminal-state reconciliation or the production lifecycle.

## Independent Hyperliquid collateral

The quote gate separately checks estimated current, reserved, and candidate hedge margin against a fraction of Hyperliquid-reported equity. This recognizes fragmented collateral: a profitable Derive option position cannot instantaneously support a losing Hyperliquid hedge.

Before live, collateral policy must additionally account for:

- venue maintenance and initial margin rules, leverage tier, and portfolio/cross-margin behavior;
- oracle/mark divergence and liquidation mechanics;
- open-order margin and pending withdrawals/transfers;
- adverse price and volatility gap while the option venue is unavailable;
- stablecoin/depeg and bridge/withdrawal delays;
- fee, funding, and liquidation buffers;
- inability to use expected option settlement proceeds until actually credited and transferable.

The current hedge planner preserves all reported `currentMarginUsedUsd`, adds initial margin only for an increase in absolute position, and adds a stress buffer for the projected absolute position. This permits a genuinely position-reducing reduce-only plan when capacity remains inside policy without pretending reported margin disappeared. It is still an analytics approximation: live control must use authoritative full-account/open-order requirements, verify every account value at runtime, and conservatively model cross/portfolio-margin behavior.

## Stress framework required before live

Hard scalar limits are necessary but insufficient. A production risk service must calculate at least:

- spot jumps up/down across approved magnitudes;
- IV level, skew, and term-structure shocks;
- forward/spot and Derive/Hyperliquid basis widening;
- one venue trading while the other is halted;
- L2 depth disappearance and slippage beyond displayed liquidity;
- funding sign reversal and prolonged adverse funding;
- delayed option finality, exercise, settlement, and collateral transfers;
- correlated filling of every live reservation;
- partial/duplicate/out-of-order event handling;
- Hyperliquid margin deterioration and liquidation proximity;
- stablecoin and oracle-source failures.

Limits and stress magnitudes require written risk-owner approval, evidence from historical and hypothetical scenarios, and a change-controlled policy version.

## Inventory and hedge separation

The service should maintain three related but distinct views:

1. **Economic option inventory:** confirmed positions and Greeks by instrument/expiry.
2. **Quote optionality:** all live reservations as if filled.
3. **Execution hedge state:** current perpetual position, pending order quantities, fills, fees, and funding.

The quote engine uses (1) + (2) for risk and separately requires fresh healthy hedge reconciliation, zero pending orders, and existing confirmed option-plus-perp residual inside the admission band. The hedge planner uses confirmed attributable hedge-equivalent delta from (1), current/pending state from (3), and never reservations. Any non-zero pending signed order blocks a new plan until reconciled; it is not treated as a fill. Hedging a reservation before it fills would create a naked perpetual position if the taker declines.

## Limit governance

No default becomes a production limit through deployment. Live policy requires:

- named risk owner and approver;
- rationale, data window, stress evidence, and effective time;
- separate testnet, shadow, canary, and production values;
- four-eyes review for increases;
- automated validation plus independent exact recomputation;
- rollback version and immutable audit trail;
- ceilings enforced independently by the coordinator and signer;
- emergency decreases that take effect without requiring a deploy.

Configuration validation in `src/config.ts` checks many values for positivity/fraction ranges but does not prove semantic consistency among all minima/maxima or suitability for a product. It is input hygiene, not risk approval.
