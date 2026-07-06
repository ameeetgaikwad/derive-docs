# GitHub Actions workflows

CI/CD for the Hedge Turborepo monorepo (`Sats-Terminal/derive`).

## Workflows

| File | Trigger | Purpose |
|------|---------|---------|
| `ci.yml` | `pull_request`; `push` to `main` and `prod/**` | Lint / test / build / typecheck the JS monorepo via Turborepo, and `forge build` + `forge test` for the Foundry contracts. |
| `cd.yml` | `push` to `main`; manual `workflow_dispatch` | Build service Docker images, push to ECR, and roll ECS services via GitHub OIDC (no long-lived AWS keys). |

### `ci.yml`

- **`js` job** — `pnpm/action-setup@v4` (pnpm version comes from the root
  `package.json` `packageManager` field) + `actions/setup-node@v4` (Node 22, pnpm
  cache) → `pnpm install --frozen-lockfile` → `pnpm turbo lint test build typecheck`.
  Turbo only runs a task for packages that define it, so services without a
  `lint`/`typecheck` script are skipped. ESLint fails on **errors** only; the one
  known `<img>` warning in `apps/web` does **not** fail the build.
  A commented `TURBO_TOKEN` / `TURBO_TEAM` hook is left in place for optional
  Turbo remote caching.
- **`contracts` job** — installs Foundry (`foundry-rs/foundry-toolchain@v1`), then
  runs `protocol/setup-vendor.sh` to restore the vendored Derive v2 repos at their
  license-pinned commits (`protocol/lib` is **gitignored** and there are no committed
  submodules), then `forge build` + `forge test` in `protocol/`.

### `cd.yml`

- Authenticates to AWS with **GitHub OIDC**: `permissions: id-token: write` +
  `aws-actions/configure-aws-credentials@v4` assuming `vars.AWS_DEPLOY_ROLE_ARN`.
  No static AWS access keys are stored in GitHub.
- **Guard:** if `vars.AWS_DEPLOY_ROLE_ARN` is unset, the workflow logs a notice and
  skips the deploy job — it will not fail before the AWS infra exists.
- **Matrix:** builds `rfq-engine` and `oracle-feeds` by default on push to `main`.
  `workflow_dispatch` accepts a `services` input (comma-separated) to pick which
  services to deploy — including `maker-bot`, which is otherwise manual-only.
- For each service: `docker build -f services/<svc>/Dockerfile -t <ecr>/hedge/<svc>:<sha> .`
  (build context = repo root), push both `:<sha>` and `:latest` to ECR, then
  `aws ecs update-service --cluster hedge --service hedge-<svc> --force-new-deployment`.
  The ECS **task definition should reference the `:latest` tag**; `--force-new-deployment`
  makes ECS re-pull it. `:<sha>` is pushed alongside for auditability / rollback.

## Required GitHub repo configuration

Set these under **Settings → Secrets and variables → Actions**.

### Variables (`vars.*`) — non-secret

| Variable | Value | Used by | Notes |
|----------|-------|---------|-------|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::985539774899:role/<oidc-deploy-role>` | `cd.yml` | OIDC role GitHub assumes. **Unset = CD skips (no-op).** |
| `AWS_ACCOUNT_ID` | `985539774899` | `cd.yml` | Available to steps if needed. |
| `AWS_REGION` | `us-east-1` | `cd.yml` | Region for AWS CLI / ECR / ECS. |
| `TURBO_TEAM` | *(optional)* | `ci.yml` | Only if enabling Turbo remote cache (commented out by default). |

### Secrets (`secrets.*`)

| Secret | Used by | Notes |
|--------|---------|-------|
| `TURBO_TOKEN` | `ci.yml` | *(optional)* Turbo remote cache token. Commented out by default. |

No AWS access-key secrets are required — CD uses OIDC.

## AWS resource naming (account `985539774899`, region `us-east-1`)

| Resource | Name / pattern |
|----------|----------------|
| ECS cluster | `hedge` |
| ECS service (rfq-engine) | `hedge-rfq-engine` |
| ECS service (oracle-feeds) | `hedge-oracle-feeds` |
| ECS service (maker-bot, optional) | `hedge-maker-bot` |
| ECR repository | `hedge/<svc>` (e.g. `hedge/rfq-engine`, `hedge/oracle-feeds`) |
| Full image URI | `985539774899.dkr.ecr.us-east-1.amazonaws.com/hedge/<svc>:{<sha>,latest}` |

### OIDC trust prerequisites (provisioned in `infra/` Terraform, not here)

- A GitHub OIDC identity provider in the AWS account
  (`token.actions.githubusercontent.com`).
- An IAM role whose trust policy allows `Sats-Terminal/derive` to assume it via
  `sts:AssumeRoleWithWebIdentity`, with permissions for `ecr:*` (push) and
  `ecs:UpdateService` / `ecs:DescribeServices` on the `hedge` cluster.
- The ECR repositories and ECS cluster/services must exist before CD runs
  (until then, leave `AWS_DEPLOY_ROLE_ARN` unset so CD stays a no-op).
