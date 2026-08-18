# ADR 0011: Isolated signers and exact wire arithmetic

- Status: Accepted
- Date: 2026-08-14
- Implementation: Not implemented. Current code has no signing/SDK/network path and uses JavaScript numbers for analytics.

## Context

Signing an incorrectly rounded price, amount, fee, direction, account, contract, or expiry is an irreversible economic/security error. A general application process with a raw private key can become a confused deputy if fed an arbitrary payload.

## Decision

Separate Derive and Hyperliquid signing behind narrow authenticated interfaces. Each signer receives a persisted canonical intent, reconstructs exact protocol fields using checked decimal/fixed-point integers, and independently enforces environment, chain, contract, account/subaccount, product, amount, price, fee, expiry, nonce, cumulative limit, reservation, and halt constraints.

No JavaScript `number` or arbitrary prebuilt bytes cross the signer boundary. Keys are dedicated and least privilege; Hyperliquid uses a restricted API wallet where applicable, while high-value/master credentials remain outside the service. Nonces are persistent, atomic, signer-scoped, venue-correct, and restart-safe.

## Consequences

- Analytics and protocol encoding can evolve/test independently.
- A compromised coordinator is constrained by signer policy, though it can still consume approved capacity and must be detected/rate-limited.
- Exact intent schemas, canonical hashing, key custody, rotation, and independent audit become required infrastructure.
- SDK/ABI updates need pinned review and compatibility tests.
- Conservative rounding may decline or slightly lower more quotes than binary floating-point output.

## Rejected alternatives

- **Load owner/master private keys into the market-maker process:** rejected because compromise blast radius is excessive.
- **Let the signer sign arbitrary bytes:** rejected because it cannot enforce economic intent or domain separation.
- **Serialize JavaScript numbers directly:** rejected because binary rounding and large-integer precision can alter signed terms.
- **Timestamp plus `Math.random` nonce:** rejected because it is not collision-safe, persistent, or concurrency-safe.
- **One API wallet shared across unrelated processes/subaccounts:** rejected because signer-scoped nonce and compromise domains collide.

## Revisit when

Signer technology may change after security review, but narrow typed authorization, exact arithmetic, independent limits, dedicated credentials, audit, and venue-correct nonce/replay handling remain mandatory.

