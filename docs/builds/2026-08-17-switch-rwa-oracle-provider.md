# Switch RWA Oracle Provider Buildout

Created: 2026-08-17
Agent: Codex
Status: VERIFIED
Approved: Yes
Rounds: 1
Worktree: No
Type: Build

## Summary

**Goal:** Allow each RWA market to select Pyth or Chainlink from its manifest, with Chainlink spot and expiry settlement requiring no Pyth API key while existing Pyth markets keep working unchanged.

**Oracle:** A provider-aware test drives a Chainlink RWA from manifest configuration through deployment/readiness and settlement selection without a Pyth price ID or API key, while the equivalent Pyth path remains green.

**Misfire:** The manifest looks switchable but a Chainlink market still reaches Hermes or a Pyth-only contract; Criterion 3 catches this with a no-Pyth Chainlink operator test.

**Constraints:** Do not enable undeployed mainnet markets, preserve scaled-collateral multiplier checkpoints, fail closed on missing or unverifiable feed addresses, and do not invent a Chainlink SPY address.

**Assumed:** “Enable” means deployment-ready and safely activatable after contracts are deployed, not marking markets enabled before their deployment addresses exist.

**Reference:** Existing RWA oracle stack — re-obtain from `protocol/src/PythSpotFeed.sol`, `protocol/src/PythBenchmarkSettlementFeed.sol`, and `protocol/src/AnchoredSettlementFeed.sol`.

## Acceptance Criteria

- [x] Criterion 1: Automated provider-aware coverage proves both Pyth and Chainlink RWA configurations flow from manifest selection to the correct spot and settlement contracts.
- [x] Criterion 2: The Chainlink spot adapter normalizes supported decimals to 18 decimals and rejects missing, non-positive, incomplete, or stale rounds in Foundry tests.
- [x] Criterion 3: Chainlink deployment and operator-readiness tests pass without a Pyth price ID or API key, and no Chainlink branch invokes Hermes or a Pyth-only binding.
- [x] Criterion 4: Existing Pyth BTC/XAU behavior and scaled-collateral checkpoint behavior remain green in targeted and full project test suites.
- [x] Criterion 5: Mainnet-staging configuration validates the selected Chainlink aggregator on-chain, remains disabled until deployment, and fails with an actionable error when the provider source is absent.
- [x] Criterion 6: Operator documentation gives one manifest-level switch procedure and states the feed-session/staleness limitation without claiming unsupported 24/5 coverage.

## Out of Scope

- Activating or trading an RWA before its market contracts are deployed and verified.
- Supplying an unverified SPY/USD Chainlink address.
- Enabling the SPCX market.

## Progress Tracking

- [x] Task 1: Add provider-aware manifest schema and validation.
- [x] Task 2: Add the Chainlink spot adapter and Solidity coverage.
- [x] Task 3: Wire provider selection through deployment and settlement.
- [x] Task 4: Generalize RFQ and operator readiness paths.
- [x] Task 5: Update manifests, documentation, and full verification.

## Implementation Tasks

### Task 1: Add provider-aware manifest schema and validation

**Objective:** Represent the oracle provider and provider-specific source explicitly, preserving current Pyth manifests while rejecting enabled or deployable markets with incomplete configuration.

### Task 2: Add the Chainlink spot adapter and Solidity coverage

**Objective:** Implement the smallest `ISpotFeed` adapter that validates Chainlink round integrity, freshness, and decimal normalization, with behavior-first Foundry tests.

### Task 3: Wire provider selection through deployment and settlement

**Objective:** Make the deployment script choose a Pyth or Chainlink spot/settlement stack from the manifest and serialize enough provider-aware sidecar data for services to consume it safely.

### Task 4: Generalize RFQ and operator readiness paths

**Objective:** Remove Pyth-only assumptions from feed freshness, staging preflight, sidecar parsing, and settlement selection while preserving provider-specific validation.

### Task 5: Update manifests, documentation, and full verification

**Objective:** Make the switch discoverable and safe in checked-in manifests/docs, then run targeted tests, full suites, execution checks, and a final scope review.

## Round Log

### Round 1 — provider switch, Chainlink NVDA, and verification

