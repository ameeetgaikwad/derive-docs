# Configuration

Last reviewed: 2026-08-14.

> **Every value below is an illustrative shadow fixture. It is not approved for testnet with economic value, mainnet quoting, live hedging, treasury sizing, or operational alerting.** Production values require named owners, calibration evidence, stress results, and versioned approval.

The current policy is compiled into `DEFAULT_SHADOW_POLICY`; `config/shadow.example.json` is a review artifact and is not loaded. There is no environment/file/remote configuration loader. `mode` only accepts `SHADOW`.

## Identity and versions

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `mode` | `SHADOW` | Structural prohibition on live mode |
| `policyVersion` | `shadow-policy-v0.1.0` | Economic/risk configuration identity |
| `modelVersion` | `black76-v0.1.0` | Model/calibration identity |

Production audit must also record registry, adapter, build/commit artifact, protocol ABI, SDK, and database schema versions.

## Product policy

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `allowedUnderlying` | `BTC` | Only normalized underlying |
| `allowedSettlementCurrencies` | `USDT` | Permitted settlement label |
| `allowedOptionKinds` | `CALL` | Long-call-only mandate |
| `allowedOptionAssetAddresses` | `0x000...001` | Deliberate demo placeholder; must never be promoted |
| `minimumQuantityUnderlying` | `0.01` | Minimum normalized size |
| `maximumQuantityUnderlying` | `1` | Maximum normalized size |
| `minimumMoneynessStrikeOverForward` | `0.5` | Lower `strike / forward` bound |
| `maximumMoneynessStrikeOverForward` | `1.5` | Upper `strike / forward` bound |
| `minimumTimeToExpiryMs` | `86,400,000` | One-day minimum |
| `maximumTimeToExpiryMs` | `7,776,000,000` | Ninety-day maximum |

An address alone is insufficient. Live approval is keyed by environment/chain, contract, sub-ID decoding, exact instrument properties, lifecycle, and registry version.

`allowedOptionKinds` currently documents `CALL`, while the quote engine itself hard-codes the v0 `CALL` gate rather than consulting the array. Changing that array does not expand the product and must not be treated as doing so.

## Timing policy

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `minimumQuoteHeadroomMs` | `500` | Minimum remaining time before auction end |
| `maximumAuctionWindowMs` | `120,000` | Local upper bound from evaluation time |
| `maximumAcceptanceWindowMs` | `600,000` | Local upper bound to taker acceptance end |
| `reservationFinalityBufferMs` | `120,000` | Additional reservation duration after acceptance end |
| `maximumClockSkewMs` | `1,000` | Allowed future timestamp skew |

Production must distinguish decision, signature, venue, chain, and monotonic timing and validate end-to-end latency budgets.

## Market-data policy

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `maximumOptionSnapshotAgeMs` | `2,000` | Max of observed/received option age |
| `maximumHedgeSnapshotAgeMs` | `1,000` | Max of observed/received hedge age |
| `minimumConfidence` | `0.99` | Normalized adapter confidence floor |
| `minimumVolatilityDecimal` | `0.05` | 5% annual IV model floor |
| `maximumVolatilityDecimal` | `2.5` | 250% annual IV model ceiling |
| `minimumAnnualRateDecimal` | `-0.2` | -20% annual rate model floor |
| `maximumAnnualRateDecimal` | `1` | 100% annual rate model ceiling |
| `maximumForwardSpotDeviationBps` | `2,000` | Option forward/spot tenor bound |
| `maximumOptionSpotHedgeOracleDeviationBps` | `100` | Option spot/Hyperliquid oracle basis bound |
| `maximumMarkOracleDeviationBps` | `30` | Hyperliquid mark/oracle deviation cap |
| `maximumHedgeBookSpreadBps` | `30` | Hyperliquid top-of-book spread cap for quote admission |

Confidence semantics must be source-specific, governed, and stored with reasons. The kernel enforces these scalar/basis/book bounds over the supplied snapshot; source construction and calibration are not implemented.

## Hedge policy

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `network` | `TESTNET` | Bound Hyperliquid environment |
| `accountAddress` | `0x000...002` | Deliberate demo account placeholder |
| `crossVenueDeltaBeta` | `1` | Forward-to-hedge delta beta |
| `maximumAdverseSlippageBps` | `20` | Oracle-relative full-fill L2 boundary |
| `initialMarginFraction` | `0.2` | Shadow margin/notional assumption |
| `collateralStressMoveFraction` | `0.15` | Additional collateral stress fraction |
| `maximumCollateralUsageFraction` | `0.5` | Allowed fraction of Hyperliquid equity |
| `noTradeBandUnderlying` | `0.005` | Residual delta no-action band |
| `maximumResidualDeltaToQuoteUnderlying` | `0.01` | Existing reconciled residual allowed for new quote admission |
| `lotSizeUnderlying` | `0.001` | Shadow BTC order lot |
| `priceTickUsd` | `1` | Shadow price tick |
| `minimumOrderNotionalUsd` | `10` | Minimum outside-band planned hedge notional |
| `orderExpiryMs` | `5,000` | Local planned-order expiry |

Lot, tick, asset index, significant figures, margin, leverage, and fee tier must come from current approved venue metadata and be cross-checked against policy. Static shadow values are not authoritative.

## Cost policy

