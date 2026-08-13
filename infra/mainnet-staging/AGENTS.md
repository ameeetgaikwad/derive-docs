# Repository Guidelines

## Project Structure & Module Organization

This directory is a standalone Terraform root for the BNB Chain (chain 56) mainnet-staging ECS stack. `versions.tf` pins Terraform/AWS requirements and the isolated S3 state key. `main.tf` holds provider configuration, shared data sources, and locals. Resources are grouped by concern: networking and the RFQ ALB in `network.tf`, encrypted EFS in `storage.tf`, and SSM, CloudWatch, and Fargate services in `ecs.tf`. Inputs and exported values belong in `variables.tf` and `outputs.tf`. Keep `mainnet-staging.tfvars.example` and the rollout instructions in `README.md` synchronized with configuration changes. Runtime source and tests live in the monorepo's `services/` packages; this root has no modules, assets, or test directory.

## Build, Test, and Development Commands

Run these from `infra/mainnet-staging`:

```bash
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform plan -var-file=mainnet-staging.tfvars -out=tfplan
terraform show tfplan
```

The first command initializes providers without contacting remote state for local validation. Operators should run `terraform init` with the verified S3 backend before producing an authoritative plan. Apply only a reviewed saved plan with `terraform apply tfplan`; applying is a deployment action, not a development check.

## Coding Style & Naming Conventions

Use `terraform fmt` as the source of truth (standard two-space HCL indentation). Use `snake_case` for Terraform labels, variables, and locals, and `${local.name_prefix}` plus kebab-case for AWS names. Add descriptions, concrete types, and validation blocks to inputs. Keep resources in the file matching their concern and document safety-sensitive lifecycle choices.

## Testing Guidelines

There is no stack-specific test framework or coverage target. Every change must pass formatting and `terraform validate`, then receive plan review. Inspect additions, replacements, security-group changes, and desired counts; initial rollouts keep all counts at zero. After deployment, follow `README.md` for sequential RFQ, oracle, and maker health/log checks.

## Commit & Pull Request Guidelines

History uses concise Conventional Commit-style subjects, for example `feat(infra): add isolated mainnet staging ECS stack`. Use an imperative subject and an optional scope. PRs should describe affected resources, state/blast-radius impact, sanitized plan results, rollout and rollback steps, and verification evidence; link the relevant issue when one exists.

## Security & Configuration

Never commit `.tfvars`, state files, `tfplan`, RPC credentials, or private keys. Copy the example tfvars locally and keep signer, executor, maker, and Pyth credentials in out-of-band SSM `SecureString` parameters. Preserve the dedicated backend key and singleton oracle/maker limits; raw signing keys are staging-only.
