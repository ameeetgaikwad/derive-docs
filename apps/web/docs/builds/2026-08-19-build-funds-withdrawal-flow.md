# Funds Withdrawal Flow Buildout

Created: 2026-08-19
Agent: Codex
Status: COMPLETE
Approved: Yes
Rounds: 9
Worktree: No
Type: Build

## Summary

**Goal:** Give connected Hedge users a responsive funds modal that reads exact subaccount assets, previews and executes executor-backed withdrawals, directly repays negative USDT, and refreshes all affected balances.

**Oracle:** Frontend integration tests exercise the user-reachable account/asset/amount/Max flow through preview, signed preparation, submission/status reconciliation, and direct repayment, while the complete web test suite and type checker pass.

**Misfire:** The screen could look complete while moving the wrong native amount or treating a transport failure as a failed withdrawal; exact bigint conversion and uncertain-status tests catch this.

**Constraints:** Change only `apps/web/**`; preserve existing trading/account behavior; do not edit services, protocol, infra, or Git state; match the executor team's concrete wire contract before finalizing the API client.

**Assumed:** Account selection inside the modal is local, withdrawal recipients remain the signing wallet, repay Max is capped by wallet balance and current debt, and existing testnet faucet access remains available.

## Acceptance Criteria

- [x] Criterion 1 (Oracle): Frontend tests walk a connected user from opening Funds through exact preview, preparation, wallet signature, submission, status confirmation, and refreshed balances, and also cover the negative-USDT repay path.
- [x] Criterion 2: Every withdrawal and repayment amount stays as `bigint` internally and decimal strings at the API boundary, with tests covering six-decimal collateral, scaled collateral, floor-safe Max, and invalid precision.
- [x] Criterion 3: The responsive modal exposes validated account selection, all configured withdrawable assets, amount and Max controls, accessible loading/error/status states, and entry points from both AppShell and Positions.
- [x] Criterion 4: Signed withdrawal execution freezes wallet, chain, account, asset, amount, and multiplier context; rejected signatures remain retryable while submitted-but-unconfirmed requests reconcile by status rather than blind resubmission.
- [x] Criterion 5: Confirmed withdrawal or repay invalidates exact subaccount balances, account summaries, wallet reads, and position reads without optimistic balance mutation.
- [x] Criterion 6: Existing frontend behavior remains green under the full web test suite, type checker, linter, and production build.

## Out of Scope

- Executor/server implementation, protocol contract changes, deployment changes, arbitrary withdrawal recipients, swaps, or automatic collateral sales.

## Progress Tracking

- [x] Task 1: Build exact asset and amount primitives
- [x] Task 2: Add executor client and withdrawal lifecycle hook
- [x] Task 3: Add direct USDT repayment and refresh behavior
- [x] Task 4: Build responsive Funds modal and shell/positions entry points
- [x] Task 5: Complete tests, review, and verification

## Implementation Tasks

### Task 1: Build exact asset and amount primitives

**Objective:** Introduce the canonical withdrawable-asset registry, exact balance query, and native/scaled amount conversion helpers needed to prevent unit or rounding mistakes.

### Task 2: Add executor client and withdrawal lifecycle hook

**Objective:** Match the approved four-endpoint executor contract, prepare and sign EIP-712 withdrawal actions, reconcile statuses safely, and expose clear lifecycle/error state to the UI.

### Task 3: Add direct USDT repayment and refresh behavior

**Objective:** Implement exact USDT allowance/approve/deposit repayment with debt-aware Max and centralized post-confirmation query refresh.

### Task 4: Build responsive Funds modal and shell/positions entry points

**Objective:** Deliver an accessible desktop dialog/mobile sheet with local account selection, asset/amount/Max controls, repay mode, statuses, errors, and discoverable triggers in the application shell and positions view.

### Task 5: Complete tests, review, and verification

**Objective:** Cover financial conversions, hooks, API shape, query invalidation, and modal interactions; then run the complete web verification surface and close review findings.

## Round Log

- Round 1: Exact registry, bigint balance reads, and scaled/native conversion.
- Round 2: Canonical executor client, frozen prepared review, signing, status reconciliation, and structured errors.
- Round 3: Interest-adjusted USDT repayment, 1bp buffer, refresh sequencing, and responsive entry points.
- Round 4: Contract-authoritative Max, opaque action-data binding, durable resume/polling, account-local selection, and review snapshot hardening.
- Round 5: Removed effect-driven form synchronization, scoped drafts to exact account/asset pairs, preserved async account discovery, and closed all withdrawal lint errors.
- Round 6: Made interest-adjusted CashAsset simulation authoritative for the displayed cash descriptor and native Max while retaining the raw SubAccounts cash balance separately.
- Round 7: Persisted both hashed and hashless repayment ambiguity to prevent duplicate deposits, added explicit reconciliation/verification paths, and bound every signed withdrawal to the locally selected deployment addresses.
- Round 8: Kept confirmed repayments locked until authoritative balances refresh, failed closed when durable browser storage is unavailable, and replaced weak frontend action nonces with Web Crypto uint256 randomness.
- Round 9: Required durable withdrawal-operation tracking before any wallet signature or executor submission, preventing a storage failure from creating an unrecoverable in-flight withdrawal.

## Changed Files

- apps/web/docs/builds/2026-08-19-build-funds-withdrawal-flow.md
- apps/web/src/components/funds/FundsModal.test.tsx
- apps/web/src/components/funds/FundsModal.tsx
- apps/web/src/components/platform/AppShell.test.tsx
- apps/web/src/components/platform/AppShell.tsx
- apps/web/src/components/platform/PositionsWorkspace.tsx
- apps/web/src/components/platform/SubaccountMenu.tsx
- apps/web/src/components/ui/dialog.tsx
- apps/web/src/hooks/protocol/queryRefresh.ts
- apps/web/src/hooks/protocol/useRepayCash.flow.test.tsx
- apps/web/src/hooks/protocol/useRepayCash.test.ts
- apps/web/src/hooks/protocol/useRepayCash.ts
- apps/web/src/hooks/protocol/useSubaccountAssets.ts
- apps/web/src/hooks/protocol/useWithdraw.resume.test.tsx
- apps/web/src/hooks/protocol/useWithdraw.test.ts
- apps/web/src/hooks/protocol/useWithdraw.ts
- apps/web/src/lib/protocol/abis.ts
- apps/web/src/lib/protocol/__tests__/protocol.test.ts
- apps/web/src/lib/protocol/actions.ts
- apps/web/src/lib/protocol/withdrawal-assets.test.ts
- apps/web/src/lib/protocol/withdrawal-assets.ts
- apps/web/src/lib/protocol/withdrawals.test.ts
- apps/web/src/lib/protocol/withdrawals.ts
- apps/web/src/stores/funds.ts

## Verification

- `pnpm --filter @hedge/web test`: 26 files and 123 tests passed.
- `pnpm --dir apps/web exec tsc --noEmit`: passed.
- `pnpm --filter @hedge/web lint`: passed.
- `pnpm --filter @hedge/web build`: passed.
- Repository-wide final changes review passed with no actionable P0/P1/P2 code defect; chain confirmation policy, live canaries, monitoring, and TLS remain rollout gates.
