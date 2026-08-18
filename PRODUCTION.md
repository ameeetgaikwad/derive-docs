# Production readiness checklist 

Status: **PRE-LAUNCH**. The isolated chain-56 staging contracts are deployed and
may be used for explicitly labelled, capped public testing. Production deposits
and unrestricted production trading must remain gated until every P0 item below
has an owner, evidence, and sign-off.

This is the cross-system launch checklist. Use
[`protocol/MAINNET.md`](protocol/MAINNET.md) for deployed addresses and broadcast
commands, [`protocol/OWNERSHIP.md`](protocol/OWNERSHIP.md) for admin transfer,
[`services/shared/KMS.md`](services/shared/KMS.md) for signing keys, and
[`infra/README.md`](infra/README.md) for hosting.

## Chain-56 staging deployment

[`DeployMainnetStaging.s.sol`](protocol/script/DeployMainnetStaging.s.sol) is an
isolated BSC mainnet deployment entrypoint for controlled testing with real
chain-56 tokens, oracle contracts, and transaction behavior. It is intentionally
available to public staging takers, but it is not a production deployment or a
representation that the production launch checklist is complete.

The staging deployment:

- requires chain ID 56 and the explicit
  `MAINNET_STAGING_CONFIRM=DEPLOY_HEDGE_MAINNET_STAGING_CHAIN_56`
  acknowledgement;
- requires an explicit `PRIVATE_KEY`, `FEED_SIGNER`, and `TRADE_EXECUTOR`, with
  distinct deployer, feed-signer, and trade-executor addresses;
- writes addresses to `protocol/deployments/staging/56.json` instead of
  replacing the existing chain-56 deployment record;
- rejects `BTCB_ADDRESS`, `USDT_ADDRESS`, or `PYTH_ADDRESS` overrides unless
  they exactly match the pinned staging dependencies, and validates token
  metadata plus the BTC/USD Pyth and Chainlink feeds before deployment;
- deploys with a `0.05 BTC` aggregate option-position cap, a `0.05 BTCB`
  aggregate base-position cap, disabled cash borrowing, and the existing
  production-like OI fee settings;
- may retain the dedicated staging deployer EOA as administrator so operators
  can rapidly test and recover the isolated deployment; and
- must use fresh staging accounts, minimal real funds, a maker allowlist, RFQ
  rate limiting, and deliberately small exposure caps. Public taker access is
  intentional for this staging environment; taker authentication is not
  implemented.

Do not promote the staging contracts or deployment record to production. A
production launch still requires a separately reviewed deployment, Safe
ownership, audited oracle and collateral changes, durable services, and every
P0 gate below.

Pinned chain-56 staging dependencies:

