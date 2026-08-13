output "ecs_service_names" {
  value = {
    rfq_engine   = aws_ecs_service.rfq_engine.name
    oracle_feeds = aws_ecs_service.oracle_feeds.name
    maker_bot    = aws_ecs_service.maker_bot.name
  }
}

output "alb_dns_name" {
  value = aws_lb.rfq_engine.dns_name
}

output "ssm_parameter_names" {
  value = {
    chain_id             = aws_ssm_parameter.chain_id.name
    rpc_url              = aws_ssm_parameter.rpc_url.name
    executor_private_key = var.executor_private_key_parameter_name
    feed_signer_key      = var.feed_signer_key_parameter_name
    maker_private_key    = var.maker_private_key_parameter_name
    pyth_api_key         = var.pyth_api_key_parameter_name
  }
}

output "rfq_public_url" {
  value = var.certificate_arn == null ? "http://${aws_lb.rfq_engine.dns_name}" : "https://${var.rfq_public_hostname}"
}

output "efs_file_system_id" {
  value = aws_efs_file_system.state.id
}
