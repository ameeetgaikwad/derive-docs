# ADR 0002: Shadow mode first

- Status: Accepted
- Date: 2026-08-14
- Implementation: `MarketMakerPolicy.mode` accepts only `SHADOW`; there are no network or signing dependencies.

## Context

Quote signatures create time-bounded economic obligations, and a hedge order can lose money immediately. Pricing, direction, fees, attribution, reservation, margin, and recovery need evidence before either side effect is safe.

## Decision

The first version is incapable of live action. It may evaluate snapshots, emit quote/decline decisions, reserve in process for demonstration, and create hypothetical hedge intents. It must not load keys, authenticate, sign, call a venue, or infer a fill.

Live capability will be added only through new reviewed components after every hard gate in the rollout document passes. Changing `mode` is not sufficient and no permissive hidden environment override is allowed.

## Consequences

- We can collect decision and counterfactual outcome data without capital risk.
- Protocol transport, exact signing, and durable lifecycle work remain visible rather than masquerading as completed.
- Shadow results do not prove executable fill quality; latency, queueing, adverse selection, and account effects need later testnet/canary evidence.
- The demo can never be used as an operational failover.

## Rejected alternatives

- **Start with tiny mainnet trades:** rejected because size does not mitigate duplicate fills, wrong direction, signer compromise, or recovery failure.
- **Quote live but hedge manually:** rejected because a quote can fill faster than manual confirmation and all live quotes require reserved hedge capacity.
- **Connect read/write SDKs but promise not to call them:** rejected because capability increases accidental and supply-chain risk without current benefit.

## Revisit when

Add a non-shadow mode only in a separate ADR that cites completed testnet, mainnet-shadow, independent review, risk approval, durable recovery drills, exact signers, and a bounded canary plan.