| Dependency | Address / ID |
|---|---|
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` |
| USDT | `0x55d398326f99059fF775485246999027B3197955` |
| Pyth Core (upgraded BNB mainnet contract) | `0xdF21D137Aadc95588205586636710ca2890538d5` |
| Pyth BTC/USD price ID | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| Chainlink BTC/USD | `0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf` |

### Staging RWA markets

Chain-56 staging can add Gold (`XAUt`), S&P 500 (`SPYB`), and NVIDIA
(`NVDAB`) without modifying the production deployment path. SpaceX remains
hidden and unsupported. Use the guarded `deploy:rwa:mainnet-staging` and
`activate:rwa:mainnet-staging` commands documented in
[`infra/mainnet-staging/README.md`](infra/mainnet-staging/README.md).

Every new market is deployed disabled. XAU takes the first RWA slot; SPY and
NVDA may then be rolled out in either order. Each activation requires verified
contracts, collateral metadata, the manifest-selected Pyth or Chainlink binding,
signer gas, and fresh source data (or an explicit deferred equity activation
that remains fail-closed at runtime). BTC must stay open if an RWA feed, token,
or multiplier is unavailable.

Pinned staging collateral and feed inputs must be revalidated immediately
before each broadcast:

| Market | Collateral | Provider source | Per-RFQ maximum |
|---|---|---|---|
| XAU | `0x21cAef8A43163Eea865baeE23b9C2E327696A3bf` | Pyth `0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2` | `0.01 XAUt` |
| SPY | `0x7138b48df7D98D7e3cc221BfE7192D0a178182D8` | Chainlink `0xb24D1DeE5F9a3f761D286B56d2bC44CE1D02DF7e` | `0.1` displayed SPYB |
| NVDA | `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` | Chainlink `0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8` | `0.25` displayed NVDAB |

SPY/NVDA remain unavailable whenever their selected sources are stale; this is
a deliberate fail-closed boundary, not continuous 24/5 synthetic equity pricing.
Scaled bStock amounts are canonical raw units on-chain and are converted only at
UI, price, and cap boundaries using the live checkpointed ERC-8056 multiplier.
Pyth RWA expiry settlement requires a reviewed benchmark update in the first
five minutes at/after expiry. Chainlink RWA settlement instead fixes from the
first complete aggregator round at/after expiry, with a 24-hour maximum delay;
scaled markets apply the checkpointed multiplier effective at expiry.

The staging stack pins [Pyth's upgraded EVM contract](https://docs.pyth.network/price-feeds/core/contract-addresses/evm)
for the August 18, 2026 Core upgrade. Revalidate every pinned dependency against
the official issuer/oracle source immediately before broadcasting staging.

The isolated runtime templates live in
[`protocol/deployments/staging`](protocol/deployments/staging): BTC RFQs are
limited to `0.01`, aggregate protocol exposure is capped, public takers are
enabled, and a maker allowlist is required. The RFQ engine uses port `3030` on
its dedicated mainnet-staging server, matching the testnet service's port on its
separate server. If both services run on one host, assign one a different port
and update its frontend URL. Put the staging secrets in a file outside the
repository containing `RPC_URL_56`, `PRIVATE_KEY`, `FEED_SIGNER`,
`TRADE_EXECUTOR`, and
`MAINNET_STAGING_CONFIRM=DEPLOY_HEDGE_MAINNET_STAGING_CHAIN_56`. Simulate first:

```sh
cd protocol
set -a
source /secure/path/mainnet-staging.env
set +a
forge script script/DeployMainnetStaging.s.sol --rpc-url "$RPC_URL_56" -vvvv
```

Review the complete simulation output and predicted staging addresses. The
operator may then rerun the same entrypoint with broadcasting explicitly
enabled:

```sh
forge script script/DeployMainnetStaging.s.sol \
  --rpc-url "$RPC_URL_56" \
  --broadcast \
  --slow \
  -vvvv
```

The freshly deployed 10 USDT minimum OI fee intentionally makes `0.0001 BTCB`
smoke trades fail margin checks. For the isolated micro-trade window only,
configure a 0.01 USDT minimum while retaining the 0.1% OI fee rate:

```sh
cd protocol
MAINNET_STAGING_FEE_CONFIRM=SET_HEDGE_MAINNET_STAGING_MIN_OI_FEE_0_01 \
forge script script/ConfigureMainnetStagingFee.s.sol \
  --rpc-url "$RPC_URL_56" \
  -vvvv

# After reviewing the simulation:
MAINNET_STAGING_FEE_CONFIRM=SET_HEDGE_MAINNET_STAGING_MIN_OI_FEE_0_01 \
forge script script/ConfigureMainnetStagingFee.s.sol \
  --rpc-url "$RPC_URL_56" \
  --broadcast \
  --legacy \
  --with-gas-price 200000000 \
  --slow \
  -vvvv
