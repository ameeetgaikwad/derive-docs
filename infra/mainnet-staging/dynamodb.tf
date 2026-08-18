resource "aws_dynamodb_table" "subaccount_directory" {
  name         = "${local.name_prefix}-subaccount-directory"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "networkKey"
  range_key    = "entityKey"

  attribute {
    name = "networkKey"
    type = "S"
  }

  attribute {
    name = "entityKey"
    type = "S"
  }

  attribute {
    name = "ownerActiveKey"
    type = "S"
  }

  global_secondary_index {
    name            = "owner-active-index"
    hash_key        = "ownerActiveKey"
    projection_type = "INCLUDE"
    non_key_attributes = [
      "accountId",
    ]
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = { Name = "${local.name_prefix}-subaccount-directory" }
}

data "aws_iam_policy_document" "subaccount_directory" {
  statement {
    sid    = "ReadWriteSubaccountDirectory"
    effect = "Allow"
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
    ]
    resources = [
      aws_dynamodb_table.subaccount_directory.arn,
      "${aws_dynamodb_table.subaccount_directory.arn}/index/*",
    ]
  }
}

resource "aws_iam_role_policy" "subaccount_directory" {
  name   = "${local.name_prefix}-subaccount-directory"
  role   = data.aws_iam_role.task.name
  policy = data.aws_iam_policy_document.subaccount_directory.json
}
