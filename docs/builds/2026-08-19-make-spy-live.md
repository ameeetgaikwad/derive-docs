# Make SPY Live Buildout

Created: 2026-08-19
Agent: Codex
Status: LOCKED
Approved: Yes
Rounds: 0
Worktree: No
Type: Build

## Summary

**Goal:** Make SPY options safely quoteable on the isolated BNB chain-56 mainnet-staging stack, while keeping canonical production disabled and executing no trade.

**Oracle:** For expiry `1787342400`, strike `775`, amount `0.01`, and encoded option subId `39614081589992134238559317568`, a live staging RFQ receives a maker quote whose trade uses the SPY OptionAsset and matches that subId and amount, then expires unaccepted with `execution=null`.

**Misfire:** SPY could be deployed or shown as enabled while stale feeds, missing durable state, an incomplete service rollout, or an accidental production edit leaves it unsafe or unquoteable; the criteria below require on-chain bindings, repeated freshness, singleton restart durability, a real quote, and an unchanged production manifest.

**Constraints:** A successful quote-only NVDA smoke RFQ is a hard gate before any SPY broadcast. Keep canonical production disabled, preserve the SPY `0.10` per-RFQ cap and `0.50` on-chain displayed-balance cap, keep borrowing disabled, never weaken heartbeat or stale-data checks, never overlap chain-56 oracle writers, use immutable service images built from an isolated intended source tree, do not execute an RFQ accept/fill, and do not stage, commit, branch, or push Git state.

**Assumed:** “Live” means the existing explicitly pre-production mainnet-staging environment. The proof stops after receiving a tiny maker quote because accepting it would move funds on-chain.

## Acceptance Criteria

- [ ] Criterion 1 (oracle): Live staging `POST /rfq` for expiry `1787342400`, strike `775`, amount `0.01`, and encoded subId `39614081589992134238559317568` returns `201`; after auction close it has `status=closed`, `quoteCount>=1`, and one `bestQuote` trade whose asset equals `protocol/deployments/staging/56-SPY.json.optionAsset` and whose subId and amount equal `39614081589992134238559317568` and `10000000000000000`. After the accept window, the persisted terminal RFQ and maker log say expired unaccepted with `execution=null`; the saved operator command ledger contains no `/accept`, and a chain event/transaction query contains no fill for its order hash.
- [ ] Criterion 2: Three saved live `/markets` responses at least 120 seconds apart each report SPY `enabled=true`, `status=open`, and `disableReason=null`.
- [ ] Criterion 3: Beside every Criterion 2 sample, saved direct calls to SPY scaled spot, signed spot, forward, vol, rate, and stable/settlement feeds all succeed, and the corresponding latest update-event age is no greater than the exact heartbeat read from each deployed feed.
- [ ] Criterion 4: The generated SPY sidecar, staging manifest, deployment report, and direct chain reads agree on market ID `4`, every manager/asset/feed address, signer authorization, and fees; StandardManager borrowing remains disabled; SPYB and the multiplier registry both return `1000000000000000000` at the deployment checkpoint; the on-chain displayed-balance cap converts to exactly `0.50` SPYB. A live `0.11` SPY RFQ is rejected before auction creation while `0.01` is admitted under the `0.10` per-RFQ cap.
- [ ] Criterion 5: Before restart, distinct checkpoints exist at `/var/lib/hedge/active-expiries.json`, `/var/lib/hedge/active-expiries.XAU.json`, `/var/lib/hedge/active-expiries.NVDA.json`, `/var/lib/hedge/active-expiries.SPY.json`, `/var/lib/hedge/settlement-twap.json`, `/var/lib/hedge/settlement-twap.XAU.json`, `/var/lib/hedge/settlement-twap.NVDA.json`, and `/var/lib/hedge/settlement-twap.SPY.json`; controlled-restart logs show all eight loaded and each scan resuming no more than one configured discovery chunk behind its saved cursor.
- [ ] Criterion 6: The ECS event timeline shows the old oracle task `STOPPED` before its replacement becomes `RUNNING`; 10-second task polls never observe more than one chain-56 oracle task; the local process inventory has no chain-56 writer; and for five continuous minutes the replacement logs successful SPY publishes with zero oracle errors.
- [ ] Criterion 7: A saved build manifest records the isolated source-tree digest, immutable tag, and ECR SHA-256 digest for the SPY-aware oracle, RFQ, and maker images; running ECS tasks report those exact digests. The reviewed saved Terraform plan contains only intended `infra/mainnet-staging` task-definition/service changes, and all three services remain desired/running `1` and healthy for five minutes before the quote proof.
- [ ] Criterion 8: The SHA-256 hash of `protocol/deployments/markets/56.json` remains `e9101055164b3f66b7e95ba488942f3baa5cb44ddda803ddf17fcc54d15fad91`, its SPY entry remains disabled with `contracts:null`, the applied Terraform state/backend is the dedicated `infra/mainnet-staging` backend, and the saved command/resource ledger contains no production service or resource mutation.

## Out of Scope

- Canonical production activation, RFQ acceptance, taker signature generation, on-chain trade execution, and unrelated withdrawal work already present in the worktree.

## Progress Tracking