```

After the fee configuration, run the read-only verifier before
populating/enabling the staging market manifest:

```sh
forge script script/VerifyMainnetStaging.s.sol --rpc-url "$RPC_URL_56"
```

Do not apply this staging-only minimum to a production deployment.

A minimal-value real-BTCB staging trade has been completed against this
deployment. The ITM and OTM settlement rehearsals remain outstanding and are
still part of the combined P0 launch gate below.

## P0 launch blockers

- [ ] Replace the static USDT/USD assumption with a live, independently checked
  production oracle and verify `StandardManager.stableFeed` on-chain.
- [ ] Preserve BTC/USD as the BTC option-underlying and settlement reference,
  while adding separate BTCB collateral/depeg valuation.
- [ ] Complete a focused external audit of the custom oracle, settlement, RFQ,
  and any BTCB collateral-pricing changes.
- [ ] Transfer every owner/admin role and the fee-recipient subaccount to the
  production Safe; confirm acceptance on-chain.
- [ ] Deploy the RFQ engine and oracle updater to production infrastructure with
  durable state, redundant RPC access, monitoring, and alerts.
- [ ] Complete a minimal-value real-BTCB mainnet trade and both an ITM and OTM
  settlement rehearsal.
- [ ] Onboard production market makers, enable the allowlist, and complete a
  testnet soak period with observable quote and fill SLOs.
- [ ] Review the frontend's chain-56 addresses, RPC, RFQ/WSS endpoints, token
  approvals, transaction simulations, and failure messages.
- [ ] Start with conservative caps and a documented pause/rollback procedure.

## Oracle migration and operation

### USDT/USD must be dynamic

The existing signed `stableFeed` has been seeded with a static `1e18` value. A
daemon that repeatedly signs `$1` can keep testnet operational, but it disables
meaningful depeg protection and is not a production price source.

- [ ] Select a live USDT/USD primary source and an independent secondary source.
- [ ] Normalize both sources to 18 decimals and enforce positive-price,
  staleness, and cross-source-deviation checks on-chain.
- [ ] Configure `StandardManager.stableFeed` to use the production adapter.
- [ ] Test USDT at `$1.00`, below the depeg threshold, materially depegged,
  stale, missing, and divergent between sources.
- [ ] Alert before the stable-feed heartbeat expires; do not rely on an operator
  noticing a reverted trade.

### Keep BTC/USD; separately price BTCB collateral

BTC options are defined against BTC, so BTC/USD must remain the market's
underlying price for option risk, forwards, and settlement. Replacing that feed
with BTCB/USD would incorrectly turn a BTCB wrapper depeg into a change in the
BTC option underlying.

The current base-collateral path assumes `1 BTCB = 1 BTC`. Production must also
measure the value of the token actually held as collateral. Acceptable designs
include:

- `BTC/USD * BTCB/BTC`, using independent and sufficiently liquid sources; or
- an independently sourced BTCB/USD price, conservatively bounded by BTC/USD,
  for example `min(BTC/USD, BTCB/USD)`.

Apply explicit haircuts, exposure caps, staleness checks, liquidity/deviation
circuit breakers, and a fail-closed policy. A DEX spot quote alone is not a safe
oracle; any TWAP source needs manipulation and liquidity analysis.

The vendored `StandardManager` currently shares one market spot feed between BTC
option risk and base-collateral valuation. Separating BTC underlying value from
BTCB collateral value therefore needs an audited adapter/risk-manager change and
may require contract/state migration. Merely calling `setOraclesForMarket` with
BTCB/USD is not an acceptable fix.

- [ ] Approve the BTCB collateral-pricing design and threat model.
- [ ] Test BTCB/BTC depegs while holding BTC/USD constant.
- [ ] Verify a BTCB depeg reduces collateral value without changing BTC option
  marks or settlement.
- [ ] Test thin-liquidity, stale, manipulated, and unavailable BTCB price paths.

### Feed-daemon safeguards and remaining operations

Implemented in the repository daemon:

- [x] Maintain the stable signed feed on an independent schedule; chain 56
  rejects a static stable-price configuration.
- [x] Reject Pyth and signed-spot cadences that meet or exceed their 60-second
  and 180-second staleness/heartbeat limits.
- [x] Run Pyth, signed BTC, stable, active-expiry discovery, and settlement on
  independent schedules with same-account nonce serialization and support for
  a separate `PYTH_PUSHER` account.
- [x] Atomically publish signed BTC spot plus every active forward/rate/vol feed
  through Multicall3 on BSC.
- [x] Derive oracle coverage from `tradeable expiries U confirmed expiries with
  non-zero option balances U break-glass extras`; persist finalized
  `BalanceAdjusted` replay state and rebuild on a checkpoint reorg.
- [x] Preserve rolling 30-minute `LyraForwardFeed` spot aggregates across
  restarts and fail closed on chain 56 when the tracker starts inside the
  settlement window without complete prior history.
- [x] Discover expired account holders for permissionless anchored settlement;
  remove an indexed series only after confirmed zero-balance events. Automatic
  execution remains explicitly gated by `AUTO_SETTLE=true`.
- [x] Disable invented flat-IV fallback by default on chain 56 when Deribit has
  no valid surface.

Required before mainnet operation:

- [ ] Detect and persist observation gaps that overlap the final 30-minute TWAP
  window before integrating between samples. Reject gaps above a reviewed limit
  tied to `FEED_INTERVAL_SEC` and the on-chain settlement heartbeat on chain 56;
  add outage/restart tests for gaps beginning both before and inside the window.
- [ ] Put `ORACLE_STATE_PATH` and `ORACLE_TWAP_STATE_PATH` on durable encrypted
  storage; restore them in a staging rehearsal and verify the on-chain replay
  reaches the same active expiry/account set.
- [ ] Pin and record `ORACLE_DISCOVERY_FROM_BLOCK`, capacity, confirmations,
  block-chunk size, and every cadence in reviewed production configuration.
- [ ] Enable `AUTO_SETTLE=true` only after a full anchored-settlement rehearsal,
  including unavailable/delayed Chainlink rounds and Pyth disagreement.
- [ ] Decide whether trades should carry a just-in-time Pyth update in addition
  to the continuously funded keeper.
- [ ] Re-verify official Pyth and Chainlink addresses, feed IDs, governance, and
  upgrade status immediately before launch.
- [ ] Monitor updater wallet BNB balance, update fees, transaction inclusion,
  index lag, active expiry coverage, TWAP late-start warnings, last accepted
  timestamps, source divergence, confidence, settlement backlog, and
  consecutive failures.
- [ ] Define active/passive ownership or leader election before running multiple
  updater replicas, so redundancy does not create duplicate spend or competing
  state writers.
- [ ] Document signer threshold and rotation. A single KMS feed signer is an
  operational and governance dependency even when spot uses Pyth.

### Settlement oracle

- [ ] Rehearse Chainlink-round selection across aggregator phase changes and
  delayed rounds.
- [ ] Exercise Pyth disagreement, stale Pyth, missing anchor data, and the
  timelocked override path.
- [ ] Verify expiry timezone, 30-minute TWAP assumptions, settlement idempotency,
  and repeated settlement calls.
- [ ] Alert on every expired series that is not fixed and settled within its SLO.

## Contracts, ownership, and economic safety

- [ ] Complete the ownership inventory and verify no deployer EOA remains owner
  after the Safe handover.
- [ ] Require multisig review for oracle addresses, heartbeat/deviation settings,
  caps, fees, managers, executors, and settlement overrides.
- [ ] Audit `PythSpotFeed`, `AnchoredSettlementFeed`, deployment wiring, and all
  changes that separate BTCB collateral pricing from BTC option pricing.
- [ ] Confirm production token addresses and decimals; reject testnet mock
  addresses in chain-56 configuration and deployment tooling.
- [ ] Re-evaluate BTCB and option caps, base margin factors, depeg penalties,
  oracle-contingency parameters, minimum OI fee, and borrowing behavior under
  stressed prices.
- [ ] Rehearse withdrawals, insufficient margin, auctions/liquidations, feed
  outages, and insolvent-account behavior.
- [ ] Keep the initial production caps deliberately small until live telemetry
  and settlement rehearsals justify increases.
- [ ] Verify vendored contract pins, GPL/AGPL notices, and the restrictions in
  [`protocol/PROVENANCE.md`](protocol/PROVENANCE.md).

## RFQ engine and market makers

- [ ] Use a durable production store and prove restart/replay idempotency.
- [ ] Confirm the deployment model does not run multiple writers against a local
  append-only store without coordination.
- [ ] Require TLS/WSS, maker allowlisting, request limits, body limits, heartbeat
  enforcement, and authentication replay protection.
- [ ] Terminate TLS at the RFQ engine's Application Load Balancer using an ACM
  certificate and a production DNS name. Configure makers with
  `RFQ_ENGINE_WS=wss://<production-rfq-domain>/maker`; do not use the raw
  `ws://<alb-dns>/maker` testnet endpoint for production or chain-56 traffic.