- Added manifest-level `oracleProvider`, `pythPriceId`, and `chainlinkAggregator` selection with legacy Pyth defaults and fail-closed provider validation.
- Added `ChainlinkSpotFeed`, Chainlink round-history expiry settlement, and scaled settlement wrapping so BEP-8056 markets use the multiplier checkpoint at expiry.
- Configured chain-56 NVDA for the reviewed Chainlink NVDA/USD aggregator `0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8`; SPY remains on Pyth because no reviewed BNB Chain SPY/USD feed was found.
- Removed the SPY-before-NVDA staging dependency, kept every undeployed market disabled, and made deployment, bootstrap, activation, RFQ readiness, settlement, sidecar, ownership, and Safe tooling provider-aware.
- Self-review closed the material gaps found in the round: stale env-supplied Pyth IDs in Chainlink mode, missing settlement-fixing-feed validation, scaled settlement binding, and a too-short expiry round-search window.

### Verification evidence

- `forge test`: 104 passed, 0 failed.
- `forge build`: exit 0; Foundry emitted lint warnings only.
- `pnpm exec turbo run test --force`: 9/9 tasks passed with zero cache hits; 276 tests passed and 3 skipped.
- `pnpm build`: 7/7 tasks passed; `pnpm typecheck`: 4/4 tasks passed; `pnpm exec turbo run lint --concurrency=1 --output-logs=full`: exit 0 with no errors and one pre-existing web warning.
- `pnpm --filter @hedge/e2e build`: exit 0 after the final sidecar validation changes.
- Deployment, bootstrap, and activation CLIs executed with `--help`; JSON manifests passed `jq empty`; the Safe script passed `bash -n`; `git diff --check` passed.
- The configured BNB Chain aggregator had contract code and returned `description() = "NVDA / USD"`, `decimals() = 8`, and a positive complete latest round. Historical round inspection supported the 24-hour settlement round-delay bound.
- Scope review found no new `SHORTCUT:` markers, no task-owned file over 800 lines, and no unrelated file included in this Buildout.

## Not Verified

- No live deployment, bootstrap transaction, activation transaction, or trade was submitted. Those are external blockchain mutations and remain behind the documented confirmation gates.
- SPY and SPCX do not have a verified no-Pyth BNB Chain source in this change and remain disabled.

## Changed Files

- `docs/builds/2026-08-17-switch-rwa-oracle-provider.md`
- `services/shared/src/markets.ts`
- `services/shared/test/markets.test.ts`
- `protocol/src/ChainlinkSpotFeed.sol`
- `protocol/src/ScaledSettlementFeed.sol`
- `protocol/script/MarketDeployerBase.sol`
- `protocol/script/AddMarket.s.sol`
- `protocol/script/AddMainnetStagingRwaMarket.s.sol`
- `protocol/script/TransferOwnership.s.sol`
- `protocol/test/ChainlinkSpotFeed.t.sol`
- `protocol/test/OracleProviderDeployment.t.sol`
- `protocol/test/RwaOracle.t.sol`
- `protocol/test/DeployMainnetStaging.t.sol`
- `protocol/test/mocks/MockChainlinkAggregator.sol`
- `protocol/deployments/markets/56.json`
- `protocol/deployments/markets/97.json`
- `protocol/deployments/markets/31337.json`
- `protocol/deployments/staging/markets/56.json`
- `protocol/deployments/staging/README.md`
- `protocol/safe/generate-accept-batch.sh`
- `protocol/OWNERSHIP.md`
- `services/e2e/src/rwa-testnet.ts`
- `services/e2e/src/rwa-testnet-operator.ts`
- `services/e2e/src/rwa-mainnet-staging-operator.ts`
- `services/e2e/src/rwa-testnet.test.ts`
- `services/e2e/src/deploy-rwa-testnet.ts`
- `services/e2e/src/deploy-rwa-mainnet-staging.ts`
- `services/e2e/src/bootstrap-rwa-mainnet-staging.ts`
- `services/e2e/src/activate-rwa-mainnet-staging.ts`
- `services/oracle-feeds/src/pyth.ts`
- `services/oracle-feeds/src/settlement.ts`
- `services/oracle-feeds/test/settlement.test.ts`
- `services/oracle-feeds/README.md`
- `services/rfq-engine/src/markets.ts`
- `services/rfq-engine/test/markets.test.ts`
- `infra/mainnet-staging/README.md`
- `PRODUCTION.md`
