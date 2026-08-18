# Operations and rollout

Last reviewed: 2026-08-14. Current operational mode is `SHADOW` only. No live threshold, limit, SLO, or rollout date is approved here.

## Current local operation

The package has no daemon or external dependency. The local fixture can be built and run with:

```bash
pnpm --filter @hedge/rfq-market-maker typecheck
pnpm --filter @hedge/rfq-market-maker test
pnpm --filter @hedge/rfq-market-maker dev
```

`shadow-demo.ts` uses a fixed future timestamp and local objects, writes JSON to stdout, and sets `sideEffectsPossible: false`. Its placeholder address, balance, book, fee, rate, and risk values are not suitable for a live environment.

## Proposed operating states

These states require durable implementation:

| State | New quotes | Reconciliation | Hedge action |
| --- | --- | --- | --- |
| `STARTING_RECONCILIATION` | No | Required | No new action until unknown orders/fills classified; operator escalation for dangerous delta |
| `SHADOW` | Calculate only | Read-only | Plan only |
| `ACTIVE` | Within approved mandate | Continuous | Bounded automatic IOC plans |
| `QUOTE_HALTED` | No | Continuous | Continue bounded reduction of confirmed risk under separate hedge policy |
| `HEDGE_BLOCKED` | No | Continuous | No ordinary submit; page immediately and follow emergency runbook |
| `MANUAL_RISK_REDUCTION` | No | Continuous | Named authorized operators use separately controlled procedure |
| `FULL_STOP` | No | Read-only if safe | No automated writes after credential/security or state-integrity incident |

Quote halt and hedge permission are deliberately separate. A market-data issue that makes quoting unsafe may still leave confirmed delta requiring controlled reduction. Conversely, a signer compromise requires full stop even if delta remains; operators then use uncompromised emergency controls.

## Observability

### Decision and market data

- RFQs seen, normalized, declined, quoted, reserved, and CAS-conflicted.
- Gate and decline-code counts by policy/model/source/product bucket.
- Decision latency and remaining auction/acceptance headroom.
- Observed/received ages, clock skew, confidence, health, and source gaps.
- Option forward/spot/IV and Hyperliquid oracle/mark deviations.
- Required hedge size, in-cap depth, simulated VWAP/slippage, and data-to-plan latency.

### Risk and capital

- Confirmed and reserved delta, gamma, vega by expiry, notional, cash, hedge notional, and stressed margin.
- Every hard-limit utilization plus distance to limit.
- Hyperliquid equity, margin used, withdrawable capacity, liquidation distance, and venue/account reconciliation age.
- Live/expired/unknown reservation counts and oldest age.
- Daily and cumulative P&L with option, premium, fee, hedge, slippage, funding, basis, settlement, and manual-adjustment attribution.
- Stress losses, including all live reservations filling and option delta migrating toward stress values.

### Lifecycle and execution

- Quote intent/ack/unknown/live/cancel/expiry/fill transitions.
- Time from authoritative option fill to hedge intent, submission, first fill, and within-band state.
- Hedge client IDs, acknowledgements, partial/unfilled quantities, retries, and unknown outcomes.
- Internal versus Derive position/quote/fill mismatches.
- Internal versus Hyperliquid position/open-order/fill/funding/margin mismatches.
- Leadership, database, outbox, nonce, reconnect, backfill, and finality status.

Metrics must not create uncontrolled cardinality from raw RFQ/quote/order IDs; those identities belong in trace/audit records.

## Alerts

Page-worthy conditions include:

- confirmed portfolio delta outside emergency tolerance;
- fill-to-hedge deadline exceeded;
- ambiguous or duplicate Derive fill attribution;
- pending/unknown Hyperliquid order beyond reconciliation deadline;
- any venue/internal position, cash, open-order, or nonce mismatch;
- collateral/liquidation buffer breach or missing account data;
- stale/unhealthy/gapped data while exposure exists;
- durable database/outbox/leadership failure;
- daily-loss, stress-loss, hard-limit, or policy-integrity breach;
- unauthorized signing request, credential anomaly, or audit-chain failure.