- [ ] Simulate `verifyAndMatch` immediately before submission and return decoded
  custom errors. Include feed and manager errors such as `BLF_DataTooOld`,
  `PSF_StalePythPrice`, and SRM margin failures in observability.
- [ ] Monitor connected makers, quote coverage, auction latency, rejected quotes,
  expired taker actions, execution reverts, and fill success rate.
- [ ] Define behavior for zero makers, one maker, stale quotes, executor outage,
  RPC disagreement, and transaction replacement.
- [ ] Fund and alarm the executor wallet; rotate it through the documented
  Matching/Safe procedure.

## Infrastructure and secrets

- [ ] Apply and review Terraform from a controlled CI identity; do not deploy
  production services from a developer laptop.
- [ ] Use scoped KMS/IAM roles for the feed signer and executor. Remove root and
  long-lived developer credentials.
- [ ] Treat the SSM-injected `EXECUTOR_PRIVATE_KEY` configuration as testnet-only.
  Before any chain-56 deployment, remove it and restore non-exportable KMS
  signing through `EXECUTOR_KMS_KEY_ID` with an executor-scoped ECS task role;
  never inject the production executor private key into a container environment.
- [ ] Store RPC credentials and service secrets in the designated secret store,
  never images, Git, frontend variables, or Terraform state outputs.
