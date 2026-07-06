# =============================================================================
# Application Load Balancer for rfq-engine (public WS + REST on container :3030).
#
# HTTPS/WSS listener on :443 is created only when certificate_arn is set.
# An HTTP :80 listener always exists: it forwards to the target group when there
# is no cert (bring-up / validate), or redirects to :443 when a cert is present.
# =============================================================================
resource "aws_lb" "rfq_engine" {
  name               = "${local.name_prefix}-rfq-engine"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids

  tags = { Name = "${local.name_prefix}-rfq-engine" }
}

resource "aws_lb_target_group" "rfq_engine" {
  name        = "${local.name_prefix}-rfq-engine"
  port        = 3030
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip" # Fargate awsvpc mode registers ENI IPs

  health_check {
    enabled             = true
    path                = "/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name_prefix}-rfq-engine" }
}

# HTTP :80 — forwards to the target group when there is no cert, otherwise
# redirects to HTTPS.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.rfq_engine.arn
  port              = 80
  protocol          = "HTTP"

  # When a cert is present, redirect HTTP -> HTTPS.
  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [] : [1]
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  # When there is no cert, serve traffic directly over HTTP.
  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.rfq_engine.arn
    }
  }
}

# HTTPS :443 — only when a cert ARN is supplied.
resource "aws_lb_listener" "https" {
  count = var.certificate_arn == null ? 0 : 1

  load_balancer_arn = aws_lb.rfq_engine.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.rfq_engine.arn
  }
}
