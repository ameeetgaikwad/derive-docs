# BSC mainnet-staging ECS stack

This is a separate Terraform root and state. It creates only the chain-56
staging runtime and reads the existing `hedge` ECS cluster, task roles, ECR
repositories, and default VPC as data sources. It cannot
reconfigure the existing testnet services.

It creates:

- `hedge-mainnet-staging-rfq-engine`, behind its own public ALB;
- `hedge-mainnet-staging-oracle-feeds`, with no inbound traffic;
- isolated SSM parameters and CloudWatch log groups;
- encrypted, backed-up EFS state with separate RFQ and oracle access points;
- separate security groups, target group, and listeners.

Both RFQ environments may listen on container port `3030`; Fargate task ENIs
and separate ALBs isolate them.

## Safe rollout

1. Copy `mainnet-staging.tfvars.example` to the ignored
   `mainnet-staging.tfvars` and enter the private RPC. The task definitions use
   `latest` because the existing CD workflow pushes both immutable SHA tags and
   `latest`, then forces a deployment.
2. Verify the remote state bucket, enable the S3 backend in `versions.tf`, and
   run `terraform init`. Never share the existing stack's state key.
3. Create these out-of-band SSM `SecureString` parameters. Terraform injects
   them into ECS by ARN and never reads their values into state:
   - `/hedge/mainnet-staging/feed_signer_key` must derive to
     `0x7a5e6A644A97d1E4Be9a0cd87092C3e9d3b8400c`.
   - `/hedge/mainnet-staging/executor_private_key` must derive to
     `0x30Fe4CA44f7Fe7dd5DcB1359d3CB3e88EE1Bb267`.
   Raw keys are permitted only for this pre-production staging deployment;
   production must use independently authorized KMS identities.
4. Plan and apply with both desired counts at zero:

   ```bash
   terraform plan -var-file=mainnet-staging.tfvars -out=tfplan
   terraform apply tfplan
   ```

5. Publish the reviewed RFQ and oracle images. The images must contain
   `protocol/deployments/staging/56.json` and its staging market manifest.
6. Set only `rfq_engine_desired_count` to one and apply. Check its CloudWatch
   startup preflight and `curl http://<alb-dns>/health`.
7. Stop every local chain-56 oracle, set `oracle_feeds_desired_count` to one,
   and apply again. Only one process may use the feed-signer nonce stream.
8. Attach ACM/DNS and configure the deployed frontend's
   `NEXT_PUBLIC_RFQ_ENGINE_URL_56=https://<staging-host>`.

The maker remains operator-managed because it currently requires a raw maker
EOA private key. Do not put that key in ECS; add KMS or Secrets Manager support
before moving the maker bot into this stack.
