# Subaccount Directory Selector Buildout

Created: 2026-08-18
Agent: Codex
Status: VERIFIED
Approved: Yes
Rounds: 2
Worktree: No
Type: Build

## Summary

**Goal:** Replace the browser-persisted single subaccount ID with a production-grade directory that discovers every active trading subaccount for the connected wallet, validates candidates on-chain, and lets the user explicitly select one or create another.

**Oracle:** A browser-driven connected-wallet walkthrough lists every active SRM subaccount supplied by the directory, excludes a chain-invalid candidate, lets the user choose an account, and proves that exact account ID reaches the existing collateral and trade preparation flow.

**Misfire:** The directory and selector could look correct while the existing trade hooks still use a remembered or newly auto-created account; Criterion 1 catches this by observing the selected ID at the real preparation boundary.

**Constraints:** Do not use The Graph, do not build a general protocol indexer, do not change deployed contracts or pinned vendor contracts, do not persist the selected account ID in browser storage, and keep the directory advisory while live contracts remain authoritative.

**Reference:** Hyperliquid's `subAccounts` state-query UX — re-obtain with `https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint`.

## Acceptance Criteria

- [x] Criterion 1 (Oracle): A browser interaction with a connected test wallet shows the validated account list, permits explicit selection, and demonstrates that the selected ID is the one passed into collateral/trade preparation.
- [x] Criterion 2: A fresh backend integration test proves ordered deposit/withdraw projection, durable restart from a per-deployment checkpoint, and deterministic rebuild after a checkpoint block-hash mismatch.
- [x] Criterion 3: Endpoint tests prove the chain-configured directory returns sync metadata and decimal account IDs for a valid owner while invalid input, uninitialized state, and storage failure cannot appear as an empty successful list.
- [x] Criterion 4: Frontend tests prove directory candidates are accepted only when logical owner, manager, and NFT custodian match live configured contracts, with wallet-filtered event scanning used only after directory failure.
- [x] Criterion 5: Frontend interaction evidence proves selection is memory-only, resets when wallet/chain/Matching changes, and a confirmed `Matching.DepositedSubAccount` is inserted and selected before indexer catch-up.
- [x] Criterion 6: Repository configuration and documentation identify an authoritative Matching deployment block per supported deployment and provision durable directory storage without adding a general indexing stack.

## Out of Scope

- Indexing positions, balances, trades, settlement, fees, or analytics.
- Adding custom subaccount names.
- Persisting account selection across reloads.
- Replacing unrelated locally persisted covered-call trade history.
- Modifying `protocol/lib/v2-core` or `protocol/lib/v2-matching`.

## Progress Tracking

- [x] Task 1: Build and test the durable event projection.
- [x] Task 2: Expose the chain-configured directory API and production storage.
- [x] Task 3: Build frontend discovery, validation, fallback, and session state.
- [x] Task 4: Integrate the selector and create-new flow into existing trading surfaces.
- [x] Task 5: Wire deployment metadata, infrastructure, documentation, and runtime verification.

## Implementation Tasks

### Task 1: Build the durable event projection

**Objective:** Implement the smallest event consumer and storage contract that projects `DepositedSubAccount` and `WithdrewSubAccount` in canonical order, resumes durably, and rebuilds safely after a reorg.

### Task 2: Expose the directory API and production storage

**Objective:** Add the chain-configured read endpoint to the existing RFQ service and back it with one AWS-native durable table and explicit unavailable/syncing behavior.

### Task 3: Build frontend discovery and validation

**Objective:** Replace persisted single-ID discovery with in-memory account state, directory reads, batched contract validation, lightweight balance summaries, and a wallet-filtered RPC fallback.

### Task 4: Integrate selection and account creation

**Objective:** Add an accessible selector with a create-new action, route the chosen ID through current collateral/position/trade flows, and merge receipt-discovered accounts until the indexer catches up.

### Task 5: Complete production wiring and evidence

**Objective:** Record deployment origins, wire infrastructure and permissions, update affected operational documentation, and exercise the backend and browser paths against current runnable artifacts.

## Round Log

- Round 1 build: Implemented the focused Matching event projection, DynamoDB adapter, read endpoint, session-only selector, receipt insertion, live multicall validation, RPC fallback, deployment metadata, infrastructure, and operational documentation.
- Round 2 judge: Found and fixed two recovery/readiness defects. A missing checkpoint now clears stale projection rows before replay; reset removes the checkpoint before account rows and has matching IAM permission. Partial first-sync/reorg checkpoints remain unavailable until catch-up reaches the safe head. Both defects received failing-then-passing regression tests.