| Field | Shadow default | Application |
| --- | ---: | --- |
| `conservativeForwardShockBps` | `10` | Forward scenario grid |
| `conservativeVolatilityHaircutDecimal` | `0.01` | One absolute IV-point downward scenario |
| `expectedRehedgeTurnover` | `1.5` | Hedge notional turnover multiplier |
| `expectedRehedgeSlippageBps` | `5` | Slippage in rehedge-cost estimate |
| `expectedHoldingHours` | `24` | Funding-cost horizon |
| `fundingStressBpsPerHour` | `0.05` | Added adverse hourly funding stress |
| `basisSettlementLatencyBps` | `10` | Cross-venue/settlement/latency charge |
| `adverseSelectionBpsOfFairValue` | `50` | Toxic-flow charge |
| `modelRiskBpsOfFairValue` | `50` | Model uncertainty charge |
| `capitalChargeBpsOfMargin` | `20` | Hedge-capital charge |
| `maximumConcentrationChargeBpsOfFairValue` | `100` | Max utilization-based inventory charge |
| `requiredProfitBpsOfFairValue` | `100` | Relative required-profit reserve |
| `minimumRequiredProfitUsd` | `5` | Absolute required-profit floor |

Costs must be calibrated without double counting and compared with realized attribution. Funding credits and favorable initial execution are intentionally not credited.

## Quote policy

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `premiumTickUsdPerUnderlying` | `0.01` | Unit bid floor-rounding tick |
| `minimumTotalPremiumUsd` | `10` | Minimum total bid |
| `quoteShadeBpsFromReservationCeiling` | `10` | Deterministic shade below ceiling |

The quote shade is not a competitive optimizer. Exact Derive price/amount decimals and tick validity must be rechecked by a live intent builder.

## Reservation-stress policy

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `spotMoveFraction` | `0.15` | Symmetric 15% spot/forward/hedge-price scenario move |
| `volatilityMoveDecimal` | `0.2` | Symmetric 20 absolute volatility-point move |

The engine reserves independently worst absolute delta/gamma/vega and maximum hedge notional across the grid, then stresses margin from that notional. These magnitudes are placeholders and do not constitute an approved jump/tail framework.

## Risk policy

| Field | Shadow default | Meaning |
| --- | ---: | --- |
| `maxAbsNetOptionDeltaUnderlying` | `5` | Absolute option delta cap |
| `maxGrossGammaUsdForOnePercentSquared` | `10,000` | Gross convexity cap |
| `maxGrossVegaUsdPerVolPoint` | `5,000` | Aggregate gross vega cap |
| `maxGrossVegaUsdPerVolPointPerExpiry` | `2,000` | UTC-expiry gross vega cap |
| `maxGrossOptionNotionalUsd` | `500,000` | Gross option forward-notional cap |
| `maxProtocolCashOutflowUsd` | `100,000` | Quoted premium plus supplied protocol/OI fee cap |
| `maxHedgeNotionalUsd` | `300,000` | Aggregate candidate hedge-notional cap |
| `maxHedgeInitialMarginUsd` | `150,000` | Aggregate stressed hedge-margin cap |
| `maxLiveReservations` | `20` | Concurrent reservation cap |
| `maxDailyLossUsd` | `10,000` | Daily realized-loss halt bound |

Current reservations add quoted premium and caller-supplied protocol/OI fees and use a bounded spot/IV scenario grid for Greeks/notional/margin. Live Derive cash capacity must prove the exact signed maximum fee and any settlement/exercise obligation are also covered. Live Hyperliquid capacity must include approved tail delta migration—e.g. a long call moving toward one after a large rally—beyond the placeholder grid.

## Current validation behavior

`validatePolicy` checks shadow mode, non-empty versions/product labels, non-empty currency/assets, 20-byte EVM address syntax, many positive/non-negative fields, fraction ranges, ordered quantity/moneyness/expiry/IV/rate bounds, timing headroom ordering, selected bps ceilings below 100%, and a reservation spot shock below one. `evaluateQuote` invokes it before all other gates. This is not a complete runtime schema or approval system. Among the missing semantic checks are:

- canonical currency/chain meaning, casing, and alias normalization beyond the current basic uniqueness and address-syntax checks;
- integer constraints and practical upper bounds;
- remaining bps/shock combinations that could be impractical or double count risk;
- consistency among quote TTL, signature TTL, reservation finality, and data latency;
- canonical network enum/address format and venue metadata identity (decision/planner compare supplied network/account/coin to policy but policy parsing is not a strict external schema);
- current venue precision/margin/fee metadata;
- source confidence construction;
- complete signed cash obligations and tail future-delta capacity beyond the placeholder grid;
- durable freshness/transactional linkage between portfolio, hedge-operational revision, ledger, account state, and P&L (shadow admission validates their supplied scalar invariants).

`Object.freeze` currently freezes only the top-level default object; nested objects remain mutable at runtime, and TypeScript `readonly` is erased. Production configuration must be parsed from a strict schema, deep-frozen/immutable, hash-addressed, signed or access-controlled, and atomically activated.

## Production change workflow

1. Propose a complete versioned policy with rationale and owner.
2. Validate strict schema and all cross-field invariants.
3. Replay historical RFQs and stress every live reservation as filled.
4. Compare shadow decisions/P&L/risk against incumbent and independent calculations.
5. Obtain model, risk, security, and operations approvals as applicable.
6. Schedule atomic activation; never mutate a policy object in place.
7. Observe a canary within separately approved ceilings.
8. Roll back to an immutable prior version on predefined conditions.

Increases require four-eyes approval. Emergency decreases and quote halt should be fast, authenticated, durable, and fully audited.
