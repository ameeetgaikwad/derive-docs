output "ecs_service_names" {
  value = {
    rfq_engine   = aws_ecs_service.rfq_engine.name
    oracle_feeds = aws_ecs_service.oracle_feeds.name
  }
}

output "alb_dns_name" {
  value = aws_lb.rfq_engine.dns_name
}

output "ssm_parameter_names" {
  value = {
    chain_id = aws_ssm_parameter.chain_id.name
    rpc_url  = aws_ssm_parameter.rpc_url.name
  }
}

output "kms_key_arns" {
  description = "KMS keys whose derived EVM addresses must match the staging deployment roles."
  value = {
    feed_signer = data.aws_kms_alias.feed_signer.target_key_arn
    executor    = data.aws_kms_alias.executor.target_key_arn
  }
}

output "efs_file_system_id" {
  value = aws_efs_file_system.state.id
}
