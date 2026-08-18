---
paths:
  - "**/*.tf"
  - "**/*.tfvars"
  - "**/*.tfvars.example"
  - "README.md"
---

# Mainnet-Staging Infrastructure Safety

## State and Deployment Boundary

- Preserve the S3 bucket `hedge-tfstate-985539774899`, key `infra/mainnet-staging/terraform.tfstate`, region `us-east-1`, encryption, and lockfile unless an operator explicitly changes the state boundary.
- Verify the AWS account and region before remote initialization, planning, or applying; this root reuses account-level ECS and IAM resources.
- Apply only a reviewed saved `tfplan`. Inspect additions, replacements, security-group changes, desired counts, and persistent storage impact.
- Keep EFS encryption, backups, separate `/rfq` and `/oracle` access points, and `prevent_destroy` intact unless data migration or deletion is explicitly approved.

## Secrets and Persistent Values

- Never put signer, executor, maker, or Pyth credentials in Terraform variables. Their SSM `SecureString` values are provisioned out of band and referenced by ARN.
- The bootstrap `rpc_url` is the exception: Terraform creates that SecureString, so its initial value enters state. `lifecycle.ignore_changes` preserves later operator rotations.
- Never commit `.tfvars`, state files, `tfplan`, RPC credentials, or private keys. Among local Terraform artifacts, only sanitized `.tfvars.example` files and `.terraform.lock.hcl` belong in Git.
- Raw signing keys are allowed only for this isolated pre-production stack; production requires controlled signing infrastructure.

## Service Counts and Rollout

- All three desired-count variables default to `0` and accept only `0` or `1`.
- Bootstrap with all counts at zero, then enable and verify services in this order: RFQ engine, oracle feeds, maker bot.
- Stop every local chain-56 oracle before enabling the ECS oracle. Only one process may consume the feed-signer nonce stream.
- Keep one maker task per maker key; concurrent quoting sessions can conflict.
- Follow `README.md` for health, log, signer-identity, funding, ACM/DNS, frontend, and RWA checks.

## Network and Image Review

- `certificate_arn = null` leaves the RFQ endpoint on plaintext HTTP/WS. With TLS enabled, the certificate must cover `rfq_public_hostname`; do not use TLS against the raw ALB hostname.
- The task security groups have unrestricted outbound access. Do not describe maker or oracle egress as destination-restricted without changing the security groups.
- `image_tag = "latest"` means a saved Terraform plan does not freeze image contents. Review the external CD deployment and immutable SHA tag used for rollback.
- ECS deployment circuit breakers provide automatic failed-deployment rollback, but no complete manual Terraform or image rollback procedure is documented.
