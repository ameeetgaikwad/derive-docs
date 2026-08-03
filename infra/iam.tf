# =============================================================================
# IAM
#
# Three identities:
#   1. ecs_task_role      — the runtime identity the CONTAINERS assume. It is the
#                           ONLY thing that can call kms:Sign / kms:GetPublicKey,
#                           and ONLY on the two Hedge key ARNs. This is what lets
#                           the services sign on-chain payloads with NO private
#                           keys and NO access keys anywhere (ends the local
#                           SSO-session-expiry problem).
#   2. ecs_execution_role — used by the ECS agent to pull images from ECR and
#                           ship logs to CloudWatch (AmazonECSTaskExecutionRole).
#   3. github_deploy_role — assumed by GitHub Actions via OIDC to push images and
#                           roll ECS services. Defined in oidc.tf.
# =============================================================================

# -----------------------------------------------------------------------------
# 1. ECS task role (container runtime identity) + KMS signing policy.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  description        = "Runtime identity for Hedge containers; can KMS-sign with the two Hedge keys only"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# The whole point: allow signing ONLY with the two Hedge keys, nothing else.
data "aws_iam_policy_document" "kms_sign" {
  statement {
    sid    = "HedgeKmsSign"
    effect = "Allow"
    actions = [
      "kms:Sign",
      "kms:GetPublicKey",
    ]
    resources = local.hedge_kms_key_arns
  }
}

resource "aws_iam_policy" "kms_sign" {
  name        = "${local.name_prefix}-kms-sign"
  description = "kms:Sign + kms:GetPublicKey on the Hedge feed-signer and executor keys only"
  policy      = data.aws_iam_policy_document.kms_sign.json
}

resource "aws_iam_role_policy_attachment" "task_kms_sign" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.kms_sign.arn
}

# Let tasks read their SSM parameters at runtime (rpc_url SecureString etc.).
# The KMS decrypt here is for the SSM SecureString aws/ssm key — distinct from
# the signing keys above.
data "aws_iam_policy_document" "task_ssm_read" {
  statement {
    sid    = "ReadHedgeSsmParams"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/${local.name_prefix}/*",
    ]
  }
}

resource "aws_iam_policy" "task_ssm_read" {
  name        = "${local.name_prefix}-task-ssm-read"
  description = "Read Hedge SSM parameters at runtime"
  policy      = data.aws_iam_policy_document.task_ssm_read.json
}

resource "aws_iam_role_policy_attachment" "task_ssm_read" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.task_ssm_read.arn
}

# -----------------------------------------------------------------------------
# 2. ECS execution role — ECR pull + CloudWatch logs, plus SSM decrypt so the
#    agent can inject SecureString params into the container as env at launch.
# -----------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name_prefix}-ecs-execution"
  description        = "ECS agent role: pull images from ECR, write logs, read SSM secrets for env injection"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow the execution role to resolve SSM `secrets` referenced in task defs.
data "aws_iam_policy_document" "execution_ssm" {
  statement {
    sid    = "ReadHedgeSsmParamsForEnv"
    effect = "Allow"
    actions = [
      "ssm:GetParameters",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/${local.name_prefix}/*",
    ]
  }
}

resource "aws_iam_policy" "execution_ssm" {
  name        = "${local.name_prefix}-execution-ssm-read"
  description = "Allow ECS execution role to read SSM params for env injection"
  policy      = data.aws_iam_policy_document.execution_ssm.json
}

resource "aws_iam_role_policy_attachment" "execution_ssm" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.execution_ssm.arn
}
