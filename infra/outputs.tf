output "ecr_repository_urls" {
  description = "ECR repository URLs, keyed by repo name."
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.hedge.name
}

output "ecs_service_names" {
  description = "ECS service names."
  value = {
    rfq_engine   = aws_ecs_service.rfq_engine.name
    oracle_feeds = aws_ecs_service.oracle_feeds.name
  }
}

output "github_deploy_role_arn" {
  description = "Set this as the GitHub Actions variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_deploy.arn
}

output "ecs_task_role_arn" {
  description = "Runtime role assumed by the containers (KMS signer identity)."
  value       = aws_iam_role.ecs_task.arn
}

output "ecs_execution_role_arn" {
  description = "ECS execution role (ECR pull + logs + SSM env injection)."
  value       = aws_iam_role.ecs_execution.arn
}

output "alb_dns_name" {
  description = "Public DNS name of the rfq-engine ALB (point your domain's CNAME here)."
  value       = aws_lb.rfq_engine.dns_name
}

output "hedge_kms_key_arns" {
  description = "Resolved ARNs of the two Hedge signing keys the task role may use."
  value       = local.hedge_kms_key_arns
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider."
  value       = aws_iam_openid_connect_provider.github.arn
}
