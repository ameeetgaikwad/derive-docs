# Production monorepo layout

The repository is a Turborepo/pnpm monorepo. The web application, backend
services, contracts, documentation, CI/CD, and AWS infrastructure are kept in
one reviewable tree:

```text
/
  package.json               # root scripts delegate to Turbo
  pnpm-workspace.yaml        # apps/*, services/*, docs-site
  turbo.json                 # build, lint, test, typecheck and dev task graph
  apps/web/                  # Next.js frontend; supports BSC 56 and 97
  services/
    shared/                  # ABIs, protocol encoding, clients and KMS signing
    rfq-engine/              # public REST/WS RFQ engine and executor
    oracle-feeds/            # signed/Pyth feed daemon and settlement runner
    maker-bot/               # standalone reference MM artifact
    e2e/                     # local Anvil acceptance harness
  protocol/                  # Foundry workspace and deployment address books
  docs-site/                 # Mintlify documentation workspace
  .github/workflows/         # Turborepo/Foundry CI and AWS OIDC CD
  infra/                     # Terraform for ECR, ECS, ALB, SSM, IAM and OIDC
```

The deployable platform services are `rfq-engine` and `oracle-feeds`. Terraform
creates their ECS services and KMS-scoped runtime identity; GitHub Actions builds
their images from the repository root and rolls those services through OIDC.
`maker-bot` has a root-context Docker image for market-maker operators, but it is
not an ECS service managed by `infra/`.

Signing uses the existing `alias/hedge-feed-signer` and
`alias/hedge-executor` KMS keys via `FEED_SIGNER_KMS_KEY_ID` and
`EXECUTOR_KMS_KEY_ID`. No session keys or raw private keys belong in images,
Terraform variables, GitHub configuration, or frontend environment variables.

## Validation

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm turbo lint test build typecheck

(cd protocol && ./setup-vendor.sh)
(cd protocol/lib/v2-core && forge build)
(cd protocol/lib/v2-matching && forge build)
(cd protocol && forge fmt --check src script test && forge build && forge test -vvv)

docker build -f services/rfq-engine/Dockerfile -t hedge-rfq-engine:review .
docker build -f services/oracle-feeds/Dockerfile -t hedge-oracle-feeds:review .
docker build -f services/maker-bot/Dockerfile -t hedge-maker-bot:review .
```

Terraform apply is deliberately credential-gated. See `infra/README.md` for
bootstrap and offline validation, and `.github/workflows/README.md` for CI/CD
triggers and required repository variables.
