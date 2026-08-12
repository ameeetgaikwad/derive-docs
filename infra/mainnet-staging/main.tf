provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "hedge"
      Environment = "mainnet-staging"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ecs_cluster" "hedge" {
  cluster_name = var.ecs_cluster_name
}

data "aws_iam_role" "task" {
  name = var.ecs_task_role_name
}

data "aws_iam_role" "execution" {
  name = var.ecs_execution_role_name
}

locals {
  name_prefix                        = "hedge-mainnet-staging"
  ecr_registry                       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
  executor_private_key_parameter_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.executor_private_key_parameter_name}"
  feed_signer_key_parameter_arn      = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.feed_signer_key_parameter_name}"
}