## Verification Evidence

- `pnpm test` — exit 0; 9/9 Turbo tasks. RFQ engine: 8 files, 44 tests. Web: 16 files, 77 tests. Repository suites reported zero failures.
- `pnpm typecheck` — exit 0; 4/4 Turbo tasks. `pnpm lint` — exit 0 with zero errors and one unchanged `TokenIcon.tsx` `<img>` optimization warning.
- `pnpm build` — exit 0; 7/7 Turbo tasks. RFQ engine compiled with `tsc`; Next.js production build compiled and generated all 8 static/dynamic routes.
- `terraform fmt -check -recursive` — exit 0. Isolated `terraform validate` runs for `infra/` and `infra/mainnet-staging/` both returned `Success! The configuration is valid.`
- Browser oracle at `http://127.0.0.1:3000/app`: an injected EIP-1193 BSC testnet wallet received advisory candidates `5`, `6`, and invalid `9`; live BSC contract multicalls rendered only `5` and `6`. Selecting `6` produced an RFQ request body with `"subaccountId":"6"`. Browser local storage contained wallet/network SDK state but no subaccount state; reload returned the selector to `Choose a subaccount` and disabled trading.
- Red/green evidence: changing receipt insertion from select=true to select=false failed the hook test (`expected 12, received 7`) before restoration. New stale-checkpoint and partial-readiness tests failed against the pre-fix implementation, then passed after the recovery changes.
- `impeccable detect --json` on the changed UI surfaces reported only two gray-on-color warnings on the pre-existing one-line `EmptyState` styling in `PositionsWorkspace.tsx`; the selector interaction was also checked through Playwright snapshots.

## Not Verified

- No Terraform apply, AWS DynamoDB request, or deployed directory endpoint was exercised. The browser mocked only the advisory directory HTTP response; candidate authorization and balances were read from live BSC testnet contracts.
- No real `createSubAccount` transaction was sent. Receipt decoding, live post-receipt validation, immediate insertion, and selection are covered by hook tests to avoid an unrequested chain mutation.
- WalletConnect QR behavior was not exercised because the local environment uses the documented placeholder instead of a real `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Browser console errors were limited to the resulting Reown `400`/`403`; injected-wallet behavior worked.
- Managed build-review and changes-review agents were unavailable in this side conversation. Two direct self-review rounds, mutation checks, full tests, builds, Terraform validation, and browser evidence were used instead.

## Shortcut Ledger

- `useCoveredCallSubaccount.ts` keeps the outage-only wallet-filtered RPC fallback serial in 2,000-block chunks for public-provider compatibility. Replace it with a redundant directory service if recovery latency becomes material.

## Changed Files

- Build record: `docs/builds/2026-08-18-subaccount-directory-selector.md`.
- Backend: `services/rfq-engine/package.json`, `src/config.ts`, `src/index.ts`, `src/server.ts`, `src/subaccount-directory.ts`, `src/dynamodb-subaccount-directory.ts`, `src/subaccount-directory-worker.ts`, `src/viem-subaccount-directory.ts`, `test/hardening.test.ts`, `test/directory-config.test.ts`, `test/dynamodb-subaccount-directory.test.ts`, `test/subaccount-directory-worker.test.ts`, `test/subaccount-directory.test.ts`, and `README.md`.
- Frontend: `apps/web/src/stores/account.ts`, `account.test.ts`, `src/lib/protocol/abis.ts`, `deployments.ts`, `rfq-engine.ts`, `subaccounts.ts`, their protocol tests, `src/hooks/protocol/useCoveredCallSubaccount.ts`, its test, `usePositionMonitor.ts`, `src/components/shared/SubaccountSelector.tsx`, its test, `target-composer.tsx`, `src/components/earn/CoveredCallFlow.tsx`, `src/components/platform/PositionsWorkspace.tsx`, `src/components/trade/covered-call-ui.tsx`, its test, and `apps/web/README.md`.
- Infrastructure/deployments: `infra/dynamodb.tf`, `infra/iam.tf`, `infra/ecs.tf`, `infra/variables.tf`, `infra/README.md`, `infra/mainnet-staging/dynamodb.tf`, `infra/mainnet-staging/ecs.tf`, `infra/mainnet-staging/README.md`, `protocol/deployments/56.json`, `protocol/deployments/staging/56.json`, and `protocol/deployments/97.json`.
- Dependency lock: `pnpm-lock.yaml`.
