# ADR 0004: Black-76 baseline valuation

- Status: Accepted
- Date: 2026-08-14
- Implementation: Analytical premium, forward delta/gamma, vega per vol point, and calendar theta exist using JavaScript numbers.

## Context

An options maker needs a coherent value and Greeks before it can charge for fees and inventory risk. The option snapshot is expressed using a forward and annual implied volatility, matching the Black forward-option formulation.

## Decision

Use Black-76 as the transparent v0 baseline, with explicit `F`, `K`, `T`, IV, and rate inputs. Convert forward delta to hedge-reference underlying through the documented `F / hedgeReference * beta` approximation. For the long-option bid, use the minimum value across a small forward/IV scenario grid before subtracting costs.

Use JavaScript `number` only inside shadow analytics. Independent high-precision validation and exact conservative wire recomputation are mandatory before live.

## Consequences

- The formula and analytical Greeks are fast, explainable, and independently reproducible.
- Results depend critically on forward, surface IV, rate, contract semantics, and beta supplied by missing adapters.
- Black-76 does not model jumps, stochastic volatility, discrete hedging, crypto tails, cross-venue basis, collateral, or liquidation.
- The fixed scenario grid and haircut are policy buffers, not statistical confidence intervals.

## Rejected alternatives

- **Multiply a public option price by a constant bid ratio:** rejected because it does not expose Greeks, hedge cost, fees, or portfolio risk.
- **Copy one external venue mark as truth:** rejected because instrument, forward, settlement, liquidity, and basis may differ and source confidence disappears.
- **Begin with a complex stochastic/local-vol model:** deferred because complexity without governed/calibrated data reduces auditability and may create false precision.
- **Use spot Black-Scholes without an explicit carry model:** rejected for the current forward-based input contract.

## Revisit when

Replace or augment the model after independent replay shows material, stable error and the proposed model has governed data, calibration, stress behavior, explainability, latency bounds, reference tests, versioning, and rollback. A new model can never bypass hard risk gates.

