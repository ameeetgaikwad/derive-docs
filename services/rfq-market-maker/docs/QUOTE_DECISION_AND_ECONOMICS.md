# Quote decision and economics

Last reviewed: 2026-08-14. This describes the current deterministic shadow policy, not an approved live quoting strategy.

## Business decision

For the supported direction, the maker buys an option from the taker. A rational maximum bid is the value the maker assigns to that option minus every cost of acquiring, hedging, financing, carrying, and capitalizing it, minus compensation for risks that cannot be hedged.

The current engine answers one bounded question:

> Given one canonical RFQ, two timestamped market snapshots, fresh reconciled hedge-operational state, the portfolio plus every live reservation, and a versioned policy, may this candidate be quoted, and what is a conservative bid ceiling?

It does not estimate the chance of winning, the chance the taker accepts after the auction, competitor behavior, information leakage, or the optimal trade-off between spread and fill rate. Those require calibrated production data. The current quote is a deterministic shade below the reservation ceiling.

## Call contract

`evaluateQuote(input)` is intended to be referentially transparent. It returns:

- `DECLINE`: primary reason, deduplicated reason list, and all gates evaluated up to the fail-fast boundary; or
- `QUOTE`: economics, Greeks, executable initial-hedge preview, a risk-reservation proposal, and diagnostics.

The caller should validate policy at startup with `assertValidPolicy`; `evaluateQuote` also calls `validatePolicy` and declines an invalid effective policy. The engine does not write the ledger or send a quote. A returned quote is usable only if a coordinator commits its reservation using the exact `reservationLedgerVersion`; a CAS conflict invalidates the result.

Diagnostics bind a decision to evaluation time, policy/model versions, reservation-ledger version, and both snapshot IDs. Production audit records must additionally bind raw inputs, normalized exact values, code/build version, canonical instrument-registry version, and a deterministic decision hash.

## Gates and decline policy

Gates are evaluated in safety-oriented phases. A phase can fail fast, so later gates may not appear in a decline's diagnostics. Absence means “not evaluated,” never “passed.”

### Phase 0: policy, portfolio, and hedge operations

- Effective policy passes shadow invariants.
- Confirmed/reserved portfolio numbers are finite; gross/non-negative fields and reservation identity/version invariants pass.
- Reservation-ledger version is a non-negative safe integer and covers supplied reservations.
- Hedge reconciliation fields are finite/versioned, report healthy, and are fresh.
- No hedge order remains pending.
- Existing confirmed option-plus-perp residual is inside the quote-admission band.

These gates validate caller-supplied snapshots; they do not implement durable reconciliation or prove the `portfolioRevision` is linked transactionally to option inventory.

### Phase 1: identity, mandate, direction, and size

- RFQ, quote-attempt, instrument, and sub-ID labels are non-empty.
- Instrument identity has been verified by a trusted local registry.
- Option asset address is locally allowlisted.
- Underlying and settlement currency are supported.
- Direction is exactly `TAKER_SELLS_OPTION`.
- Kind is exactly `CALL` for v0.
- Contract quantity, multiplier, and normalized underlying quantity are finite and positive.
- Normalized quantity is inside the configured mandate.

### Phase 2: expiry and local time bounds

- RFQ/expiry times are finite, receipt is not beyond permitted future skew, and option has not expired.
- Time-to-expiry is within the product mandate.
- Enough quote-publication headroom remains.
- Auction and taker-acceptance windows do not exceed local maximums.
- Acceptance end is not before auction end.

### Phase 3: option snapshot

- Spot, forward, strike, IV, rate, and total candidate protocol/open-interest fee are finite; applicable prices are positive and fee is non-negative.
- Snapshot and source identifiers are non-empty.
- Source reports healthy.
- Observed and local-received timestamps are neither too old nor too far in the future.
- Normalized confidence meets policy.
- IV and annual rate lie inside supported model bounds.
- Absolute forward/spot deviation is within the configured tenor bound.

### Phase 4: product geometry and hedge snapshot

- Strike/forward moneyness is inside the mandate.
- Hedge oracle, mark, fee, funding, account equity, and current margin values are finite with required positive/non-negative signs; fee is below one and reported margin does not exceed reported equity.
- Venue, network, account address, and coin match policy and the verified option underlying.
- Snapshot/source identities are non-empty and L2 is non-empty, entirely finite/positive, two-sided, and non-crossed.
- Top-of-book spread is within policy.
- Venue reports healthy.
- Observed and received timestamps pass future-skew and freshness gates.
- Confidence meets policy.
- Absolute mark/oracle and option-spot/hedge-oracle deviations are within policy.