Ticket-level conditions may include elevated declines, model/source drift, lower fill rate, and cost-estimate error while every hard control remains safe. Numeric severities require approved runbooks; they are not defined by the shadow defaults.

## Runbook principles

### Stale or divergent data

Halt new quoting, preserve reservations, verify feed continuity/clock/source metadata, and reconcile venue state. Never lower confidence or widen freshness limits to clear the alert. Resume only after fresh snapshots and explicit criteria.

### Confirmed fill not hedged

Halt quoting, prove fill attribution and current option delta, reconcile all Hyperliquid pending orders/fills/position, refresh L2/account state, and execute only an approved bounded residual plan. If depth/collateral remains insufficient, escalate to the named risk owner; do not remove the slippage or margin cap automatically.

### Unknown Hyperliquid submission

Keep pending quantity as reconciliation state—it is **not a fill**. Query by original client order ID plus order status, open orders, user fills, and clearinghouse position. Deduplicate confirmed fills, recompute target, then decide whether a new residual intent is needed.

### Position or cash mismatch

Halt quoting, snapshot both venues and durable state, backfill events over an overlap window, and produce an instrument-by-instrument reconciliation. Corrections are explicit audited events with dual control. Logs alone do not authorize a correction.

### Credential compromise

Full stop, revoke/rotate affected credentials, inspect all signed actions and balances, preserve evidence, notify security/risk owners, and use separately protected emergency controls. Resume requires fresh keys, reconciliation, root-cause remediation, and approval.

### Database/state integrity failure

Halt; do not fall back to in-memory reservations. Restore from tested backup/PITR, replay and reconcile external events without side effects, prove invariants, and approve resume.

## Rollout stages

Each stage has written entry evidence, an observation window, exit criteria, rollback triggers, and named model/risk/security/operations owners.

### Stage 0: deterministic kernel

- Unit/property/golden tests for pricing, Greeks, book walking, decision gates, risk aggregation, reservation CAS, and hedge plans.
- Independent high-precision reference comparison and adversarial numeric tests.
- No network or secret dependencies.

### Stage 1: historical replay

- Reconstruct decisions without future leakage from stored RFQs and timestamp-aligned market/account data.
- Treat all live reservations as fillable.
- Attribute counterfactual option value, hedge cost, funding, basis, and risk.
- Review declined trades as well as apparent winners.

### Stage 2: live read-only shadow

- Authenticated read adapters with no write/sign permission.
- Durable inputs, decisions, reservations-as-simulation, and complete reconciliation telemetry.
- Compare canonical identities, fee/OI calculation, surface, L2 execution, account/margin, and current venue metadata.
- Inject disconnections, stale/future data, gaps, duplicates, reorderings, and process restarts.

### Stage 3: testnet end to end

- Isolated Derive and Hyperliquid signers with testnet-only allowlists.
- Durable intent-before-action, exact arithmetic, nonces, idempotency, expiry, partial/unknown response, and restart recovery.
- Verify deployed contract events, quote/fill attribution, and client-order reconciliation.
- Exercise kill switches and disaster recovery.

### Stage 4: mainnet shadow with funded account reads

- Read-only production endpoints/metadata/account state; no signing capability in the shadow process.
- Sustained parallel comparison and operational on-call drills.
- Risk committee reviews calibrated limits/costs/stresses and independent collateral plan.

### Stage 5: economically live canary

This stage is prohibited until every hard gate below is signed off. Use separately approved minimal product, size, aggregate risk, loss, duration, account, and operator limits. Any signed Derive quote is an economically live action even before it fills, so reservation, fill reconciliation, and hedge capability must already be production-grade.

### Stage 6: controlled expansion

Increase one dimension at a time—size, expiries, takers, hours, or concurrency—after observed cost/P&L/risk evidence and four-eyes approval. Do not add puts, maker-short direction, or multi-leg RFQs as a configuration-only change; each changes the economic and lifecycle model.

## Hard live gates

All must pass. “Planned,” “typed,” or “works in the demo” does not pass a gate.

### Product, data, and model

