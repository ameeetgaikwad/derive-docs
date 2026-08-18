# Market data and models

Last reviewed: 2026-08-14. The package consumes caller-built snapshots; it implements no feed or model calibration service.

## Snapshot contract

Every decision uses two immutable logical snapshots with unique IDs and common metadata:

- source name;
- source observation time;
- local receive/assembly time;
- health flag;
- normalized confidence in `[0, 1]`.

The option snapshot contains spot, forward, annual IV, annual rate, and total candidate protocol/open-interest fees. The hedge snapshot contains venue, network, account address, coin, oracle, mark, directional L2 levels, taker-fee rate, hourly funding, Hyperliquid account equity, and current margin used.

The quote decision records both snapshot IDs. In production, a snapshot ID must content-address or uniquely reference the exact raw messages, normalized values, source cursors, sequence/gap state, adapter version, and registry version used.

The quote engine requires non-empty snapshot/source strings; these are still caller assertions in shadow mode. Production snapshot identity must be collision-resistant and tied to retained source evidence before freshness or confidence is meaningful.

## Required source binding

TypeScript literal types disappear at runtime, so the kernel checks the values: quote admission binds venue to `HYPERLIQUID`, coin to the verified RFQ underlying, and network/account address to hedge policy. The planner independently binds the same four fields and copies them into every order intent. A production normalizer and signer must additionally prove that:

- chain/environment, Derive option asset, sub-ID, underlying, and settlement resolve through the approved registry;
- hedge venue equals the configured approved venue/account;
- hedge coin/asset metadata resolves to that underlying;
- units, multiplier, index/asset ID, size decimals, and price rules match current venue metadata;
- no symbol alias can silently map to a different product.

Quote admission also rejects a malformed/crossed/incomplete L2, excessive top-of-book spread, excessive forward/spot deviation, excessive Derive-spot/Hyperliquid-oracle basis, and excessive Hyperliquid mark/oracle deviation. These are fixed shadow bounds over caller-built snapshots, not feed integrity or venue metadata implementations.

The delta input to `planHyperliquidHedge` is cross-venue **hedge-equivalent underlying delta** after the forward/reference ratio and approved beta conversion. It is not raw Black-76 forward delta. Production naming and schemas must make that distinction unambiguous.

## Freshness and confidence

Both observed and received ages are checked. This catches an old source timestamp delivered recently and a locally queued update whose source timestamp still appears recent. Excessive future skew also fails.

`healthy` and `confidence` are inputs, not self-authenticating facts. Each adapter needs a written construction rule. Examples of health failures include:

- disconnected or reconnecting stream;
- sequence gap or snapshot/delta mismatch;
- excessive latency or clock uncertainty;
- malformed, crossed, empty, or implausible book;
- stale surface nodes or unsupported extrapolation;
- source disagreement beyond a policy bound;
- account query older than the market query;
- missing fee, funding, margin, or instrument metadata;
- rate limiting that prevents timely reconciliation.

Confidence must combine observable quality signals and preserve why it changed. A hardcoded `1` is appropriate only for a local fixture, never a live adapter.

## No silent fallback

If the primary source fails, the safe result is decline/block unless a pre-approved fallback adapter:

1. supplies the same complete schema and units;
2. preserves source identity, observation/receive time, and confidence;
3. has a documented forward/IV/basis mapping and independent health checks;
4. passes cross-source deviation/arbitrage gates;
5. is represented in the policy/model version and audit record.

A last-good value is stale data, not a fallback. Replacing missing data with a constant or silently switching venues is prohibited.

## Black-76 v0

The current model follows Black's forward-option formulation. Let:

```text
d1 = [ln(F/K) + 0.5 * sigma^2 * T] / (sigma * sqrt(T))
d2 = d1 - sigma * sqrt(T)
D  = exp(-rT)
call = D * [F*N(d1) - K*N(d2)]
put  = D * [K*N(-d2) - F*N(-d1)]
```

Analytical outputs are:

```text
forward call delta = D*N(d1)
forward put delta  = -D*N(-d1)
forward gamma per USD = D*n(d1) / [F*sigma*sqrt(T)]
vega per 1 vol point = D*F*n(d1)*sqrt(T) / 100
calendar theta per day, holding F and IV fixed
  = [r*premium - D*F*n(d1)*sigma/(2*sqrt(T))] / 365
```

