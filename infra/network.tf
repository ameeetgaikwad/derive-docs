# -----------------------------------------------------------------------------
# Networking — v1 uses the account's DEFAULT VPC and its subnets.
#
# Rationale: keeps bring-up simple and lets `validate`/`plan` run without
# provisioning a VPC. A dedicated VPC with private subnets + NAT is a later
# hardening step (services would then run in private subnets behind the ALB with
# assign_public_ip = false and egress via NAT). Tracked as future work.
#
# For v1, Fargate tasks run in the default (public) subnets with public IPs so
# they can reach the internet (ECR, RPC, Deribit) without a NAT gateway.
# -----------------------------------------------------------------------------
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# -----------------------------------------------------------------------------
# Security groups.
# -----------------------------------------------------------------------------

# ALB: allow inbound HTTP/HTTPS from the internet.
resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Ingress for the Hedge ALB (rfq-engine)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS / WSS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-alb" }
}

# rfq-engine tasks: accept traffic from the ALB on the container port.
resource "aws_security_group" "rfq_engine" {
  name        = "${local.name_prefix}-rfq-engine"
  description = "rfq-engine Fargate tasks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "From ALB to rfq-engine container port"
    from_port       = 3030
    to_port         = 3030
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-rfq-engine" }
}

# oracle-feeds tasks: no inbound (daemon), egress only.
resource "aws_security_group" "oracle_feeds" {
  name        = "${local.name_prefix}-oracle-feeds"
  description = "oracle-feeds Fargate tasks (daemon, egress only)"
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-oracle-feeds" }
}
