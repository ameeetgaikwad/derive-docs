provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# -----------------------------------------------------------------------------
# Shared data sources & locals.
# -----------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# The two pre-existing KMS keys. We resolve the alias -> target key ARN so the
# task role can be scoped to exactly these two key ARNs (never a wildcard).
# These keys are NEVER created or modified by this configuration.
data "aws_kms_alias" "feed_signer" {
  name = var.feed_signer_kms_alias
}

data "aws_kms_alias" "executor" {
  name = var.executor_kms_alias
}

locals {
  name_prefix = var.project # e.g. "hedge"
  account_id  = var.aws_account_id

  ecr_registry = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"

  # The two Hedge signing keys, resolved to their real key ARNs.
  hedge_kms_key_arns = [
    data.aws_kms_alias.feed_signer.target_key_arn,
    data.aws_kms_alias.executor.target_key_arn,
  ]

  # GitHub OIDC subject: explicit override, else any ref on the repo.
  github_oidc_subject = coalesce(
    var.github_oidc_subject,
    "repo:${var.github_org}/${var.github_repo}:*",
  )

  services = ["rfq-engine", "oracle-feeds", "maker-bot"]
}
