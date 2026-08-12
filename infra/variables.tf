variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID (used to construct ECR image URIs and scope ARNs)."
  type        = string
  default     = "985539774899"
}

variable "project" {
  description = "Project/name prefix applied to resources and tags."
  type        = string
  default     = "hedge"
}

variable "environment" {
  description = "Deployment environment name (used in tags)."
  type        = string
  default     = "prod"
}

# -----------------------------------------------------------------------------
# GitHub OIDC — the repo allowed to assume the deploy role.
# -----------------------------------------------------------------------------
variable "github_org" {
  description = "GitHub org/owner for OIDC trust."
  type        = string
  default     = "Sats-Terminal"
}

variable "github_repo" {
  description = "GitHub repo name for OIDC trust."
  type        = string
  default     = "derive"
}

variable "github_oidc_subject" {
  description = <<-EOT
    The `sub` claim pattern the deploy role trusts. Defaults to any ref on the
    repo (`repo:<org>/<repo>:*`). To restrict to the main branch, set to
    `repo:<org>/<repo>:ref:refs/heads/main`, or to a GitHub Environment use
    `repo:<org>/<repo>:environment:prod`.
  EOT
  type        = string
  default     = null # computed from github_org/github_repo when null (see oidc.tf)
}

# -----------------------------------------------------------------------------
# KMS — the two pre-existing keys. Referenced by alias, never recreated.
# -----------------------------------------------------------------------------
variable "feed_signer_kms_alias" {
  description = "Alias of the pre-existing oracle feed-signer KMS key."
  type        = string
  default     = "alias/hedge-feed-signer"
}

variable "executor_kms_alias" {
  description = "Alias of the pre-existing rfq-engine executor KMS key."
  type        = string
  default     = "alias/hedge-executor"
}

# -----------------------------------------------------------------------------
# Chain / runtime config (non-secret goes to SSM as String).
# -----------------------------------------------------------------------------
variable "chain_id" {
  description = "EVM chain id the services target (e.g. 56 for BNB mainnet, 97 for testnet)."
  type        = string
  default     = "56"
}

variable "rpc_url" {
  description = <<-EOT
    JSON-RPC endpoint URL for the services. Stored in SSM as a SecureString
    because it may embed a provider API key (e.g. a thirdweb RPC URL). This is
    the only "secret" — signing itself uses KMS, no private keys anywhere.
    Leave as the placeholder for `validate`; supply the real value at apply time
    via -var / *.tfvars.
  EOT
  type        = string
  default     = "https://bsc-dataseed.binance.org"
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Container images.
# -----------------------------------------------------------------------------
variable "image_tag" {
  description = "Image tag to deploy for every service (CI sets this to the git SHA)."
  type        = string
  default     = "latest"
}

# -----------------------------------------------------------------------------
# ALB / TLS.
# -----------------------------------------------------------------------------
variable "certificate_arn" {
  description = <<-EOT
    ACM certificate ARN for the rfq-engine HTTPS/WSS listener. When null the
    ALB serves plain HTTP on :80 only (fine for `validate` and bring-up; TLS is
    required for production wss). Provision an ACM cert for your domain and set
    this to enable the :443 HTTPS listener.
  EOT
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Fargate task sizing / scaling.
# -----------------------------------------------------------------------------
variable "rfq_engine_cpu" {
  description = "Fargate CPU units for rfq-engine task."
  type        = string
  default     = "512"
}

variable "rfq_engine_memory" {
  description = "Fargate memory (MiB) for rfq-engine task."
  type        = string
  default     = "1024"
}

variable "rfq_engine_desired_count" {
  description = "Desired running count for rfq-engine."
  type        = number
  default     = 1
}

variable "oracle_feeds_cpu" {
  description = "Fargate CPU units for oracle-feeds task."
  type        = string
  default     = "256"
}

variable "oracle_feeds_memory" {
  description = "Fargate memory (MiB) for oracle-feeds task."
  type        = string
  default     = "512"
}

variable "oracle_feeds_command" {
  description = "Container command (argv) for the oracle-feeds daemon."
  type        = list(string)
  default     = ["daemon", "--source", "deribit"]
}

variable "oracle_rwa_iv" {
  description = "Reviewed flat reference volatilities used until enough RWA closes are configured."
  type        = map(string)
  default = {
    XAU  = "0.20"
    SPY  = "0.25"
    NVDA = "0.50"
  }

  validation {
    condition = alltrue([
      for market, value in var.oracle_rwa_iv :
      contains(["XAU", "SPY", "NVDA"], market) && try(tonumber(value) > 0, false)
    ])
    error_message = "oracle_rwa_iv may contain only positive XAU, SPY, and NVDA values."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention in days for service log groups."
  type        = number
  default     = 30
}
