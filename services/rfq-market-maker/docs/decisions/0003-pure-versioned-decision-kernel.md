# ADR 0003: Pure, versioned decision kernel

- Status: Accepted
- Date: 2026-08-14
- Implementation: Quote evaluation and hedge planning are deterministic from caller-supplied inputs; diagnostics include policy/model/snapshot and ledger versions where applicable.

## Context

Market making mixes math with clocks, sockets, databases, and signing. If those concerns are interleaved, a historical decision cannot be reproduced and safety gates are difficult to test exhaustively.

## Decision

Keep pricing, quote/decline, exposure, book simulation, and hedge planning as side-effect-free functions. Supply time, normalized snapshots, portfolio state, policy, model version, and correlation identity explicitly. Return data describing a decision or intent; do not publish it.

Side effects belong to a coordinator/adapters that persist intent, enforce idempotency, and reconcile authority. Model and policy versions are first-class decision inputs/outputs.

## Consequences

- Decisions can be replayed exactly given recorded inputs and code artifact.
- Unit/property/fuzz testing does not require venue mocks.
- Callers bear responsibility for complete runtime validation and immutable snapshots.
- A pure kernel does not solve concurrency: the reservation version must still be committed transactionally.
- Throwing math functions are treated as input/programming failure; a production coordinator must catch, classify, halt/decline safely, and alert.

## Rejected alternatives

- **Read globals/environment/current time inside pricing:** rejected because results become unreplayable.
- **Let the quote engine write/send directly:** rejected because risk reservation and transport ambiguity require a transactional coordinator.
- **Hide all diagnostics behind logs:** rejected because logs are not authoritative state and are hard to bind to an exact decision.

## Revisit when

Performance optimization may introduce caching or workers only if cache keys include every version/input, outputs remain deterministic, stale results cannot cross a portfolio revision, and equivalence tests pass.

