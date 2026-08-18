# Architecture decision records

Last reviewed: 2026-08-14.

These records explain why the service is shaped this way, what was rejected, what is implemented, and what evidence would justify revisiting a choice. “Accepted” approves a design direction; it does **not** approve live trading or imply implementation is complete.

| ADR | Decision | Design status | Current implementation |
| --- | --- | --- | --- |
| [0001](0001-isolate-the-new-market-maker.md) | Build an isolated service | Accepted | Implemented as separate package |
| [0002](0002-shadow-mode-first.md) | Shadow mode is the only v0 mode | Accepted | Implemented structurally |
| [0003](0003-pure-versioned-decision-kernel.md) | Pure, versioned decision kernel | Accepted | Implemented for quote/hedge analytics |
| [0004](0004-black76-baseline-model.md) | Black-76 is the v0 baseline model | Accepted | Implemented; production validation missing |
| [0005](0005-fail-closed-market-data.md) | Fail closed on market-data uncertainty | Accepted | Kernel gates implemented; adapters missing |
| [0006](0006-canonical-instrument-registry.md) | Locally verify canonical instruments | Accepted | Interface assertion only; registry missing |
| [0007](0007-reserve-all-live-quotes-with-cas.md) | Reserve every live quote using CAS | Accepted | In-memory prototype only |
| [0008](0008-confirmed-portfolio-target-hedging.md) | Hedge confirmed portfolio delta to a target | Accepted | Pure planner only |
| [0009](0009-bounded-ioc-hyperliquid-intents.md) | Use bounded IOC hedge intents | Accepted | Planning/simulation only |
| [0010](0010-durable-coordinator-and-recovery.md) | Durable single-writer coordinator before live | Accepted | Not implemented |
| [0011](0011-isolated-signers-and-exact-arithmetic.md) | Isolated signers and exact wire arithmetic | Accepted | Not implemented; no signing exists |
| [0012](0012-risk-governed-rollout-and-kill-switches.md) | Risk-governed staged rollout and kill switches | Accepted | Documentation only |

## Adding or changing a decision

Create a new numbered record rather than silently rewriting history. A record contains context, decision, consequences, rejected alternatives, and revisit triggers. If facts change, mark the old record superseded and link the replacement. Material model, product, risk, venue, signer, state, or rollout changes require an ADR and the approvals described in [Operations and rollout](../OPERATIONS_AND_ROLLOUT.md).

The date on these initial records is the design baseline, not a claim that the underlying protocol documentation will remain unchanged.

