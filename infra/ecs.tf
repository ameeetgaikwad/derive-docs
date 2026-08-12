# =============================================================================
# ECS (Fargate) — cluster, SSM config, log groups, task defs, services.
# =============================================================================

# -----------------------------------------------------------------------------
# SSM Parameter Store — non-secret runtime config + the one SecureString.
# Namespaced under /hedge/*.
# -----------------------------------------------------------------------------
resource "aws_ssm_parameter" "chain_id" {
  name  = "/${local.name_prefix}/chain_id"
  type  = "String"
  value = var.chain_id
}

# RPC URL may embed a provider key, so it is a SecureString (encrypted with the
# account's aws/ssm KMS key). Not a signing key — signing is KMS-native.
resource "aws_ssm_parameter" "rpc_url" {
  name  = "/${local.name_prefix}/rpc_url"
  type  = "SecureString"
  value = var.rpc_url
}

# -----------------------------------------------------------------------------
# CloudWatch log groups — one per service.
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "rfq_engine" {
  name              = "/ecs/${local.name_prefix}/rfq-engine"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "oracle_feeds" {
  name              = "/ecs/${local.name_prefix}/oracle-feeds"
  retention_in_days = var.log_retention_days
}

# -----------------------------------------------------------------------------
# Cluster.
# -----------------------------------------------------------------------------
resource "aws_ecs_cluster" "hedge" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "hedge" {
  cluster_name       = aws_ecs_cluster.hedge.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# -----------------------------------------------------------------------------
# rfq-engine — task definition + service (behind the ALB).
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "rfq_engine" {
  family                   = "${local.name_prefix}-rfq-engine"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.rfq_engine_cpu
  memory                   = var.rfq_engine_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "rfq-engine"
      image     = "${local.ecr_registry}/hedge/rfq-engine:${var.image_tag}"
      essential = true

      portMappings = [
        { containerPort = 3030, protocol = "tcp" },
      ]

      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "PORT", value = "3030" },
        # KMS-backed signing — the executor key alias. No private key anywhere.
        { name = "EXECUTOR_KMS_KEY_ID", value = var.executor_kms_alias },
        { name = "EXECUTOR_KMS_REGION", value = var.aws_region },
      ]

      # Non-secret + secure config injected from SSM by the execution role.
      secrets = [
        { name = "CHAIN_ID", valueFrom = aws_ssm_parameter.chain_id.arn },
        { name = "RPC_URL", valueFrom = aws_ssm_parameter.rpc_url.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.rfq_engine.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "rfq-engine"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "rfq_engine" {
  name            = "${local.name_prefix}-rfq-engine"
  cluster         = aws_ecs_cluster.hedge.id
  task_definition = aws_ecs_task_definition.rfq_engine.arn
  desired_count   = var.rfq_engine_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.rfq_engine.id]
    assign_public_ip = true # default (public) subnets, no NAT in v1
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.rfq_engine.arn
    container_name   = "rfq-engine"
    container_port   = 3030
  }

  # CI updates the image via a new task-def revision; ignore desired_count so
  # manual/autoscaling changes are not reverted.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [
    aws_lb_listener.http,
    aws_iam_role_policy_attachment.execution_managed,
  ]
}

# -----------------------------------------------------------------------------
# oracle-feeds — task definition + service (no LB, long-running daemon).
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "oracle_feeds" {
  family                   = "${local.name_prefix}-oracle-feeds"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.oracle_feeds_cpu
  memory                   = var.oracle_feeds_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "oracle-feeds"
      image     = "${local.ecr_registry}/hedge/oracle-feeds:${var.image_tag}"
      essential = true
      command   = var.oracle_feeds_command

      environment = concat(
        [
          { name = "AWS_REGION", value = var.aws_region },
          # KMS-backed feed signer. No private key anywhere.
          { name = "FEED_SIGNER_KMS_KEY_ID", value = var.feed_signer_kms_alias },
          { name = "FEED_SIGNER_KMS_REGION", value = var.aws_region },
        ],
        [
          for market, volatility in var.oracle_rwa_iv :
          { name = "RWA_IV_${market}", value = volatility }
        ],
      )

      secrets = [
        { name = "CHAIN_ID", valueFrom = aws_ssm_parameter.chain_id.arn },
        { name = "RPC_URL", valueFrom = aws_ssm_parameter.rpc_url.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.oracle_feeds.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "oracle-feeds"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "oracle_feeds" {
  name            = "${local.name_prefix}-oracle-feeds"
  cluster         = aws_ecs_cluster.hedge.id
  task_definition = aws_ecs_task_definition.oracle_feeds.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.oracle_feeds.id]
    assign_public_ip = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [
    aws_iam_role_policy_attachment.execution_managed,
  ]
}
