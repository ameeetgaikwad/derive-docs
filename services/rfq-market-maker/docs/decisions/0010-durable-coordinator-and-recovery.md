# ADR 0010: Durable coordinator and recovery before live

- Status: Accepted
- Date: 2026-08-14
- Implementation: Not implemented. The in-memory ledger only sketches CAS semantics.

## Context

The two venues can accept an action when the network response is lost. Events can duplicate, reorder, arrive late, or be broad rather than maker-specific. A crash between reservation, signature, send, and response can otherwise lose or duplicate economic state.

## Decision

Before any live action, add a transactional durable coordinator with:

- one fenced logical writer per maker portfolio;
- monotonic portfolio revisions and optimistic CAS;
- reservation, quote, option-fill/position, hedge-intent/order/fill, cash/P&L, policy, and reconciliation state;
- intent-before-action outbox;
- authoritative identity-based deduplication;
- immutable event/audit history and explicit corrections;
- startup/reconnect reconciliation against both venues and chain;
- encrypted backups, point-in-time recovery, and restoration drills;
- fail-closed resume authorization.

Unknown quote outcomes remain reserved. Unknown hedge outcomes remain pending and block duplicate planning until reconciled. Fill promotion atomically converts reservation into exact confirmed inventory once.

## Consequences

- Live transport cannot be added as a thin callback around the pure functions.
- Database availability becomes a quoting dependency; in-memory fallback is prohibited.
- Schema migration, leader failover, event backfill, and reorg/finality behavior need integration and fault tests.
- Recovery may prefer safety over immediate availability.
- Operational corrections require dual control and provenance.

## Rejected alternatives

- **Persist periodic aggregate snapshots only:** rejected because intent/outcome gaps and deduplication cannot be reconstructed reliably.
- **Use logs as the database:** rejected because logs do not provide transactional invariants or authoritative correction semantics.
- **Rely solely on venue state:** rejected because venue APIs do not contain internal reservation/decision/idempotency intent and may be temporarily incomplete.
- **Active-active writers with eventual consistency:** rejected because concurrent reservations can oversubscribe risk.
- **Use Redis/process memory without a durability protocol:** rejected for the economic source of truth.

## Revisit when

The storage technology or concurrency pattern may change after proving equivalent serializable invariants, fencing, outbox behavior, durability, replay, backup, and recovery under fault injection. The invariants themselves are not optional.

