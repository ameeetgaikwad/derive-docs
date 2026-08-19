# Make NVDA Trade Ready Buildout

Created: 2026-08-19
Agent: Codex
Status: PENDING
Approved: Yes
Rounds: 0
Worktree: No
Type: Build

## Summary

**Goal:** Make NVIDIA options safely quoteable on the isolated BNB chain-56 mainnet-staging stack with one durable oracle writer, without enabling canonical production or executing a trade.

**Oracle:** A capped, quote-only NVDA RFQ opened against the live staging endpoint receives a valid maker quote after the on-chain readiness gate passes, and no accept or fill call is made.

**Misfire:** The run could make `/markets` look open while freshness is bypassed or two writers overlap; Criteria 2–4 catch this with repeated readiness, per-feed event ages, and an ordered ECS replacement timeline.

**Constraints:** Keep canonical production disabled, preserve the NVDA `0.25` per-RFQ cap and existing maker risk limits, never weaken heartbeats or readiness checks, never run a local chain-56 writer, and do not stage, commit, branch, push Git state, or execute an RFQ fill.

**Assumed:** “Trade ready” means the existing explicitly pre-production mainnet-staging deployment; the live proof stops after receiving a tiny maker quote because accepting it would move funds on-chain.

## Acceptance Criteria

- [ ] Criterion 1 (oracle): Immediately after readiness passes for NVDA expiry `1787342400`, strike `225`, subId `39614081353768932958559317568`, and amount `0.01`, live staging `POST /rfq` returns `201`, the closing response has `status=closed`, `quoteCount>=1`, and a `bestQuote` trade matching that subId and amount, then the RFQ expires with `execution=null` and no accept call is sent.
- [ ] Criterion 2: Three recorded live `/markets` samples at least 120 seconds apart each report NVDA `enabled=true`, `status=open`, and `disableReason=null`.
- [ ] Criterion 3: At each Criterion 2 sample, direct spot, forward, vol, and rate calls for subId `39614081353768932958559317568` succeed and the latest update-event age recorded beside each call is within that feed's on-chain heartbeat.
- [ ] Criterion 4: ECS task and service-event timestamps show the old staging-oracle task reached `STOPPED` before its replacement reached `RUNNING`, no poll observed more than one running chain-56 oracle task, no local chain-56 writer exists, and the replacement stays running with successful publish logs and no oracle error for five minutes.
- [ ] Criterion 5: A controlled restart reloads equivalent BTC, XAU, and NVDA active-expiry and settlement-TWAP checkpoints from six distinct EFS-backed per-market files and resumes each active-expiry scan from its saved cursor near the finalized head.
- [ ] Criterion 6: Automated fault-injection tests show a transient `eth_getLogs` failure retries from the same cursor, and captured startup output shows XAU and NVDA begin first discovery at option-asset blocks `115693756` and `116583626` rather than the BTC block.
- [ ] Criterion 7: The SHA-256 hash of `protocol/deployments/markets/56.json` remains `e9101055164b3f66b7e95ba488942f3baa5cb44ddda803ddf17fcc54d15fad91`, and its NVDA entry remains disabled with `contracts:null`.
- [ ] Criterion 8: Staging loads `protocol/deployments/staging/markets/56.json` with NVDA `maxSize="0.25"`, and a live `0.26` NVDA RFQ is rejected before auction creation while the `0.01` oracle RFQ is admitted.
- [ ] Criterion 9: Pre/post configuration snapshots show identical feed heartbeats, stale-data checks, atomic batching, borrowing controls, and maker risk caps.

## Out of Scope

- Canonical production activation, SPY deployment, taker signature generation, RFQ acceptance, and on-chain trade execution.

## Progress Tracking

- [x] Task 1: Make RWA oracle discovery durable, bounded, and retryable.
- [x] Task 2: Harden the staging singleton rollout and document its state layout.
- [ ] Task 3: Build and roll the corrected oracle image into mainnet-staging.
- [ ] Task 4: Prove sustained NVDA readiness and obtain a quote without a fill.

## Implementation Tasks

### Task 1: Make RWA oracle discovery durable, bounded, and retryable

**Objective:** Give each enabled market its own EFS-backed active-expiry and settlement-TWAP state, start RWA replay at that market's validated option-asset deployment block, serialize discovery load, and retry transient RPC log failures without losing checkpoint progress.

### Task 2: Harden the staging singleton rollout and document its state layout

**Objective:** Configure the staging oracle service to stop the old task before starting the new one, provide the validated XAU/NVDA discovery blocks, and document the durable per-market files and safe rollout invariant.

### Task 3: Build and roll the corrected oracle image into mainnet-staging

**Objective:** Run the relevant and full service checks, publish an auditable oracle image, stop the crash-looping writer, and deploy exactly one corrected staging task without touching canonical production.

### Task 4: Prove sustained NVDA readiness and obtain a quote without a fill

**Objective:** Observe multiple signed-feed intervals and a controlled restart, verify direct feed reads and runtime logs, prove an above-cap NVDA RFQ is rejected, then open the exact capped quote-only series and let it expire without acceptance.

## Round Log

Pre-loop review tightened the contract to bind the RFQ to one exact series, require event-age evidence for every feed, prove ordered singleton replacement, split durable-state and retry evidence, and name authoritative staging/production manifests and cap behavior.

Task 1 completed: RED tests failed on missing per-market paths and timeout recovery; GREEN now passes 45 oracle tests plus TypeScript build with serialized RWA scans, EFS-derived state paths, market-specific discovery starts, retry/backoff, and checkpoint load logging.

Task 2 completed (configuration/docs test exemption): Terraform formatting and validation pass with XAU/NVDA deployment blocks, 5,000-block discovery chunks (the staging RPC's verified maximum), six retries, and stop-before-start `0/100` oracle deployment percentages; the rollout guide now names all six EFS files and restart checks.

## Changed Files

- docs/builds/2026-08-19-make-nvda-trade-ready.md
- services/oracle-feeds/src/activeExpiryIndex.ts
- services/oracle-feeds/src/cli.ts
- services/oracle-feeds/src/settlementTwap.ts
- services/oracle-feeds/test/activeExpiryIndex.test.ts
- services/oracle-feeds/test/settlementTwap.test.ts
- infra/mainnet-staging/README.md
- infra/mainnet-staging/ecs.tf
- infra/mainnet-staging/mainnet-staging.tfvars.example
- infra/mainnet-staging/variables.tf