- [ ] Configure at least two validated BSC RPC providers with health-based
  failover and chain-ID/genesis checks.
- [ ] Configure service health checks, restart policies, log retention,
  dashboards, paging, and runbooks.
- [ ] Back up durable RFQ state and test restore without replaying completed
  executions.
- [ ] Record deployed image digests and make rollback to the previous known-good
  release a rehearsed operation.

## End-to-end acceptance

- [ ] Run repository lint, test, build, typecheck, Foundry build/test, and all
  Docker image builds listed in [`PROD_LAYOUT.md`](PROD_LAYOUT.md).
- [ ] Complete a multi-day chain-97 soak with the same service topology, signer
  model, intervals, and alarms planned for chain 56.
- [ ] On chain 56, deposit minimal real USDT/BTCB, open subaccounts, collect
  multiple quotes, execute one minimal RFQ, and verify all cash, option, fee, and
  collateral balances.
- [ ] Settle controlled ITM and OTM expiries and verify payouts and post-settlement
  account health.
- [ ] Test stale Pyth, stale signed feeds, stale/dynamic USDT, BTCB depeg,
  Chainlink/Pyth divergence, insufficient gas, RPC outage, service restart, and
  duplicate request scenarios.
- [ ] Capture transaction hashes, before/after balances, oracle timestamps, and
  sign-offs in the launch evidence package.

## Frontend and user safety

- [ ] Confirm chain ID 56, all contract/token addresses, decimals, explorer links,
  API URL, and WSS URL in the production build artifact.
- [ ] Simulate approvals, deposits, RFQ acceptance, withdrawals, and settlement
  with production ABIs and decoded errors.
- [ ] Prevent submission when feeds, services, wallet network, or quote expiry are
  unhealthy.
- [ ] Display material risks: BTCB custody/depeg, oracle availability, option
  expiry/settlement, collateral liquidation, and smart-contract risk.
- [ ] Verify analytics and logs do not capture signatures, private RPC URLs,
  access tokens, or wallet-sensitive payloads beyond the documented policy.

## Launch and rollback

- [ ] Assign a named owner and evidence link to every P0 item.
- [ ] Hold a final Safe-owner, engineering, security, operations, and product
  sign-off review.
- [ ] Announce a launch window with protocol, oracle, infrastructure, and market
  maker responders present.
- [ ] Begin with conservative caps and a monitored canary period.
- [ ] Define objective stop conditions: stale oracle, source divergence, no quote
  coverage, abnormal revert rate, executor/updater low balance, or unexplained
  accounting differences.
- [ ] Rehearse the exact Safe transactions and service actions needed to pause the
  frontend, stop new RFQs, lower caps, rotate a signer/executor, repoint an oracle,
  and roll back services.

Production readiness is complete only when unchecked P0 items are zero and the
evidence package is reviewed by the production Safe owners. A successful testnet
trade or one successful mainnet smoke transaction is necessary, but not sufficient,
for launch.
