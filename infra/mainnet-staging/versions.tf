terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Use a state key separate from the existing Hedge stack. Verify/create the
  # bucket, uncomment, and run `terraform init -migrate-state` before the first apply.
  backend "s3" {
    bucket       = "hedge-tfstate-985539774899"
    key          = "infra/mainnet-staging/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
