# =============================================================================
# GitHub Actions OIDC — lets the CD workflow assume an AWS role with NO
# long-lived access keys stored in GitHub.
# =============================================================================

# OIDC provider for GitHub Actions.
#
# Note: for IAM OIDC providers backed by a CA in AWS's trust store (GitHub's is),
# `thumbprint_list` is no longer used for verification, but the argument is still
# accepted. We pin the well-known intermediate thumbprint so the config is stable
# and validates/plans deterministically offline.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = { Name = "${local.name_prefix}-github-oidc" }
}

# Trust policy: only tokens from our repo (subject) with the sts audience.
data "aws_iam_policy_document" "github_deploy_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_oidc_subject]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.name_prefix}-github-deploy"
  description        = "Assumed by GitHub Actions (OIDC) to push ECR images and roll ECS services"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_assume.json
}

# Permissions the CD pipeline needs: ECR push, ECS deploy, and PassRole for the
# task/execution roles (required by RegisterTaskDefinition + UpdateService).
data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # GetAuthorizationToken cannot be resource-scoped
  }

  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]
    resources = [for r in aws_ecr_repository.service : r.arn]
  }

  statement {
    sid    = "EcsDeploy"
    effect = "Allow"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DeregisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeServices",
      "ecs:UpdateService",
      "ecs:DescribeClusters",
      "ecs:ListTasks",
      "ecs:DescribeTasks",
    ]
    resources = ["*"] # RegisterTaskDefinition is not resource-scopable; others scoped by cluster tag in practice
  }

  # PassRole is required so the pipeline can register task defs that reference
  # the task and execution roles. Scoped to exactly those two roles.
  statement {
    sid     = "PassEcsRoles"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.ecs_task.arn,
      aws_iam_role.ecs_execution.arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "github_deploy" {
  name        = "${local.name_prefix}-github-deploy"
  description = "ECR push + ECS deploy + PassRole for the CD pipeline"
  policy      = data.aws_iam_policy_document.github_deploy.json
}

resource "aws_iam_role_policy_attachment" "github_deploy" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_deploy.arn
}
