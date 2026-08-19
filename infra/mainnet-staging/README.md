# BSC mainnet-staging ECS stack

This is a separate Terraform root and state. It creates only the chain-56
staging runtime and reads the existing `hedge` ECS cluster, task roles, ECR
repositories, and default VPC as data sources. It cannot
reconfigure the existing testnet services.

It creates:

- `hedge-mainnet-staging-rfq-engine`, behind its own public ALB;
- `hedge-mainnet-staging-oracle-feeds`, with no inbound traffic;
- `hedge-mainnet-staging-maker-bot`, with outbound-only access to the RFQ ALB;
- isolated SSM parameters and CloudWatch log groups;
- encrypted, backed-up EFS state with separate RFQ and oracle access points;
- an encrypted, point-in-time-recoverable DynamoDB subaccount directory;
- separate security groups, target group, and listeners.

Both RFQ environments may listen on container port `3030`; Fargate task ENIs
and separate ALBs isolate them.

## Safe rollout

1. Copy `mainnet-staging.tfvars.example` to the ignored
   `mainnet-staging.tfvars` and enter the private RPC. The task definitions use
   `latest` because the existing CD workflow pushes both immutable SHA tags and
   `latest`, then forces a deployment. After bootstrap, rotate or correct the
   RPC directly in SSM; Terraform ignores later value changes so an apply cannot
   overwrite the live endpoint with a stale local value.
2. Verify the remote state bucket, enable the S3 backend in `versions.tf`, and
   run `terraform init`. Never share the existing stack's state key.
3. Create these out-of-band SSM `SecureString` parameters. Terraform injects
   them into ECS by ARN and never reads their values into state:
   - `/hedge/mainnet-staging/feed_signer_key` must derive to
     `0x7a5e6A644A97d1E4Be9a0cd87092C3e9d3b8400c`.
   - `/hedge/mainnet-staging/executor_private_key` must derive to
     `0x30Fe4CA44f7Fe7dd5DcB1359d3CB3e88EE1Bb267`.
   - `/hedge/maker_private_key` must derive to
     `0xE37515eF43C884e04147F4714A7fC1C70059C392`; chain-56 subaccount `4`
     must remain owned and funded by that address.
   - `/hedge/mainnet-staging/pyth_api_key` contains the Hermes API token. The
     ECS task consumes it as `PYTH_API_KEY`; do not put the value in tfvars.
   Raw keys are permitted only for this pre-production staging deployment;
   production must use independently controlled signing identities.
4. Plan and apply with all desired counts at zero:

   ```bash
   terraform plan -var-file=mainnet-staging.tfvars -out=tfplan
   terraform apply tfplan
   ```

5. Publish the reviewed RFQ, oracle, and maker images. The images must contain
   `protocol/deployments/staging/56.json` and its staging market manifest. For
   an oracle-only incident rollout, set `oracle_feeds_image_tag` to the reviewed
   immutable tag; do not change shared `image_tag` and accidentally roll RFQ or
   maker with a tag that does not exist in their repositories.
6. Keep `withdrawals_enabled=false`, set only `rfq_engine_desired_count` to one,
   and apply. Check its CloudWatch startup preflight and
   `curl http://<alb-dns>/health`. The directory starts at Matching block
   `115317084`, recorded as `matchingDeploymentBlock` in
   `protocol/deployments/staging/56.json`; wait for
   `GET /subaccounts?owner=<wallet>` to return checkpoint metadata before
   treating the account list as synchronized. Its RPC log scan uses 1,000-block
   chunks, verified against the configured staging provider. Confirm the task
   receives `WITHDRAWALS_ENABLED=false` and uses separate EFS journals at
   `/var/lib/hedge/rfq.jsonl` and `FUNDS_STORE_PATH`.
7. Stop every local chain-56 oracle, set `oracle_feeds_desired_count` to one,
   and apply again. The task pins `ORACLE_DISCOVERY_FROM_BLOCK=115316790` for
   BTC plus the validated OptionAsset deployment blocks `115693756` for XAU
   `116583626` for NVDA, and `116826473` for SPY because ordinary BNB RPC
   endpoints may not support historical-state discovery. It scans RWA markets sequentially in
   5,000-block chunks, retries transient log-query failures, and checkpoints
   each chunk. The ECS service is stop-before-start (`minimum healthy = 0`,
   `maximum = 100`); only one process may use the feed-signer nonce stream.
8. Set `maker_bot_desired_count` to one and apply. Keep exactly one staging
   maker task for this key and verify its CloudWatch authentication log.
9. Attach ACM/DNS, set `certificate_arn` and `rfq_public_hostname`, and apply.
   The staging maker then uses `wss://<rfq_public_hostname>/maker`; it must not
   use TLS against the raw ALB hostname because the certificate does not cover it.
10. Configure the deployed frontend's
    `NEXT_PUBLIC_RFQ_ENGINE_URL_56=https://<staging-host>`.

## Withdrawal singleton gate

Executor-backed withdrawal submission is fail-closed in this root:
`withdrawals_enabled` defaults to `false`. `FUNDS_STORE_PATH` defaults to the
dedicated EFS journal `/var/lib/hedge/funds.jsonl`; do not point it at the RFQ
`STORE_PATH`. The ECS service is also stop-before-start (`minimum healthy = 0`,
`maximum = 100`) so a replacement cannot overlap two tasks that share an
executor transaction nonce stream and append-only journals. Expect brief RFQ
downtime during each RFQ engine replacement.

Enable withdrawals only after all of these checks:

1. Deploy the reviewed image with `withdrawals_enabled=false`. Verify ordinary
   RFQs, `/health`, the subaccount directory, and the disabled withdrawal API.