- Deployed-chain canonical registry verifies address/sub-ID/strike/expiry/kind/multiplier/underlying/settlement and normalizes full Derive direction semantics.
- Runtime binding proves Hyperliquid venue, account, environment, and coin correspond to the RFQ underlying. The shadow kernel compares all four and carries them into order intents; production adapters/signers repeat this against authoritative metadata.
- Strict runtime schema rejects `NaN`, infinities, wrong signs/ranges/units, stale portfolio/P&L/account state, and invalid ledger/portfolio revisions. Shadow quote admission validates portfolio and hedge-operational scalar invariants, but durable decoding/freshness/revision linkage and exact signer-side recomputation remain required.
- Governed forward curve and IV surface pass independent pricing/Greek, arbitrage, boundary, and stress validation.
- Fee/OI, funding, fee-tier, margin, and instrument metadata are current and independently verified.
- No silent fallback; source health/confidence/freshness/gap semantics are tested.

### Risk and capital

- Durable atomic reservation precedes every live quote, with fill/expiry/cancel race handling and all live reservations counted.
- Derive cash reservation includes premium plus maximum signed fee, OI/protocol fee, and applicable settlement/exercise obligations. Current `protocolCashOutflowUsd` includes quoted premium plus supplied protocol/OI fees, so the live intent must prove maximum-fee/lifecycle coverage.
- Hyperliquid capacity stress includes option delta migration toward stressed values (for a long call, potentially toward one). Current reservations use a bounded spot/IV scenario grid and still require approved jump/tail extension.
- Portfolio, account, P&L, limits, and revisions are finite, fresh, internally consistent, and independently recomputed.
- Hyperliquid margin comes from authoritative full-account state with conservative stress. The current planner retains reported margin, adds incremental opening margin and projected-position stress, validates account scalars, and permits a strictly position-reducing reduce-only order even when existing usage is above policy; the formula remains an unapproved venue approximation.
- Approved jump/IV/basis/funding/liquidity/outage/depeg/finality/all-reservations-fill stresses and independent cross-venue collateral buffers pass.
- Limits, alert thresholds, loss controls, and rollout ceilings have named risk approval and signer-side enforcement.

### State and execution

- Transactional durable coordinator, single-writer fencing, outbox, idempotency, immutable audit, backups, and tested restart/recovery.
- Authoritative Derive quote/cancel/expiry/fill state and exact maker/subaccount/RFQ/quote/leg/chain attribution.
- A pending IOC quantity remains pending reconciliation and never becomes confirmed position, cash, P&L, or margin truth without fill evidence.
- New-quote admission remains closed unless hedge reconciliation is fresh/healthy, pending-order count is zero, and existing residual delta is inside its limit; production must derive these facts durably rather than trust a caller object.
- Hyperliquid order status, open orders, fills, funding, position, and margin reconcile across socket snapshots and query backfill.
- Partial, rejected, delayed, duplicated, reordered, ambiguous, and price-tick-boundary cases are fault-tested.
- Exact decimal/fixed-point intent building; no JavaScript `number` reaches a signature or venue payload.

### Security and operations

- Isolated least-privilege signers, current protocol-domain allowlists, persistent venue-correct nonces, rotation/revocation, and no general arbitrary-sign interface.
- Pinned/reviewed protocol SDK/ABI/metadata, reproducible artifact, dependency/secret/security review.
- Quote halt, hedge block, full stop, manual risk reduction, credential compromise, state recovery, and venue outage runbooks are exercised by the on-call team.
- Dashboards, alerts, reconciliation reports, and P&L attribution have sustained shadow evidence.
- Independent review signs off model, risk, security, protocol integration, and operations; no critical findings remain.

## Post-trade review

Every live fill should be reconstructible from RFQ receipt through settlement. Review expected versus actual:

- model/conservative fair value and bid;
- every cost component;
- quote/win/accept timing and market movement;
- confirmed option position and Greeks;
- initial/residual hedge fills, slippage, fees, funding, and latency;
- inventory risk and stress utilization;
- realized and marked P&L.

Large residuals or systematic bias trigger recalibration or halt, not an undocumented manual adjustment.
