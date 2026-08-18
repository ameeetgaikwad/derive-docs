# ADR 0012: Risk-governed rollout and kill switches

- Status: Accepted
- Date: 2026-08-14
- Implementation: Shadow-only mode and documentation exist; production controls/approvals are not implemented.

## Context

Even correct pricing code can lose money through bad calibration, adverse selection, fragmented collateral, venue outage, liquidation, reconciliation bugs, or credential compromise. A single “enabled” switch cannot express whether quoting versus risk reduction is safe.

## Decision

Progress through deterministic tests, historical replay, live read-only shadow, testnet end to end, funded-account mainnet shadow, an independently approved minimal canary, and controlled one-dimensional expansion.

Operate with distinct states for startup reconciliation, shadow, active, quote halt, hedge blocked, manual risk reduction, and full stop. Risk limits and alerts require named approval; all current defaults/examples are unapproved. The signer independently caps live actions.

Recognize fragmented collateral explicitly. Shadow reservations already use a bounded spot/IV stress grid and premium-plus-supplied-fee cash; production Hyperliquid capacity is based on authoritative full-account margin and approved tail delta migration, including a long call moving toward delta one. Live Derive cash also proves maximum signed fee and applicable lifecycle obligations.

## Consequences

- Time to production is governed by evidence rather than feature completion.
- Quoting can stop while controlled hedge reconciliation/reduction continues.
- Product expansion (puts, maker-short direction, multi-leg) requires new model/risk decisions, not a config edit.
- Limit increases require four-eyes approval; emergency reductions/halt are fast and audited.
- Sustained shadow success does not eliminate canary execution/adverse-selection risk.

## Rejected alternatives

- **Turn on with shadow defaults:** rejected because examples are not calibrated risk appetite.
- **One global kill switch:** rejected because it either permits unsafe quoting or disables needed risk handling.
- **Assume Derive option gains collateralize Hyperliquid losses:** rejected because collateral is fragmented and transfer/settlement is delayed.
- **Scale several dimensions simultaneously:** rejected because attribution and rollback become ambiguous.
- **Treat a live quote as harmless until fill:** rejected because it consumes worst-case capacity and may be accepted rapidly.

## Revisit when

Stages may be refined after incident drills and operational evidence. Skipping a stage or hard gate requires a new ADR with equivalent evidence and explicit model, risk, security, and operations approval; schedule pressure is not evidence.
