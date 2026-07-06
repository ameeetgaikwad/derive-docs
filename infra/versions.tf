terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote state (S3 backend).
  #
  # This block is commented out so `terraform validate` works offline without a
  # real backend. Before the first real `apply`, the state bucket must exist
  # (create it once out-of-band or via a bootstrap — see infra/README.md), then
  # uncomment this block and run `terraform init` to migrate state.
  #
  # Backend blocks cannot use variables/interpolation, so the values are
  # hard-literals here. Keep them in sync with the documented defaults.
  # ---------------------------------------------------------------------------
  # backend "s3" {
  #   bucket       = "hedge-tfstate-985539774899"
  #   key          = "infra/prod/terraform.tfstate"
  #   region       = "us-east-1"
  #   encrypt      = true
  #   use_lockfile = true # S3-native state locking (Terraform >= 1.10 / OpenTofu >= 1.10)
  # }
}