The normal CDF is a local numerical approximation. Inputs must have positive forward, strike, time, and volatility; rate may be negative if finite.

## Model assumptions and limitations

Black-76 is a baseline, not a claim that crypto options satisfy all assumptions. Current gaps include:

- one forward and one IV rather than a governed term structure and volatility surface;
- no bid/ask IV uncertainty or executable Derive order-book cross-check;
- lognormal continuous dynamics without jumps or fat tails;
- deterministic rate and forward input;
- no stochastic volatility, skew dynamics, or local-vol effect;
- European-style analytical value without independent contract exercise/settlement simulation;
- continuous-frictionless hedging assumptions versus discrete cross-venue execution;
- static cross-venue beta and forward/reference conversion;
- no collateral, liquidation, default, depeg, or operational value adjustment;
- binary floating-point rather than a high-precision reference implementation.

Before live, prices and Greeks must be reproduced by an independent high-precision library over the approved domain, with finite-difference checks, put-call parity where applicable, monotonicity/convexity properties, boundary tests, surface arbitrage tests, and golden fixtures from an independent source.

## Forward construction

The code accepts `forwardUsdPerUnderlying`; it does not derive it. Production must specify whether forward comes from Derive instruments, spot/carry, futures/perpetual basis, or a curve. It must document:

- exact tenor interpolation/extrapolation;
- timestamp alignment with spot and IV;
- funding/carry and settlement currency;
- source priority and disagreement thresholds;
- treatment during venue outage or dislocation;
- confidence and conservative side selection.

Using a Hyperliquid perpetual mark as the option forward without tenor/basis treatment is not approved.

## Volatility surface

A production surface requires, at minimum:

- canonical expiry/strike coordinates and synchronized observations;
- quote quality, crossed/stale/outlier filtering, and liquidity weights;
- forward-consistent delta/moneyness convention;
- interpolation with calendar and butterfly arbitrage controls;
- bounded extrapolation and explicit low-confidence regions;
- versioned calibration parameters and reproducible snapshots;
- comparison with executable option quotes and independent sources;
- stress surfaces for level, skew, twist, and jump regimes.

The current `conservativeVolatilityHaircutDecimal` is a fixed downward IV shock for long-option valuation. A separate `reservationStress` grid shocks IV both down and up with synchronized spot/forward/hedge-price moves and reserves the largest Greek/notional measures. Neither is a confidence interval or a replacement for surface uncertainty, jump/tail stress, or an adverse-selection charge.

## Fees and account data

`protocolAndOiFeesUsd` must represent the exact conservative total cost attributable to this candidate and maker subaccount. Production must derive it from current protocol rules/state immediately before signing and reserve cash for:

```text
quoted premium
+ maximum signed Derive fee
+ open-interest/protocol fees not already inside that maximum
+ conservative settlement/exercise cash obligations
```

The current `protocolCashOutflowUsd` field reserves quoted premium plus the caller-supplied protocol/OI fee total. The live exact-intent layer must prove that total also covers the maximum signed fee and any additional lifecycle cash obligations; otherwise it remains insufficient.

Hyperliquid fee tier, account equity, margin used, positions, and open orders must come from the exact bound account that the signer will use. Quote admission validates portfolio exposure/P&L/reservation values, ledger version, hedge-operational revision/count/residual/freshness, and hedge account scalars before aggregation. TypeScript still provides no transport/runtime decoding by itself, the standalone planner does not exhaustively validate every account scalar, and there is no durable proof linking the supplied operational revision to venue state. Production adapters/coordinator/signers must fail closed independently.

## Data retention and model governance

Retain the exact decision-time inputs and later outcomes needed to measure:

- quote, win, acceptance, and fill rates by context;
- decision-to-send and fill-to-hedge latency;
- theoretical versus executable hedge cost;
- counterfactual option value and surface movement after RFQ receipt/quote/fill;
- realized hedge turnover, funding, basis, and P&L attribution;
- decline reason distribution and false-positive/false-negative review;
- model drift and source disagreement.

Model changes require a new `modelVersion`, offline backtest/replay, shadow comparison against the incumbent, risk review, and a rollback plan. Training or calibration data must not include future information relative to the decision timestamp.