### Phase 5: model and executable hedge

- Black-76 values the candidate and converts forward delta to hedge-reference delta.
- Model premium, Greeks, current delta, and stress outputs are finite/non-negative where required.
- An outside-band initial hedge meets the configured minimum order notional.
- Directional Hyperliquid L2 can fill the entire initial hedge quantity within the adverse-slippage cap, unless current delta is inside the no-trade band; that case produces an executable zero-quantity preview while still reserving future hedge capacity.

No partial initial hedge is accepted by the quote engine. The quote gate rejects any invalid level or crossed/incomplete book before the lower-level simulator (which independently filters invalid levels) is called.

### Phase 6: independent hedge collateral

The engine estimates candidate stressed hedge margin and requires:

```text
current Hyperliquid margin used
+ margin reserved by other live quotes
+ maximum scenario hedge notional * (initial-margin fraction + stress-move fraction)
<= Hyperliquid account equity * maximum collateral-usage fraction
```

This is a policy approximation, not Hyperliquid's authoritative margin calculation. A production adapter must use current venue metadata and account state, apply a conservative buffer, and reconcile portfolio/cross-margin effects.

### Phase 7: positive executable bid

- Conservative fair value exceeds all modeled deductions.
- The shaded and tick-rounded bid is positive and meets the configured total-premium minimum.

### Phase 8: portfolio risk

Confirmed slices, every other live reservation, and the candidate must remain within every hard limit. A reservation with the same `rfq:<rfqId>` identity is removed before replacement evaluation so retrying one RFQ does not double count it.

Stable decline codes are defined in `src/decision/reason-codes.ts`. They are operational classifications, not permission to retry blindly. Retry policy depends on cause: stale data may clear; an unverified instrument must not be retried without registry correction; a CAS conflict requires full recomputation.

## Black-76 values used

Let:

- `F` be option forward USD/underlying;
- `K` strike USD/underlying;
- `T` time to expiry in 365-day years;
- `sigma` annual IV as a decimal;
- `r` continuously compounded annual rate;
- `q` normalized maker option quantity in underlying units.

The model fair value is:

```text
modelFairValueUsd = Black76(F, K, T, sigma, r, kind).premium * q
```

For this long-option bid, conservative value is the minimum premium across a small scenario grid:

```text
F scenario: F * (1 - forwardShock), F, F * (1 + forwardShock)
IV scenario: max(minimumIV, sigma - volatilityHaircut), sigma
conservativeFairValueUsd = minimum scenario premium * q
```

This grid is deliberately simple. It is not a calibrated volatility surface, confidence interval, stress library, or independent valuation. The fact that an up-forward scenario cannot lower a call price does not make the grid harmful, but it does not add useful downside conservatism for the call; production scenario design must be validated empirically.

## Reservation stress

Pricing conservatism and capacity conservatism are separate. The reservation engine evaluates a second grid using synchronized spot/forward/hedge-price multipliers of `1 - spotMove`, `1`, and `1 + spotMove`, crossed with IV at observed value and configured up/down absolute shocks clipped to model bounds. It reserves the independently greatest absolute delta, gamma, and vega plus maximum hedge notional across those scenarios. Hedge margin is derived from that stressed notional.

Because each Greek maximum can come from a different scenario, the reservation is deliberately conservative rather than a coherent single P&L scenario. The shadow grid is still bounded and does not prove capacity for a large jump or a long call's delta approaching one; production tail stresses remain mandatory.

For the preliminary slice used to calculate concentration increase, protocol cash is conservative fair value plus supplied fees because the final bid is not known yet. The final reservation and hard cash-limit check replace that amount with quoted premium plus supplied fees.

## Cost stack

All cost terms are non-negative deductions. Favorable spread or funding is not credited in v0.

