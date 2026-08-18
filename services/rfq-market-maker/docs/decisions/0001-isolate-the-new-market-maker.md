# ADR 0001: Isolate the new market maker

- Status: Accepted
- Date: 2026-08-14
- Implementation: Separate `services/rfq-market-maker` package exists; `services/maker-bot` is unchanged.

## Context

The existing maker is a useful reference implementation but automatically responds within a narrow flow and explicitly lacks production hedging and portfolio controls. Retrofitting live-risk behavior into it would mix research, legacy assumptions, and new side-effect boundaries, making review and rollback difficult.

## Decision

Build the production candidate in a new package. It may study public/shared protocol types, but it does not import mutable runtime state, credentials, or behavioral assumptions from the existing maker. New live capability, if ever approved, belongs behind explicit adapters in this package.

The initial package owns only deterministic analytics and local fixtures. Existing maker behavior is neither modified nor silently selected as a fallback.

## Consequences

- Existing behavior remains stable while the new design evolves.
- Interfaces, state, and controls can be made production-specific without compatibility shortcuts.
- Some code or protocol knowledge may be duplicated until a safe, side-effect-free shared library is deliberately extracted.
- Operators must treat these as different services with different credentials, configuration, state, dashboards, and deployment approval.

## Rejected alternatives

- **Edit the existing maker in place:** rejected because it increases accidental activation and couples rollout to legacy behavior.
- **Add a production boolean to the existing loop:** rejected because a flag does not provide durable state, reservation, signer, or reconciliation boundaries.
- **Fork and immediately connect both venues:** rejected because it would add economic side effects before the decision/risk invariants are testable.

## Revisit when

Only consider shared extraction after both implementations expose a proven pure component with identical semantics and tests. Never merge service boundaries merely to reduce file count.

