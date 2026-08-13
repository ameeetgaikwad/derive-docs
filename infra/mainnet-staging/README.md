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
   `protocol/deployments/staging/56.json` and its staging market manifest.
6. Set only `rfq_engine_desired_count` to one and apply. Check its CloudWatch
   startup preflight and `curl http://<alb-dns>/health`.
7. Stop every local chain-56 oracle, set `oracle_feeds_desired_count` to one,
   and apply again. The task pins `ORACLE_DISCOVERY_FROM_BLOCK=115316790`, the
   staging `SubAccounts` deployment block, because ordinary BNB RPC endpoints
   may not support historical-state discovery. Only one process may use the
   feed-signer nonce stream.
8. Set `maker_bot_desired_count` to one and apply. Keep exactly one staging
   maker task for this key and verify its CloudWatch authentication log.
9. Attach ACM/DNS, set `certificate_arn` and `rfq_public_hostname`, and apply.
   The staging maker then uses `wss://<rfq_public_hostname>/maker`; it must not
   use TLS against the raw ALB hostname because the certificate does not cover it.
10. Configure the deployed frontend's
   `NEXT_PUBLIC_RFQ_ENGINE_URL_56=https://<staging-host>`.

## RWA rollout

Gold, S&P 500, and NVIDIA are deployed and activated one at a time. SpaceX is
intentionally excluded. Deployment is permanently ordered `XAU -> SPY -> NVDA`
so a retry cannot create a duplicate SRM market.

```bash
# Dry-run locally first.
pnpm deploy:rwa:mainnet-staging --market XAU

# Operator-only broadcast after reviewing the simulation and balances.
pnpm deploy:rwa:mainnet-staging --market XAU --broadcast --confirm

# Verify fresh Hermes data, then seed the disabled market's Pyth adapter.
pnpm bootstrap:rwa:mainnet-staging --market XAU
pnpm bootstrap:rwa:mainnet-staging --market XAU --broadcast --confirm

# Readiness check, then local manifest activation.
pnpm activate:rwa:mainnet-staging --market XAU
pnpm activate:rwa:mainnet-staging --market XAU --confirm
```

The local operator environment must provide `PYTH_API_KEY`. These commands pin
`HERMES_URL=https://pyth.dourolabs.app/hermes`, matching the upgraded chain-56
Pyth contract; legacy Hermes VAAs are rejected. Put the token in the ignored
`services/oracle-feeds/.env.staging.mainnet` file or export it in the shell.
SPY and NVDA additionally require U.S.-equities access on that API key and the
exact feed ID to be available from upgraded Hermes. An HTTP 401/403 is a hard
deployment stop, not a stale-market condition; do not fall back to legacy
Hermes or deploy the market until its dry run succeeds.

The bootstrap step exists because the singleton oracle intentionally publishes
only enabled markets, while activation requires a fresh on-chain source. It
does not publish signed forward/vol/rate feeds and never enables the market.

Commit the new staging sidecar and manifest, publish all service/web images, and
roll oracle, RFQ, maker, then web. Verify `/markets`, complete a tiny RFQ, and
only then repeat for SPY and NVDA. Equity activation can use `--deferred` when
Pyth is outside its publishing window; the market remains runtime-closed until
fresh Pyth and signed feeds arrive.

The staging caps are deliberately small:

- aggregate XAU 0.05, per RFQ 0.01 XAUt;
- aggregate SPY 0.5, per RFQ 0.1 displayed SPYB;
- aggregate NVDA 1.0, per RFQ 0.25 displayed NVDAB.

For scaled bStocks, the protocol cap is set in canonical raw units from the
deployment-time multiplier. The RFQ engine separately enforces the displayed
per-order cap against the live, checkpointed multiplier.

RWA expiries settle from a Pyth benchmark proof for the first valid update in
the five-minute window at/after expiry. This path is not automatic yet: an
operator must obtain the reviewed benchmark update, set `ORACLE_MARKET`, and run
the oracle `settle` command. Do not enable a market without an expiry-day owner
for this procedure.

Raw keys are accepted only for this isolated pre-production staging stack.
Production must use controlled signing infrastructure for executor, oracle,
and maker identities.
