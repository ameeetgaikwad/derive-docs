resource "aws_ssm_parameter" "chain_id" {
  name  = "/hedge/mainnet-staging/chain_id"
  type  = "String"
  value = "56"
}

resource "aws_ssm_parameter" "rpc_url" {
  name  = "/hedge/mainnet-staging/rpc_url"
  type  = "SecureString"
  value = var.rpc_url

  # Operators rotate/correct the staging RPC directly in SSM. Do not replace a
  # working endpoint with the bootstrap value from an ignored local tfvars file.
  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_cloudwatch_log_group" "rfq_engine" {
  name              = "/ecs/${local.name_prefix}/rfq-engine"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "oracle_feeds" {
  name              = "/ecs/${local.name_prefix}/oracle-feeds"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "maker_bot" {
  name              = "/ecs/${local.name_prefix}/maker-bot"
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
        { name = "HOST", value = "0.0.0.0" },
        { name = "PORT", value = "3030" },
        { name = "SATS_DEPLOYMENTS_DIR", value = "/app/protocol/deployments/staging" },
        { name = "HEDGE_MARKETS_DIR", value = "/app/protocol/deployments/staging/markets" },
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
        { name = "EXECUTOR_PRIVATE_KEY", valueFrom = local.executor_private_key_parameter_arn },
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
        { name = "ORACLE_STATE_PATH", value = "/var/lib/hedge/active-expiries.json" },
        { name = "ORACLE_TWAP_STATE_PATH", value = "/var/lib/hedge/settlement-twap.json" },
        { name = "ORACLE_DISCOVERY_FROM_BLOCK", value = var.oracle_discovery_from_block },
        { name = "STABLE_PRICE_SOURCE", value = "chainlink" },
        { name = "STABLE_CHAINLINK_AGGREGATOR", value = "0xB97Ad0E74fa7d920791E90258A6E2085088b4320" },
        { name = "STABLE_FEED_INTERVAL_SEC", value = "300" },
        { name = "STABLE_CHAINLINK_MAX_STALE_SEC", value = "3600" },
      ]

      secrets = [
        { name = "CHAIN_ID", valueFrom = aws_ssm_parameter.chain_id.arn },
        { name = "RPC_URL", valueFrom = aws_ssm_parameter.rpc_url.arn },
        { name = "FEED_SIGNER_KEY", valueFrom = local.feed_signer_key_parameter_arn },
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

resource "aws_ecs_task_definition" "maker_bot" {
  family                   = "${local.name_prefix}-maker-bot"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.maker_bot_cpu
  memory                   = var.maker_bot_memory
  execution_role_arn       = data.aws_iam_role.execution.arn
  task_role_arn            = data.aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "maker-bot"
      image     = "${local.ecr_registry}/hedge/maker-bot:${var.image_tag}"
      essential = true

      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "SATS_DEPLOYMENTS_DIR", value = "/app/protocol/deployments/staging" },
        { name = "HEDGE_MARKETS_DIR", value = "/app/protocol/deployments/staging/markets" },
        { name = "RFQ_ENGINE_WS", value = "${local.rfq_engine_ws_scheme}://${aws_lb.rfq_engine.dns_name}/maker" },
        { name = "MAKER_SUBACCOUNT_ID", value = var.maker_subaccount_id },
        { name = "MAKER_BID_RATIO", value = "0.95" },
        { name = "MAKER_ASK_RATIO", value = "1.05" },
        { name = "MAKER_MAX_FEE", value = "0" },
        { name = "QUOTE_TTL_SEC", value = "120" },
        { name = "DERIBIT_VOL", value = "true" },
      ]

      secrets = [
        { name = "CHAIN_ID", valueFrom = aws_ssm_parameter.chain_id.arn },
        { name = "RPC_URL", valueFrom = aws_ssm_parameter.rpc_url.arn },
        { name = "PRIVATE_KEY", valueFrom = local.maker_private_key_parameter_arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.maker_bot.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "maker-bot"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "maker_bot" {
  name             = "${local.name_prefix}-maker-bot"
  cluster          = data.aws_ecs_cluster.hedge.arn
  task_definition  = aws_ecs_task_definition.maker_bot.arn
  desired_count    = var.maker_bot_desired_count
  launch_type      = "FARGATE"
  platform_version = "1.4.0"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.maker_bot.id]
    assign_public_ip = true
  }

  depends_on = [aws_lb_listener.http]
}
