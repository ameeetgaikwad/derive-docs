# Project: Derive Mainnet-Staging Infrastructure

**Last Updated:** 2026-08-17

## Scope

- This directory is the standalone Terraform root for the BNB Chain (chain 56) mainnet-staging runtime.
- It reads the existing `hedge` ECS cluster, task roles, default VPC, subnets, and AWS account as data sources.
- It creates isolated RFQ, oracle, and maker Fargate services plus their ALB, security groups, SSM parameters, CloudWatch logs, and EFS state.
- Runtime source and tests remain in the monorepo's `services/` packages; this root contains no Terraform modules or test suite.

## Technology

- **Terraform:** Use 1.10 or newer because the active S3 backend uses native `use_lockfile`. `versions.tf` currently declares the stale lower bound `>= 1.5.0`.
- **AWS provider:** Constraint `~> 5.60`; `.terraform.lock.hcl` currently resolves `5.100.0`.
- **AWS services:** ECS/Fargate, ALB, EFS, SSM Parameter Store, CloudWatch Logs, IAM data sources, and the default VPC.

## File Responsibilities

| File | Responsibility |
|------|----------------|
| `versions.tf` | Terraform/provider requirements and the isolated S3 backend |
| `main.tf` | Provider, shared data sources, naming, and derived ARNs/URLs |
| `network.tf` | Security groups, RFQ ALB, target group, and listeners |
| `storage.tf` | Encrypted, backed-up EFS and access points |
| `ecs.tf` | SSM, logs, task definitions, and ECS services |
| `variables.tf` / `outputs.tf` | Inputs, validation, and exported values |
| `mainnet-staging.tfvars.example` | Sanitized bootstrap configuration |
| `README.md` | Authoritative rollout and operator checks |

## Development Commands

Run from `infra/mainnet-staging`:

```bash
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
```

For an authoritative plan, first verify the AWS account, region, and remote backend, then run:

```bash
terraform init
terraform plan -var-file=mainnet-staging.tfvars -out=tfplan
terraform show tfplan
```

- The S3 backend is already active in `versions.tf`; do not instruct operators to uncomment or enable it.
- `terraform apply tfplan` is a deployment action. Run it only after explicit authorization and review of the saved plan.

## Conventions

- Use `terraform fmt`; use `snake_case` for Terraform labels and `${local.name_prefix}` plus kebab-case for AWS names.
- Keep each resource in the file matching its concern.
- Give every new or changed input a description, concrete type, and validation when invalid values can be rejected locally.
- Document lifecycle rules whose removal could destroy or overwrite persistent state.

## Documentation Sync

- Update `mainnet-staging.tfvars.example` and `README.md` when inputs, secrets, listeners, desired counts, or rollout behavior change.
- Follow `README.md` for sequential service and RWA rollout; do not duplicate its volatile operator details in always-loaded rules.
- Check related monorepo documentation when service image behavior, deployment manifests, or frontend endpoints change.
