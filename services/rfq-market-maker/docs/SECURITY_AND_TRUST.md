# Security and trust boundaries

Last reviewed: 2026-08-14. Current code has no credentials or network side effects. This document defines requirements for adding them.

## Assets to protect

- Derive maker authorization, subaccount, collateral, signed quote capacity, and nonces.
- Hyperliquid account/API wallet, collateral, positions, order capacity, and nonces.
- Canonical instrument registry and approved policy.
- Durable reservations, positions, fills, P&L, and reconciliation cursors.
- Market data and time integrity.
- Audit evidence and operator identities.

The primary security outcome is not merely secret confidentiality; it is preventing unauthorized or incorrectly sized economic commitments.

## Trust boundaries

Treat all of the following as untrusted until independently validated:

- RFQ server payloads, socket messages, HTTP responses, and timestamps;
- option symbols, asset addresses, sub-IDs, direction labels, amounts, prices, fees, and expiries;
- Hyperliquid asset labels, metadata, books, account responses, and order responses;
- third-party market data and volatility surfaces;
- environment variables, dynamic configuration, operator inputs, and logs replayed as data;
- TypeScript types at runtime.

Trusted components should be minimal and separately reviewable: canonical registry, policy verifier, exact-intent builder, durable coordinator, Derive signer, Hyperliquid signer, and reconciliation logic.

## Canonicalization before valuation or signing

The ingress adapter must reconstruct the instrument from approved chain/contract metadata. Verify address, sub-ID, chain, strike, expiry, kind, multiplier, underlying, settlement, amount precision, and lifecycle. Then normalize full Derive RFQ/quote direction semantics into the local maker position.

The signer must reconstruct the exact signed legs from persisted canonical values, not reuse a mutated server object. It independently enforces:

- approved chain, contract, wallet, signer, and maker subaccount;
- single permitted product/direction and bounded amount/premium;
- exact legs ordering/hash/amount signs and max fee;
- nonce uniqueness and signature expiry no later than local policy;
- a durably committed reservation matching the intent hash and current policy;
- cumulative signer-side daily/notional limits and halt state.

No signer accepts arbitrary message bytes or an arbitrary EIP-191/EIP-712 payload from the application.

## Credential architecture

- Keep private keys out of source, logs, general environment dumps, crash reports, and the analytics process.
- Use dedicated, least-privilege keys/API wallets for environment and venue; never a personal/master treasury key in the service.
- Isolate signers behind authenticated, authorized, rate-limited interfaces with narrowly typed intents.
- Allowlist chain IDs, verifying contracts, accounts/subaccounts, assets, action types, and maximum values inside the signer.
- Use hardware/KMS/HSM custody where protocol compatibility allows, with protected backup and rotation procedures.
- Separate deploy, policy approval, signer administration, and operational resume roles.
- Revoke and rotate immediately after suspected compromise; halt first, then reconcile all actions.

Hyperliquid API-wallet nonce/pruning behavior and Derive signature schemas are protocol-specific and may change. Pin current official specifications and test signatures against the target environment before release.

## Replay, nonce, and expiry

Timestamp plus non-cryptographic randomness is not a production nonce strategy. Required properties:

- venue-compliant, persistent allocation across replicas/restarts;
- atomic uniqueness for each signing identity;
- protected against clock rollback and concurrent allocation;
- request identity bound to persisted intent;
- short local expiry capped independently from venue-supplied windows;
- never reuse an action identity after an ambiguous response without reconciliation;
- audit allocation, use, response, and retirement without logging secret material.

Hyperliquid actions should use planner-derived client IDs and supported `expiresAfter`; Derive quotes need exact nonce/signature-expiry handling from the deployed contract/API specification.

## Fill and event authenticity

A socket event is a hint. Before adding position or hedging, verify authoritative evidence and exact maker attribution. In particular, broad execution notifications must be filtered by maker wallet, maker subaccount, quote/RFQ identity, legs hash/amounts, approved contract, transaction receipt, and unique chain event identity.

Deduplicate at storage using authoritative unique keys. Handle reordering, duplication, delayed events, and chain reorganization according to an approved finality policy. A status string supplied by a server cannot override an inconsistent receipt or signed payload.

## Exact arithmetic and confused-deputy prevention

JavaScript `number` is prohibited at the signing boundary. An attacker or bug may exploit rounding, exponent parsing, precision loss, negative zero, overflow, or unit confusion. Exact-intent builders must accept canonical decimal strings/fixed-point integers, enforce asset scales, and round only in the risk-increasing conservative direction.

Names include units and venue/account identity. Current quote admission and hedge planning enforce Hyperliquid venue, policy network/account, and underlying/coin equality and carry them into order intents. Production adapters/signers must repeat that binding against current venue metadata; a valid price labeled for another coin, account, or environment must be rejected.

## Availability abuse and resource bounds

RFQ ingress can be used to exhaust CPU, memory, quote capacity, signer rate limits, or venue rate limits. Apply:

- authenticated source and schema/size/count limits;
- deduplication and per-source/per-taker rate limits;
- maximum concurrent/live reservations;
- bounded model runtime and queues with age-based discard;
- backpressure that declines rather than processes stale RFQs;
- separate capacity for reconciliation, cancellation, and emergency risk reduction;
- no unbounded retry loops.

Security throttles may reduce quote availability but must not prevent fill ingestion or risk reconciliation.

## Configuration and supply chain

- Signed/versioned policy with schema validation, four-eyes approval for risk increases, and environment separation.
- Deeply immutable runtime policy; TypeScript `readonly` and the current shallow `Object.freeze` are not security controls.
- Lockfile and reviewed/pinned protocol SDK commits/versions.
- Dependency vulnerability, provenance, license, and malicious-update review.
- Reproducible builds, artifact signing/attestation, secret scanning, and least-privilege deployment identity.
- No production startup with demo placeholder addresses or fixture sources.

## Logging and privacy

Audit logs include correlation IDs, hashes, versions, decisions, gates, exact public order/quote fields, lifecycle changes, and operator actions. Redact private keys, signatures where replay/sensitivity warrants, auth headers, tokens, internal endpoints, and unnecessary taker/user data. Protect logs from tampering and apply retention/access policy.

## Required security tests

- Property/fuzz tests for decimal parsing, canonicalization, direction signs, leg ordering, bounds, and signature hashes.
- Adversarial payloads: wrong chain/address/sub-ID/coin/account, duplicated IDs, huge/negative/NaN values, stale/future timestamps, malformed books, and TTL extension.
- Nonce concurrency, restart, and clock-rollback tests.
- Ambiguous-response and duplicate/out-of-order fill simulations.
- Signer authorization tests proving arbitrary payloads and over-limit intents fail.
- Dependency/secret scans and container/runtime privilege review.
- Testnet end-to-end signature and reconciliation fixtures from current official protocol versions.

No successful happy-path test compensates for a missing trust-boundary check.