| Output field | Current calculation | Responsibility of future calibration |
| --- | --- | --- |
| `protocolAndOiFeesUsd` | Caller-supplied total fee for this RFQ | Exact Derive fee/OI simulation for the maker subaccount and candidate |
| `initialHedgeSpreadSlippageUsd` | Adverse difference between oracle and simulated L2 VWAP times hedge size; favorable difference floored at zero | Book quality, latency, rejected/partial orders, market impact |
| `initialHedgeTakerFeeUsd` | Simulated traded notional times taker-fee rate | Actual account fee tier and any builder fee |
| `expectedRehedgingCostUsd` | Current-delta initial hedge notional × expected turnover × (taker fee + assumed slippage) | Historical gamma-driven turnover by expiry/moneyness/regime |
| `expectedFundingCostUsd` | Current-delta initial hedge notional × holding hours × (currently adverse hourly funding + stress) | Funding path distribution, holding horizon, sign, caps, and regime changes |
| `basisSettlementLatencyChargeUsd` | Current-delta initial hedge notional × configured bps | Derive/Hyperliquid basis, settlement mismatch, transfer and confirmation delay |
| `adverseSelectionChargeUsd` | Conservative option value × configured bps | RFQ toxicity by taker, size, response latency, and surface move |
| `modelRiskChargeUsd` | Conservative option value × configured bps | Surface/model uncertainty and source disagreement |
| `capitalChargeUsd` | Estimated stressed initial margin × configured bps | Actual hurdle rate, duration, and independent collateral usage |
| `incrementalPortfolioRiskChargeUsd` | Conservative value × max charge × increase in squared maximum utilization | Calibrate inventory demand curve and include omitted limit dimensions |
| `requiredProfitUsd` | Max of absolute floor and conservative value × profit bps | Approved return target net of all overlapping charges |

For a planned sell hedge, negative Hyperliquid funding is treated as adverse; for a buy hedge, positive funding is adverse, matching the normalized convention that positive funding is paid by longs. Credits are ignored.

The concentration term uses:

```text
increase = max(0, postCandidateMaxUtilization^2 - preCandidateMaxUtilization^2)
charge = conservativeFairValue * maxConcentrationChargeRate * increase
```

Current maximum utilization covers portfolio delta, aggregate gross gamma/vega, per-expiry gross vega, option notional, protocol cash outflow, hedge notional, and hedge margin. It does not include live-reservation count, drawdown, or halted state; those remain hard gates but do not affect the concentration charge.

## Bid construction

```text
totalDeductions = sum(all cost fields, including requiredProfit)
reservationBidCeiling = conservativeFairValue - totalDeductions
shadedCeiling = reservationBidCeiling * (1 - quoteShadeBps / 10,000)
quotedUnitPremium = floor(shadedCeiling / q, premiumTick)
quotedTotalPremium = quotedUnitPremium * q
```

Flooring protects a buyer's maximum bid from tick rounding upward. A live exact-arithmetic layer must repeat this rounding conservatively.

The reported `expectedModelEdgeUsd` is:

```text
modelFairValue - quotedTotalPremium - (totalDeductions - requiredProfit)
```

It is a model diagnostic, not expected realized P&L. Required profit is excluded from the realized-cost subtotal because it is a target, while the difference between model and conservative value remains visible as additional model buffer.

## How the maker can profit—and lose

The maker profits if option value ultimately realized exceeds premium plus all actual costs. Delta rebalancing can monetize long gamma when price oscillates, and higher realized/implied volatility can benefit a long-vega inventory. Those are possibilities, not guarantees. Long options also decay, hedges incur spread/fees/funding, volatility can fall, prices can jump through liquidity, and cross-venue basis can widen.

The production quoting objective may eventually be:

```text
maximize P(win | bid, context)
       * P(accepted | win, bid, context)
       * E[profit | filled, bid, context]
subject to bid <= reservationBidCeiling and every hard risk constraint
```

That optimizer is explicitly deferred until shadow decisions, auction outcomes, accepted fills, counterfactual marks, hedge executions, and attribution are collected without leakage or survivorship bias. It may only improve price inside the hard ceiling; it cannot override a decline gate.

## Known omissions before live quoting

- Multi-leg/net-premium RFQs and general Derive direction semantics.
- Exercise/settlement cash-flow simulation and lifecycle inventory.
- Calibrated forward curve and volatility surface with arbitrage checks.
- Taker segmentation and adverse-selection model governance.
- Real fee/OI and margin simulation at signing time.
- Quote cancellation/expiry races and exact maximum-fee construction.
- Winning/acceptance probability and competitor response models.
- Stress scenarios for jumps, IV skew/twist, basis, funding, liquidity, depeg, and venue outage.
- Exact fixed-point recomputation and independently reproduced reference prices/Greeks.
