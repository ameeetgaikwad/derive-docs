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
  description = "Existing runtime role with permission to use the Hedge KMS signing aliases."
  type        = string
  default     = "hedge-ecs-task"
}

variable "ecs_execution_role_name" {
  description = "Existing ECS execution role with ECR, logs, and /hedge/* SSM access."
  type        = string
  default     = "hedge-ecs-execution"
}

variable "feed_signer_kms_alias" {
  description = "KMS alias whose EVM address must match the deployed mainnet-staging feed signer."
  type        = string
  default     = "alias/hedge-feed-signer"
}

variable "executor_kms_alias" {
  description = "KMS alias whose EVM address must match the deployed mainnet-staging trade executor."
  type        = string
  default     = "alias/hedge-executor"
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

variable "log_retention_days" {
  type    = number
  default = 30
}