- [x] Task 0: Prove NVDA's quote-only launch gate without acceptance or fill.
- [x] Task 1: Deploy and verify the disabled SPY market on chain 56.
- [x] Task 2: Enable staging SPY and extend durable oracle configuration, tests, and operating documentation.
- [ ] Task 3: Build immutable service images and perform a reviewed staging-only rollout.
- [ ] Task 4: Prove sustained SPY readiness, caps, restart durability, and the quote-only oracle flow.

## Implementation Tasks

### Task 0: Prove NVDA's quote-only launch gate without acceptance or fill

**Objective:** Before any SPY transaction or broadcast, record a successful tiny NVDA quote-only RFQ on the current isolated staging endpoint, let it expire with no accept/fill, and verify direct chain-56 reads still show `StandardManager.lastMarketId == 3` and borrowing disabled.

### Task 1: Deploy and verify the disabled SPY market on chain 56

**Objective:** Only after Task 0 passes, use the guarded SPY operator to deploy the staging-only contracts while disabled, produce the sidecar, and verify addresses, ownership, feeds, caps, sequence, token metadata, and borrowing controls directly on chain.

### Task 2: Enable staging SPY and extend durable oracle configuration, tests, and operating documentation

**Objective:** Activate only the staging manifest, add the exact SPY OptionAsset discovery block and two per-market EFS state paths to the oracle task, and update focused tests and docs without changing canonical production.

### Task 3: Build immutable service images and perform a reviewed staging-only rollout

**Objective:** Build from a clean isolated source tree containing only the intended SPY and durable-oracle changes, publish auditable immutable oracle, RFQ, and maker images, build the staging web artifact if its deployment path is present and authorized, review a saved staging-only Terraform plan, then roll oracle, RFQ, maker, and web in the documented order without writer overlap or canonical-production changes.

### Task 4: Prove sustained SPY readiness, caps, restart durability, and the quote-only oracle flow

**Objective:** Record repeated feed/readiness evidence, perform one controlled singleton restart, prove the size cap, obtain the exact maker quote, and let the RFQ expire without acceptance.

## Round Log

Pre-loop discovery found an existing guarded SPY deployment/activation path, a valid exact `SPY / USD` Chainlink source, sufficient deployer and feed-signer balances, existing web/maker support, and a staging manifest placeholder. The dry-run preflight passed without transactions or file changes. Pre-loop review made the NVDA smoke test a hard gate, bound the oracle to an exact encoded subId and evidence sources, separated readiness from feed evidence, named all eight durable paths, made singleton/image evidence decidable, and strengthened production isolation.

Task 0 passed before lock: NVDA RFQ `3819027b-18ac-4d30-bbe1-b1faa42a8d4d` returned one quote for the exact NVDA OptionAsset/subId/amount, then persisted as `status=expired`, `execution=null`; maker logs say `expired unaccepted`. Direct chain reads remained `lastMarketId=3` and `borrowingEnabled=false`. The misleading `BTC` maker log label is a display-only default in `instrumentNameFromSubId`; the signed trade and API payload use the correct NVDA asset and encoding.

Task 1 completed: an isolated fork simulation passed all 43 transactions with estimated cost `0.0009326836 BNB`. The guarded broadcast consumed deployer nonces `168` through `210`; all 43 receipts succeeded across blocks `116826371`–`116826549`. SPY is market ID `4`; its OptionAsset `0x393e13a7104A6F3FF79BD9B83180C9Df6dB8950D` was deployed at block `116826473`. The post-broadcast operator verified the complete sidecar and left SPY disabled. Actual deployer cost was approximately `0.00070972115 BNB`.

Task 2 completed: bootstrap and activation readiness passed against exact `SPY / USD`; only the local staging manifest was enabled. Terraform now supplies `ORACLE_DISCOVERY_FROM_BLOCK_SPY=116826473`, and the documented/tested EFS layout has eight unique per-market files. Focused shared, web, oracle, E2E, and Forge tests pass; Terraform format-check and validation pass.

Task 3 in progress: isolated source commit `126ae538ce9a` plus overlay digest `ba2388268f849ae632b67a49261505376cb3f2e140331842da5e9a37e77c9410` built and pushed immutable oracle, RFQ, and maker images. The tag/digests are recorded in `2026-08-19-spy-image-manifest.json`, and each local image contains enabled SPY market ID `4` with the exact OptionAsset and `0.1` cap. AWS control-plane credentials expired before the saved Terraform plan, so no ECS rollout has started yet.

## Changed Files

- docs/builds/2026-08-19-make-spy-live.md
- docs/builds/2026-08-19-spy-image-manifest.json
- protocol/deployments/staging/56-SPY.json
- protocol/deployments/staging/56-rwa-report.json
- protocol/deployments/staging/markets/56.json
- infra/mainnet-staging/README.md
- infra/mainnet-staging/ecs.tf
- infra/mainnet-staging/mainnet-staging.tfvars.example
- infra/mainnet-staging/variables.tf
- services/oracle-feeds/test/activeExpiryIndex.test.ts
- services/e2e/src/rwa-testnet.test.ts
- services/shared/test/markets.test.ts
- apps/web/src/lib/protocol/markets.test.ts
- apps/web/src/lib/protocol/withdrawal-assets.test.ts
