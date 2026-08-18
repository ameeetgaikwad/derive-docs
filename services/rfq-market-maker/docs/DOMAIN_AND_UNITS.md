# Domain, signs, and units

Last reviewed: 2026-08-14.

The current kernel uses descriptive suffixes because JavaScript does not encode physical units. This document is normative for analytics. A value without a documented unit must be rejected at an adapter boundary.

## Direction and sign conventions

| Concept | Positive means | Negative means |
| --- | --- | --- |
| `makerOptionQuantityUnderlying` | Maker is long the normalized option quantity | Not represented in v0 candidate inputs |
| `netOptionDeltaUnderlying` | Option portfolio gains underlying-equivalent exposure when the hedge reference rises | Option portfolio is short underlying-equivalent exposure |
| `currentPerpPositionUnderlying` | Long Hyperliquid perpetual | Short Hyperliquid perpetual |
| `pendingSignedPerpQuantityUnderlying` | Pending buy quantity | Pending sell quantity |
| `signedOrderQuantityUnderlying` | Planned buy | Planned sell |
| `protocolCashOutflowUsd` | Quoted premium plus caller-supplied protocol/open-interest fees reserved on Derive | Future directions/lifecycle obligations require a richer signed cash-flow model |
| `realizedPnlTodayUsd` | Profit | Loss |

The hedge invariant is:

```text
targetPerpPositionUnderlying = -confirmedOptionDeltaUnderlying
effectivePerpPositionUnderlying = currentPerpPositionUnderlying + pendingSignedPerpQuantityUnderlying
residualToTargetUnderlying = target - effective
```

Despite the current planner field name `confirmedOptionDeltaUnderlying`, the caller must supply aggregate **cross-venue hedge-equivalent underlying delta** after applying the forward/reference conversion and approved beta. Supplying raw Black-76 forward delta would mix units and produce the wrong target. A production schema should rename the field to make this impossible to miss.

The decision engine's `hedgeDeltaUnderlying` is the candidate option's positive or negative underlying-equivalent delta, despite the name. For a normal long call it is positive. The initial hedge preview therefore walks Hyperliquid bids for a `SELL`.

`TAKER_SELLS_OPTION` is a normalized local fact: the maker acquires the option. It must be derived from the complete signed Derive leg/direction semantics. A wire-level string called `buy`, `sell`, or a signed amount is not sufficient by itself.

## Unit catalog

| Suffix or field | Unit and interpretation |
| --- | --- |
| `*Ms` | Unix epoch milliseconds for timestamps; duration milliseconds for intervals |
| `*Years` | 365-day years in the current model |
| `*UsdPerUnderlying` | USD per one unit of the underlying, e.g. USD/BTC |
| `quantityContracts` | Instrument contracts before multiplier normalization |
| `contractMultiplierUnderlying` | Underlying units per contract |
| `*QuantityUnderlying`, `*DeltaUnderlying` | Underlying units, e.g. BTC |
| `*Usd` | Total USD value for the candidate or portfolio slice |
| `*Decimal` | Decimal fraction: `0.60` is 60%; `0.00045` is 4.5 bps |
| `*Bps` | Basis points; 10,000 bps is 100% |
| `premiumUsdPerUnderlying` | Option premium in USD per underlying unit |
| `forwardGammaPerUsd` | Change in forward delta for a one-USD move in forward |
| `gammaUsdForOnePercentSquared` | Approximate convexity P&L term for a 1% spot move: `0.5 * gamma * (1% spot)^2 * quantity` |
| `vegaUsdPerVolPoint` | USD premium change for one absolute volatility point, i.e. IV moves by `0.01` |
| `thetaUsdPerDay` | USD premium change when one calendar day passes, holding forward and IV fixed |
| `fundingRateHourlyDecimal` | Decimal funding rate for one hour; venue sign convention is normalized by the input adapter |
| `initialMarginFraction` | Analytics assumption for initial margin/notional, not a venue-reported rule |

## Identity

`InstrumentIdentity` is complete only when all of the following come from or are verified against a trusted local registry:

- option asset address and chain/network;
- sub-ID and its canonical decoding;
- underlying and settlement currency;
- call/put kind;
- strike and expiry;
- contract multiplier and amount precision;
- enabled/disabled lifecycle state.

`instrumentId` is a display/correlation label, not proof. String equality on a symbol is not authorization. Asset addresses are compared case-insensitively by the current quote gate, while the sub-ID is carried but not independently decoded by this package. The caller is solely responsible for setting `identityVerified`; production must replace that boolean trust assertion with a registry result that is itself auditable.

## Time semantics

- `nowMs` is caller supplied so decisions can be replayed.
- `observedAtMs` is when the source says the market state was observed.
- `receivedAtMs` is when the local adapter received/assembled it.
- Both ages must be within freshness bounds and neither may be too far in the future.
- `auctionEndsAtMs` and `takerAcceptanceEndsAtMs` are bounded by local policy; a venue/server TTL never extends the local maximum.
- `RfqCandidate.receivedAtMs` is required to be finite and not beyond permitted future skew. The current engine does not impose a maximum RFQ age independent of auction headroom; production must validate source creation/update/receive times, reject replayed/over-age RFQs, and bind those values into the audit hash.
- A reservation's `expiresAtMs` is acceptance end plus a finality buffer, but time alone never releases it. The current snapshot returns it until an explicit CAS release; production may release only after authoritative terminal-state reconciliation.
- Production must use a disciplined wall clock, a monotonic duration source where appropriate, clock-skew alerts, and persisted venue timestamps.

## Numeric rules

Current calculations use IEEE-754 binary floating point. That is acceptable only for research analytics and makes small tolerance terms such as `1e-9` or `1e-12` implementation details, not financial precision guarantees.

At a production boundary:

1. Preserve external prices, sizes, fees, and rates as canonical decimal strings.
2. Convert with instrument-specific decimal scales into checked `bigint`/fixed-point values.
3. Apply an explicit rounding direction: bids down, paid fees/margin requirements up, buy IOC prices up, sell IOC prices down, subject to the risk cap.
4. Reject overflow, underflow, exponent notation where prohibited, excessive precision, negative zero, `NaN`, and infinity.
5. Reconstruct signed values from the exact integer representation; never sign a prior floating-point serialization.
6. Store both raw external values and normalized exact values for audit.

The analytical engine may continue to use `number` internally if independently tested against a high-precision reference, but the live coordinator must re-check every economic and risk bound using conservative exact rounding before signing.

## Currency and collateral separation

All current costs are normalized to USD for comparison. `USDT` is the example permitted settlement label; USD and USDT are not assumed risk-free or perfectly interchangeable. Production must model conversion, depeg, withdrawal, bridge, venue, and settlement risks explicitly.

Derive option assets, unsettled option gains, and premium receivables are not Hyperliquid account equity. The `accountEquityUsd` input is Hyperliquid-visible equity only. Cross-venue transfers are slow operational actions, never an instantaneous margin response.
