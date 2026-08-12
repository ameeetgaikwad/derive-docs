resource "aws_ssm_parameter" "chain_id" {
  name  = "/hedge/mainnet-staging/chain_id"
  type  = "String"
  value = "56"
}

resource "aws_ssm_parameter" "rpc_url" {
  name  = "/hedge/mainnet-staging/rpc_url"
  type  = "SecureString"
  value = var.rpc_url
}

resource "aws_cloudwatch_log_group" "rfq_engine" {
  name              = "/ecs/${local.name_prefix}/rfq-engine"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "oracle_feeds" {
  name              = "/ecs/${local.name_prefix}/oracle-feeds"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_task_definition" "rfq_engine" {
  family                   = "${local.name_prefix}-rfq-engine"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.rfq_engine_cpu
  memory                   = var.rfq_engine_memory
  execution_role_arn       = data.aws_iam_role.execution.arn
  task_role_arn            = data.aws_iam_role.task.arn

  volume {
    name = "state"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.state.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.rfq.id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "rfq-engine"
      image     = "${local.ecr_registry}/hedge/rfq-engine:${var.image_tag}"
      essential = true

      portMappings = [
        { containerPort = 3030, protocol = "tcp" },
      ]

      mountPoints = [
        { sourceVolume = "state", containerPath = "/var/lib/hedge", readOnly = false },
      ]

      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "PORT", value = "3030" },
        { name = "SATS_DEPLOYMENTS_DIR", value = "/app/protocol/deployments/staging" },
        { name = "HEDGE_MARKETS_DIR", value = "/app/protocol/deployments/staging/markets" },
        { name = "EXECUTOR_KMS_KEY_ID", value = var.executor_kms_alias },
        { name = "EXECUTOR_KMS_REGION", value = var.aws_region },
        { name = "TAKER_OPEN", value = "true" },
        { name = "MAKER_ALLOWLIST", value = join(",", var.maker_allowlist) },
        { name = "RFQ_RATE_LIMIT_PER_MIN", value = "5" },
        { name = "TRUST_PROXY", value = "true" },
        { name = "AUCTION_WINDOW_MS", value = "3000" },
        { name = "TAKER_ACCEPT_DEADLINE_MS", value = "120000" },
        { name = "STORE_PATH", value = "/var/lib/hedge/rfq.jsonl" },
      ]

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
  name                              = "${local.name_prefix}-rfq-engine"
  cluster                           = data.aws_ecs_cluster.hedge.arn
  task_definition                   = aws_ecs_task_definition.rfq_engine.arn
  desired_count                     = var.rfq_engine_desired_count
  launch_type                       = "FARGATE"
  platform_version                  = "1.4.0"
  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.rfq_engine.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.rfq_engine.arn
    container_name   = "rfq-engine"
    container_port   = 3030
  }

  depends_on = [
    aws_lb_listener.http,
    aws_efs_mount_target.state,
  ]
}

resource "aws_ecs_task_definition" "oracle_feeds" {
  family                   = "${local.name_prefix}-oracle-feeds"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.oracle_feeds_cpu
  memory                   = var.oracle_feeds_memory
  execution_role_arn       = data.aws_iam_role.execution.arn
  task_role_arn            = data.aws_iam_role.task.arn

  volume {
    name = "state"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.state.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.oracle.id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "oracle-feeds"
      image     = "${local.ecr_registry}/hedge/oracle-feeds:${var.image_tag}"
      essential = true
      command   = ["daemon", "--source", "deribit", "--interval", "30", "--feed-interval", "120"]

      mountPoints = [
        { sourceVolume = "state", containerPath = "/var/lib/hedge", readOnly = false },
      ]

      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "SATS_DEPLOYMENTS_DIR", value = "/app/protocol/deployments/staging" },
        { name = "HEDGE_MARKETS_DIR", value = "/app/protocol/deployments/staging/markets" },
        { name = "FEED_SIGNER_KMS_KEY_ID", value = var.feed_signer_kms_alias },
        { name = "FEED_SIGNER_KMS_REGION", value = var.aws_region },
        { name = "ORACLE_STATE_PATH", value = "/var/lib/hedge/active-expiries.json" },
        { name = "ORACLE_TWAP_STATE_PATH", value = "/var/lib/hedge/settlement-twap.json" },
      ]

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
  name             = "${local.name_prefix}-oracle-feeds"
  cluster          = data.aws_ecs_cluster.hedge.arn
  task_definition  = aws_ecs_task_definition.oracle_feeds.arn
  desired_count    = var.oracle_feeds_desired_count
  launch_type      = "FARGATE"
  platform_version = "1.4.0"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.oracle_feeds.id]
    assign_public_ip = true
  }

  depends_on = [aws_efs_mount_target.state]
}
