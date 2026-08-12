resource "aws_efs_file_system" "state" {
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = { Name = local.name_prefix }
}

resource "aws_efs_backup_policy" "state" {
  file_system_id = aws_efs_file_system.state.id

  backup_policy {
    status = "ENABLED"
  }
}

resource "aws_efs_mount_target" "state" {
  for_each = local.default_subnets_by_az

  file_system_id  = aws_efs_file_system.state.id
  subnet_id       = each.value[0]
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "rfq" {
  file_system_id = aws_efs_file_system.state.id

  posix_user {
    uid = 10001
    gid = 10001
  }

  root_directory {
    path = "/rfq"
    creation_info {
      owner_uid   = 10001
      owner_gid   = 10001
      permissions = "0750"
    }
  }
}

resource "aws_efs_access_point" "oracle" {
  file_system_id = aws_efs_file_system.state.id

  posix_user {
    uid = 10001
    gid = 10001
  }

  root_directory {
    path = "/oracle"
    creation_info {
      owner_uid   = 10001
      owner_gid   = 10001
      permissions = "0750"
    }
  }
}
