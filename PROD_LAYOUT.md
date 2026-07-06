# Productionization target layout (branch: prod/monorepo-cicd)

Goal: Turborepo monorepo + Dockerized services + GitHub Actions CI/CD + AWS ECS
deploy (IAM role → KMS signing, no session/keys on any host). Work happens in
this worktree: `/Users/brahma/Projects/sats/derive-prod`. The main checkout
(`/Users/brahma/Projects/sats/derive`) runs the live services — DO NOT touch it.

## Target monorepo layout

```
/ (repo root — Turborepo)
  turbo.json                 # task pipeline (build, lint, test, typecheck, dev)
  package.json               # private root; devDep: turbo; scripts delegate to turbo
  pnpm-workspace.yaml        # packages: apps/*, services/*, docs-site
  apps/
    web/                     # the Next.js frontend, MOVED from repo root
  services/                  # existing @hedge/* packages (shared, rfq-engine, oracle-feeds, maker-bot, e2e)
  protocol/                  # Foundry (not a JS workspace member; referenced by path)
  docs-site/                 # Mintlify
  .github/workflows/         # CI + CD
  infra/                     # Terraform (ECR, ECS, IAM, ALB, logs, GitHub OIDC)
```

## Hard rules
- Everything builds: `pnpm install` at root, then `pnpm turbo build lint test` green
  (frontend + all services + forge tests where wired).
- The frontend keeps working: after moving to apps/web, fix the deployment JSON
  import depth (`src/lib/protocol/deployments.ts` imports `protocol/deployments/{56,97}.json`
  by relative path — recompute from apps/web) and any other `../protocol` refs.
- Services stay in `services/` at the same paths (the live processes don't run from
  this worktree, but keep the layout stable so the main checkout still matches after merge).
- The two AWS KMS keys already exist: `alias/hedge-feed-signer`
  (0x7dFC96d1b08eF29a99957EF99BF68F631348C667) and `alias/hedge-executor`
  (0x915949FeEBedE7196Ed5F35b5b23997be790171B), account 985539774899, us-east-1.
- Services adopt KMS via env: `FEED_SIGNER_KMS_KEY_ID`, `EXECUTOR_KMS_KEY_ID`
  (shared `resolveAccount` already supports this).
- Nothing is applied to AWS in this branch work (session-gated); Terraform is authored + `validate`d only.
- Don't commit secrets. Don't start long-lived processes.

## Deployable services (long-running, need KMS)
- **rfq-engine**: WS + REST auction server + on-chain executor (EXECUTOR_KMS_KEY_ID). Public via ALB/TLS (wss).
- **oracle-feeds**: `daemon --source deribit` (posts SVI surface) + a periodic `pyth-push`; signs with FEED_SIGNER_KMS_KEY_ID. (Run as an ECS service loop and/or scheduled task.)
- **maker-bot**: reference MM (already has a Dockerfile) — NOT part of protocol infra; ships as the MM artifact, optionally deployed for beta.

## CI/CD intent
- **CI** (PR + push): `pnpm turbo lint test build typecheck` + `forge test` in protocol/.
- **CD** (push to main, or manual): build + push service images to ECR, update ECS services. Auth via GitHub OIDC → AWS role (no long-lived keys in GitHub).
