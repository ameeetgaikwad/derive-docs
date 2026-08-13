variable "aws_region" {
  description = "AWS region containing the existing Hedge ECS cluster and ECR repositories."
  type        = string
  default     = "us-east-1"
}

variable "ecs_cluster_name" {
  description = "Existing ECS cluster used by the testnet services."
  type        = string
  default     = "hedge"
}

variable "ecs_task_role_name" {
  description = "Existing runtime role used by the Hedge ECS containers."
  type        = string
  default     = "hedge-ecs-task"
}

variable "ecs_execution_role_name" {
  description = "Existing ECS execution role with ECR, logs, and /hedge/* SSM access."
  type        = string
  default     = "hedge-ecs-execution"
}

variable "executor_private_key_parameter_name" {
  description = "Existing SSM SecureString containing the staging trade-executor private key. Terraform references its ARN but never reads its value."
  type        = string
  default     = "/hedge/mainnet-staging/executor_private_key"

  validation {
    condition     = startswith(var.executor_private_key_parameter_name, "/hedge/mainnet-staging/")
    error_message = "executor_private_key_parameter_name must stay under /hedge/mainnet-staging/."
  }
}

variable "feed_signer_key_parameter_name" {
  description = "Existing SSM SecureString containing the staging oracle feed-signer private key. Terraform references its ARN but never reads its value."
  type        = string
  default     = "/hedge/mainnet-staging/feed_signer_key"

  validation {
    condition     = startswith(var.feed_signer_key_parameter_name, "/hedge/mainnet-staging/")
    error_message = "feed_signer_key_parameter_name must stay under /hedge/mainnet-staging/."
  }
}

variable "maker_private_key_parameter_name" {
  description = "Existing SSM SecureString containing the staging maker private key. Terraform references its ARN but never reads its value."
  type        = string
  default     = "/hedge/maker_private_key"

  validation {
    condition     = startswith(var.maker_private_key_parameter_name, "/hedge/")
    error_message = "maker_private_key_parameter_name must stay under /hedge/."
  }
}

variable "maker_subaccount_id" {
  description = "Existing chain-56 maker subaccount owned by the allowlisted maker EOA."
  type        = string
  default     = "4"

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.maker_subaccount_id))
    error_message = "maker_subaccount_id must be a positive integer string."
  }
}

variable "rpc_url" {
  description = "Private BNB mainnet JSON-RPC URL, stored in SSM as a SecureString."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^https://", var.rpc_url))
    error_message = "rpc_url must be an HTTPS URL."
  }
}

variable "certificate_arn" {
  description = "Validated us-east-1 ACM certificate for the public RFQ HTTPS/WSS listener."
  type        = string
  default     = null
  nullable    = true
}

variable "maker_allowlist" {
  description = "Maker EOAs allowed to quote; public takers remain enabled."
  type        = list(string)

  validation {
    condition = length(var.maker_allowlist) > 0 && alltrue([
      for address in var.maker_allowlist : can(regex("^0x[0-9a-fA-F]{40}$", address))
    ])
    error_message = "maker_allowlist must contain at least one EVM address."
  }
}

variable "image_tag" {
  description = "Service image tag. Keep latest so the existing CD force-deployment flow updates this stack."
  type        = string
  default     = "latest"
}

variable "rfq_engine_cpu" {
  type    = string
  default = "512"
}

variable "rfq_engine_memory" {
  type    = string
  default = "1024"
}

variable "oracle_feeds_cpu" {
  type    = string
  default = "256"
}

variable "oracle_feeds_memory" {
  type    = string
  default = "512"
}

variable "oracle_discovery_from_block" {
  description = "Chain-56 block where the staging SubAccounts contract was deployed; avoids historical-state discovery on pruned RPCs."
  type        = string
  default     = "115316790"

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.oracle_discovery_from_block))
    error_message = "oracle_discovery_from_block must be a positive integer block number."
  }
}

variable "maker_bot_cpu" {
  type    = string
  default = "256"
}

variable "maker_bot_memory" {
  type    = string
  default = "512"
}

variable "rfq_engine_desired_count" {
  description = "Start at zero; set to one after publishing and verifying the image."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1], var.rfq_engine_desired_count)
    error_message = "rfq_engine_desired_count must be 0 or 1."
  }
}

variable "oracle_feeds_desired_count" {
  description = "Start at zero; keep at one maximum because the oracle is a single writer."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1], var.oracle_feeds_desired_count)
    error_message = "oracle_feeds_desired_count must be 0 or 1."
  }
}

variable "maker_bot_desired_count" {
  description = "Start at zero; keep at one maximum because one maker key may have only one active quoting session."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1], var.maker_bot_desired_count)
    error_message = "maker_bot_desired_count must be 0 or 1."
  }
}

variable "log_retention_days" {
  type    = number
  default = 30
}
