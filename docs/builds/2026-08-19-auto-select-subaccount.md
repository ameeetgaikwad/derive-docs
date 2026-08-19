# Auto-select Subaccount Buildout

Created: 2026-08-19
Agent: Codex
Status: PENDING
Approved: Yes
Rounds: 0
Worktree: No
Type: Build

## Summary

**Goal:** Automatically select a validated trading subaccount, restoring the user's last selection from browser storage and otherwise choosing the lowest account ID.

**Oracle:** Hook tests demonstrate that reopening a wallet restores its cached validated subaccount and that a wallet without a valid cache receives its lowest validated subaccount automatically.

**Misfire:** Persistence could leak a selection across wallets, chains, or Matching deployments, or keep using a stale unvalidated ID; Criterion 2 requires scope isolation and validated fallback behavior.

**Constraints:** Preserve live on-chain validation, the existing transaction-lifecycle selection lock, account creation behavior, and wallet/chain/Matching scoping; do not change contracts or backend directory behavior.

## Acceptance Criteria

- [ ] Criterion 1 (oracle): Hook tests show that discovery selects the cached validated account after a reopen and otherwise selects the lowest validated account ID.
- [ ] Criterion 2: Store tests show that cached selections are isolated by wallet, chain, and Matching address and that an invalid or stale cached ID is replaced by the lowest validated ID before becoming active.
- [ ] Criterion 3: Tests show that manual selection and newly created account selection update the cache while the existing selection lock still prevents changes during an in-flight trade.
- [ ] Criterion 4: The web documentation describes automatic validated selection, scoped browser persistence, and the lowest-ID fallback without weakening live validation guarantees.

## Out of Scope

- Persisting account balances or the directory response.
- Changing subaccount discovery, contracts, or the RFQ engine API.
- Renaming or otherwise ranking subaccounts beyond numeric account ID.

## Progress Tracking

- [x] Task 1: Add failing persistence and default-selection coverage.
- [x] Task 2: Implement scoped cached selection and lowest-ID fallback.
- [ ] Task 3: Update documentation and verify the complete web application.

## Implementation Tasks

### Task 1: Add persistence and default-selection coverage

**Objective:** Extend store and discovery-hook tests to capture cache restoration, lowest-ID fallback, stale-cache replacement, scope isolation, creation, and lock behavior before changing production code.

### Task 2: Implement scoped automatic selection

**Objective:** Persist only a decimal account ID under the existing wallet/chain/Matching scope, keep it inactive until live validation completes, and resolve selection to a valid cached account or the lowest validated ID.

### Task 3: Document and verify the behavior

**Objective:** Update the trading-subaccount documentation, run focused and full web checks, and inspect the final diff for regressions or unnecessary complexity.

## Round Log

- Round 1 build: Added RED coverage for cached restoration, lowest-ID fallback, stale-cache replacement, scope isolation, account creation, and selection locking; implemented validation-gated scoped persistence and reached 19 passing web test files / 87 tests.

## Changed Files

- docs/builds/2026-08-19-auto-select-subaccount.md
- apps/web/src/stores/account.ts
- apps/web/src/stores/account.test.ts
- apps/web/src/hooks/protocol/useCoveredCallSubaccount.ts
- apps/web/src/hooks/protocol/useCoveredCallSubaccount.test.tsx
- apps/web/README.md