2. Exercise preview, owner-signature validation, exact executor-context
   simulation, idempotent resubmission, receipt reconciliation, and restart
   recovery on Anvil or testnet using the same image.
3. On chain 56, independently verify the configured Matching,
   WithdrawalModule, CashAsset, collateral wrappers, allowed-module flag, and
   registered executor. Rehearse one smallest-allowed withdrawal from an
   explicitly selected staging account and review the resulting margin state.
4. Confirm there is exactly one RFQ ECS task, no other service or local process
   uses the staging executor key, both EFS journals are writable, and the funds
   journal has no unresolved `submitting` or `unknown` operation.
5. Set `withdrawals_enabled=true` while keeping
   `rfq_engine_desired_count=1`. Review a saved Terraform plan: it must change
   only the intended task definition/service rollout and must retain the
   stop-before-start deployment percentages. Apply that reviewed saved plan,
   then submit one bounded staging withdrawal and reconcile its receipt, nonce,
   recipient, amount, and post-withdrawal margin.

To disable submission, set `withdrawals_enabled=false` and roll the singleton
service again. Do not delete or replace `FUNDS_STORE_PATH` during rollback;
first reconcile any submitted or unknown operation against the module nonce and
chain logs. This gate applies only to this isolated pre-production staging root
and does not enable withdrawals in a production stack.

## RWA rollout

Gold, S&P 500, and NVIDIA are deployed and activated one at a time. SpaceX is
intentionally excluded. XAU occupies the first RWA slot; SPY and NVDA can then
be deployed in either order, so an unavailable provider does not block the
other equity market. The manifest and sidecar guards prevent accidental retries.

```bash
# Dry-run locally first.
pnpm deploy:rwa:mainnet-staging --market XAU

# Operator-only broadcast after reviewing the simulation and balances.
pnpm deploy:rwa:mainnet-staging --market XAU --broadcast --confirm

# Verify the selected external source. Pyth may be pushed; Chainlink is read-only.
pnpm bootstrap:rwa:mainnet-staging --market XAU
pnpm bootstrap:rwa:mainnet-staging --market XAU --broadcast --confirm

# Readiness check, then local manifest activation.
pnpm activate:rwa:mainnet-staging --market XAU
pnpm activate:rwa:mainnet-staging --market XAU --confirm
```

The market manifest selects the provider with `oracleProvider`. For `pyth`, set
`pythPriceId` and leave `chainlinkAggregator` null; the operator must provide
`PYTH_API_KEY` and use `HERMES_URL=https://pyth.dourolabs.app/hermes`. For
`chainlink`, set `pythPriceId` to null and set the reviewed aggregator address;
deployment and activation do not read Hermes or require a Pyth key. In both
cases, keep `enabled=false` and `contracts=null`, run the deploy command without
`--broadcast`, review the provider/source line, then broadcast. Never switch an
already-deployed market in place: deploy a fresh market stack and verify its
sidecar first.

NVDA and SPY are configured for the BNB Chain standard feeds at
`0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8` (`NVDA / USD`) and
`0xb24D1DeE5F9a3f761D286B56d2bC44CE1D02DF7e` (`SPY / USD`). The Chainlink
preflight verifies contract code, exact description, decimals, a complete
positive round, and freshness before any broadcast. Do not copy an address from
another chain or asset.

The bootstrap step exists because the singleton oracle intentionally publishes
only enabled markets, while activation requires a fresh on-chain source. It
does not publish signed forward/vol/rate feeds and never enables the market.

The oracle EFS access point holds separate state for every enabled market:

- `/var/lib/hedge/active-expiries.json`, `.XAU.json`, `.NVDA.json`, and `.SPY.json`;
- `/var/lib/hedge/settlement-twap.json`, `.XAU.json`, `.NVDA.json`, and `.SPY.json`.

Do not delete or merge these files during a rollout. Startup logs must show each
market loading its own path and saved cursor; a rebuild from BTC block
`115316790` for XAU, NVDA, or SPY means the deployed task definition or image
is wrong. A replacement must stop the old task before the new task reaches
`RUNNING`, then remain healthy through at least two signed-feed intervals before
RFQs are treated as ready.

Commit the new staging sidecar and manifest, publish all service/web images, and
roll oracle, RFQ, maker, then web. Verify `/markets`, complete a tiny RFQ, and
only then repeat for the next selected market. Equity activation can use
`--deferred` when the selected source is outside its publishing window; the
market remains runtime-closed until the external and signed feeds are fresh. A
standard Chainlink feed is not a promise of continuous 24/5 equity updates: the
adapter rejects data older than 24 hours, so weekends, holidays, and source
pauses deliberately fail closed. Deferred activation tolerates only this stale
last-round condition; feed address, code, identity, decimals, and round-integrity
failures remain hard stops.

The staging caps are deliberately small:

- aggregate XAU 0.05, per RFQ 0.01 XAUt;
- aggregate SPY 0.5, per RFQ 0.1 displayed SPYB;
- aggregate NVDA 1.0, per RFQ 0.25 displayed NVDAB.

For scaled bStocks, the protocol cap is set in canonical raw units from the
deployment-time multiplier. The RFQ engine separately enforces the displayed
per-order cap against the live, checkpointed multiplier.

Pyth RWA expiries settle from a benchmark proof in the five-minute window
at/after expiry. Chainlink RWA expiries use the first complete aggregator round
at/after expiry, allowing up to 24 hours for the standard feed's next heartbeat;
settlement remains pending until that round exists. Scaled markets apply the
multiplier checkpoint effective at expiry. Settlement is not automatic yet:
set `ORACLE_MARKET` and run the oracle `settle` command. Do not enable a market
without an expiry-day owner.

Raw keys are accepted only for this isolated pre-production staging stack.
Production must use controlled signing infrastructure for executor, oracle,
and maker identities.
