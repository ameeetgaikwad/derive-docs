# Hedge AWS infra (Terraform)

Terraform IaC for the Hedge backend on AWS: ECR repos, a Fargate ECS cluster
running `rfq-engine` (public, behind an ALB) and `oracle-feeds` (daemon), the
GitHub Actions OIDC deploy role, and the IAM task role that lets containers
**sign with KMS using no private keys and no access keys**.

- Account: `985539774899`
- Region: `us-east-1`
- GitHub repo (OIDC): `Sats-Terminal/derive`

> Compatible with Terraform >= 1.5 and OpenTofu >= 1.6. All commands below work
> with either the `terraform` or `tofu` binary.

---

## How KMS signing works (the point of this stack)

The two signing keys already exist and are **never created or modified** here —
they are referenced by alias via `aws_kms_alias` data sources:

- `alias/hedge-feed-signer` — used by `oracle-feeds`
- `alias/hedge-executor` — used by `rfq-engine`

The data sources resolve each alias to its real key ARN. The **`hedge-ecs-task`**
IAM role (the runtime identity the containers assume) gets a policy allowing
**`kms:Sign` + `kms:GetPublicKey` on exactly those two key ARNs and nothing
else**. At runtime the services read `EXECUTOR_KMS_KEY_ID` /
`FEED_SIGNER_KMS_KEY_ID` (the aliases) and sign through the task role's temporary
credentials — no `EXECUTOR_PRIVATE_KEY`, no SSO session, no access keys. This is
what ends the local SSO-session-expiry problem.

---

## What is parameterized (tfvars)

Everything has a sane default; only `rpc_url` really needs supplying for a real
apply. Create `prod.tfvars`:

```hcl
# Required for a real deploy (may embed a provider key -> stored as SSM SecureString)
rpc_url = "https://56.rpc.thirdweb.com/<YOUR_KEY>"

# Optional
image_tag       = "abc1234"                        # CI sets this to the git SHA
certificate_arn = "arn:aws:acm:us-east-1:985539774899:certificate/xxxx" # enables HTTPS/WSS :443
chain_id        = "56"                              # 56 = BNB mainnet, 97 = testnet

# Optional: tighten the OIDC trust to main only
# github_oidc_subject = "repo:Sats-Terminal/derive:ref:refs/heads/main"
```

Other tuning vars (with defaults) live in `variables.tf`: task CPU/memory,
desired counts, `oracle_feeds_command`, `log_retention_days`, KMS aliases.

> **Oracle state gate:** the current Fargate task definition does not yet mount
> durable storage for `ORACLE_STATE_PATH` and `ORACLE_TWAP_STATE_PATH`. Do not
> use this Terraform configuration for public/mainnet trading until an encrypted
> persistent volume, backup/restore procedure, and single-writer failover are
> implemented and rehearsed. The active-expiry index can replay from chain, but
> a lost in-window settlement-TWAP accumulator cannot be reconstructed from the
> container filesystem.

If `certificate_arn` is **not** set, the ALB serves plain HTTP on `:80` (fine for
bring-up and `validate`). Production WSS needs an ACM cert — provision one for
your domain and set `certificate_arn` to add the `:443` HTTPS listener (HTTP then
301-redirects to HTTPS).

---

## Bootstrap order

Applying is **gated on an authenticated AWS session** and is run from the parent
session, not here.

### 0. One-time: create the remote-state S3 bucket (out-of-band)

The S3 backend in `versions.tf` is commented out so `validate` runs offline. The
state bucket must exist before you enable it:

```bash
aws s3api create-bucket --bucket hedge-tfstate-985539774899 --region us-east-1
aws s3api put-bucket-versioning --bucket hedge-tfstate-985539774899 \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket hedge-tfstate-985539774899 \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Then uncomment the `backend "s3"` block in `versions.tf`. It uses S3-native
locking (`use_lockfile = true`) — no DynamoDB table needed (Terraform >= 1.10 /
OpenTofu >= 1.10). For older versions, add a lock table and a `dynamodb_table`
setting instead.

### 1. Init

```bash
cd infra
terraform init            # migrates state to S3 once the backend is enabled
```

### 2. Plan

```bash
terraform plan -var-file=prod.tfvars
```

### 3. Apply

```bash
terraform apply -var-file=prod.tfvars
```

---

## One-time GitHub setup (from Terraform outputs)

After apply, wire GitHub Actions to deploy via OIDC (no keys in GitHub):

```bash
terraform output -raw github_deploy_role_arn
```

Set that as a **GitHub Actions variable** (repo or environment):

- `AWS_DEPLOY_ROLE_ARN` = the `github_deploy_role_arn` output

The CD workflow uses `aws-actions/configure-aws-credentials` with
`role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}` and `permissions: id-token:
write`. Other useful outputs: `ecr_repository_urls`, `ecs_cluster_name`,
`ecs_service_names`, `alb_dns_name`, `ecs_task_role_arn`, `ecs_execution_role_arn`.

Point your domain's DNS (CNAME/ALIAS) at `alb_dns_name`, and issue the ACM cert
for that domain, then set `certificate_arn`.

---

## Offline validation (no AWS credentials/state needed)

```bash
cd infra
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

---

## File layout

| File           | Contents                                                            |
| -------------- | ------------------------------------------------------------------- |
| `versions.tf`  | Terraform + provider version pins; (commented) S3 backend           |
| `variables.tf` | All input variables + defaults                                      |
| `main.tf`      | Provider, shared data sources (caller id, KMS aliases), locals      |
| `network.tf`   | Default VPC/subnet data sources + security groups                   |
| `ecr.tf`       | ECR repos + untagged-expiry lifecycle policy                        |
| `iam.tf`       | ECS task role (KMS sign) + execution role                           |
| `oidc.tf`      | GitHub OIDC provider + deploy role/policy                           |
| `alb.tf`       | ALB, target group, HTTP/HTTPS listeners                             |
| `ecs.tf`       | SSM params, log groups, cluster, task defs, services                |
| `outputs.tf`   | ECR URLs, cluster/service names, role ARNs, ALB DNS, KMS ARNs       |

---

## Networking note (v1)

v1 uses the account **default VPC** and its (public) subnets; Fargate tasks get
public IPs so they can reach ECR / RPC / Deribit without a NAT gateway. A
dedicated VPC with private subnets + NAT and tasks running with
`assign_public_ip = false` is a documented later hardening step.
