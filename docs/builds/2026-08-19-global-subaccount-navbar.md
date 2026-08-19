# Global Subaccount Navbar Buildout

Created: 2026-08-19
Agent: Codex
Status: PENDING
Approved: Yes
Rounds: 0
Worktree: No
Type: Build

## Summary

**Goal:** Make the active trading subaccount a persistent, accessible navbar control across the authenticated app, with switching and creation in its menu and no oversized duplicate selector on trading or positions pages.

**Oracle:** A connected AppShell interaction test selects a validated account from the navbar and demonstrates that the same shared account context is consumed after moving between Options and Positions.

**Misfire:** The control could look global while allowing an in-flight quote to execute against one account as the navbar shows another; Criterion 4 catches this by requiring transaction-lifecycle locking and cleanup evidence.

**Constraints:** Preserve live on-chain candidate validation, explicit selection with no automatic account choice, wallet/chain/Matching scoping, the current visual system, and all unrelated uncommitted infrastructure work.

**Reference:** Current positions-page selector screenshot supplied by the user — re-open `/var/folders/2j/yhl32kkd167cl85z2d_yx31c0000gn/T/codex-clipboard-8fcaae5b-0ae4-4bce-a9af-28a2540a725a.png`.

## Acceptance Criteria

- [ ] Criterion 1 (oracle): A connected AppShell interaction test selects one of two validated accounts from the navbar and demonstrates that the same shared account context is consumed by both Options and Positions.
- [ ] Criterion 2: Component interaction tests prove that the navbar menu lists every validated account with ID and balance summary and exposes loading, empty, retry, create, and selected states without bypassing the existing discovery hook.
- [ ] Criterion 3: Desktop (1440px) and mobile (390px) browser evidence show the selector inside the app navbar with a minimum 44px trigger, no horizontal overflow, and no page-level `Trading subaccount` panel on Options or Positions.
- [ ] Criterion 4: Tests prove that account switching and creation are disabled for the entire quote/deposit/accept lifecycle and re-enabled when the lifecycle resets or the trading view unmounts.
- [ ] Criterion 5: The account-store and discovery-hook suites prove that changing wallet, chain, or Matching scope clears the prior account list and selection and that every displayed account remains live-validated on-chain.
- [ ] Criterion 6: Keyboard interaction evidence proves the menu trigger is reachable, selection is operable, focus is visible, and Escape closes the open menu.

## Out of Scope

- Changing the public marketing navbar.
- Persisting a selection across browser sessions.
- Changing contracts, indexer behavior, or DynamoDB schema.

## Progress Tracking

- [x] Task 1: Add behavioral coverage for the global menu and transaction lock.
- [x] Task 2: Build the responsive navbar subaccount menu.
- [x] Task 3: Remove duplicate platform selectors and wire transaction locking.
- [ ] Task 4: Exercise and refine the running desktop and mobile UI.

## Implementation Tasks

### Task 1: Add behavioral coverage for the global menu and transaction lock

**Objective:** Write failing interaction and store tests for account selection, creation, retry/error states, keyboard closing, and the lifecycle lock that prevents context changes during a live trade.

### Task 2: Build the responsive navbar subaccount menu

**Objective:** Add a compact app-navbar control that presents the selected account, validated account summaries, creation, recovery feedback, and accessible keyboard behavior on desktop and mobile.

### Task 3: Remove duplicate platform selectors and wire transaction locking

**Objective:** Make the navbar the sole account control inside the platform shell and connect the trading lifecycle to a global lock without changing the account used by an already-prepared RFQ.

### Task 4: Exercise and refine the running desktop and mobile UI

**Objective:** Run the app, interact with the affected paths in a browser at 1440px and 390px, and correct any layout, focus, or state-communication defects found before judging.

## Round Log

- Round 1 build: Task 1 added RED/GREEN coverage for account switching, creation, recovery, Escape focus restoration, and locked selection state.
- Round 1 build: Task 2 added the compact app-navbar menu and an AppShell interaction test that carries one selection from Options to Positions.
- Round 1 build: Task 3 removed the platform page selectors, moved no-account guidance to the navbar, and bound the global selection lock to the RFQ/deposit/accept lifecycle with unmount cleanup.
- Blocked hand-back: the user explicitly deferred the final automated and browser verification, so Task 4 and every acceptance criterion remain open.

## Changed Files

- apps/web/src/components/platform/SubaccountMenu.test.tsx
- apps/web/src/components/platform/SubaccountMenu.tsx
- apps/web/src/components/platform/AppShell.test.tsx
- apps/web/src/components/platform/AppShell.tsx
- apps/web/src/components/platform/PositionsWorkspace.tsx
- apps/web/src/components/shared/target-composer.tsx
- apps/web/src/components/trade/covered-call-ui.test.tsx
- apps/web/src/components/trade/covered-call-ui.tsx
- apps/web/src/hooks/protocol/useSubaccountSelectionLock.test.tsx
- apps/web/src/hooks/protocol/useSubaccountSelectionLock.ts
- apps/web/src/stores/account.test.ts
- apps/web/src/stores/account.ts
- docs/builds/2026-08-19-global-subaccount-navbar.md

## Not Verified

- Final automated tests, type checking, linting, and build were deferred at the user's request.
- Desktop and mobile browser interaction, layout, focus, and overflow checks were deferred at the user's request.
- The managed build and changes reviewers did not run because subagents are unavailable in this side conversation.
- The last green command preceded Task 3: `pnpm --filter @hedge/web test -- src/components/platform/AppShell.test.tsx src/components/platform/SubaccountMenu.test.tsx src/stores/account.test.ts` — 18 files, 82 tests passed; it does not verify the final diff.
