# -----------------------------------------------------------------------------
# ECR repositories — one per deployable service image.
# -----------------------------------------------------------------------------
resource "aws_ecr_repository" "service" {
  for_each = toset([
    "hedge/rfq-engine",
    "hedge/oracle-feeds",
    "hedge/maker-bot",
  ])

  name                 = each.value
  image_tag_mutability = "MUTABLE" # allow the moving :latest tag

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = each.value }
}

# Expire untagged images to keep the registry lean.
resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images older than 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = { type = "expire" }
      },
    ]
  })
}
