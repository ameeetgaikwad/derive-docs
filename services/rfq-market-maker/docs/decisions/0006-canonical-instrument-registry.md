# ADR 0006: Canonical instrument registry

- Status: Accepted
- Date: 2026-08-14
- Implementation: The domain requires `identityVerified`, but no registry/decoder exists. The boolean is a shadow trust assertion only.

## Context

RFQ payloads contain economically decisive identifiers and direction semantics. A wrong option address, sub-ID, strike, expiry, multiplier, settlement asset, or amount sign can turn a small long call into a different or much larger position. Display symbols and server fields are not authority.

## Decision

Only a locally governed registry/decoder may create a verified instrument. It binds environment/chain, approved contracts, option asset, sub-ID decoding, underlying, settlement, kind, strike, expiry, multiplier, decimal scales, lifecycle, and the corresponding approved hedge venue/coin/account metadata.

The wire adapter normalizes complete Derive RFQ and quote direction semantics into an explicit maker position. The signer independently reconstructs and verifies the exact legs. `identityVerified: true` from an external caller is never sufficient in production.

## Consequences

- Product expansion requires registry governance and tests, not just accepting a new symbol.
- On-chain/API metadata discrepancies halt the product until resolved.
- Registry version becomes part of every decision, signature intent, fill, and audit record.
- Current code cannot ingest live RFQs safely despite having typed identities.

## Rejected alternatives

- **Trust `instrument_name`:** rejected because symbols are mutable display identifiers and do not encode all contract facts.
- **Trust RFQ server address/sub-ID fields directly:** rejected because ingress is a trust boundary and could be buggy or compromised.
- **Allow any call with BTC in its name:** rejected because expiry, strike, settlement, multiplier, and contract approval remain unconstrained.
- **Treat asset allowlist alone as complete identity:** rejected because one asset contract can represent many sub-IDs/instruments.

## Revisit when

Never remove canonical verification. Registry implementation/storage may change after proving atomic versioning, chain reorg/metadata lifecycle handling, signer parity, and rollback.

