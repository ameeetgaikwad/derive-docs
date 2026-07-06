# Hedge oracle-feeds: signed feed poster + settlement daemon (no listening port).
#
# Build from the REPO ROOT (the pnpm workspace), not from services/:
#   docker build -f services/oracle-feeds/Dockerfile -t hedge-oracle-feeds .
#
# The ENTRYPOINT is the CLI (dist/cli.js). The default CMD runs the deribit
# surface daemon, but any subcommand works against the same image, e.g.:
#   docker run hedge-oracle-feeds                      # daemon --source deribit (default CMD)
#   docker run hedge-oracle-feeds daemon --source deribit
#   docker run hedge-oracle-feeds pyth-push
#   docker run hedge-oracle-feeds settle
#
# Runtime env (see services/oracle-feeds/src/env.ts):
#   CHAIN_ID                  target chain id (e.g. 56). anvil default only on 31337.
#   RPC_URL                   JSON-RPC endpoint for the chain.
#   FEED_SIGNER_KMS_KEY_ID    AWS KMS key id/ARN/alias for the feed signer
#                             (alias/hedge-feed-signer). Required off-chain of 31337;
#                             the key never leaves the HSM.
#   FEED_SIGNER_KMS_REGION    AWS region for the feed-signer KMS key (else standard AWS chain).
# Contract addresses are read from protocol/deployments/<CHAIN_ID>.json — mount that
# dir and point SATS_DEPLOYMENTS_DIR at it (it is intentionally NOT baked into the image).
#
# ECR: hedge/oracle-feeds (us-east-1, account 985539774899).
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- build stage: install oracle-feeds + its workspace dep (shared), compile ---
FROM base AS build
# Workspace manifests first for better layer caching of the install graph.
COPY pnpm-workspace.yaml pnpm-lock.yaml turbo.json package.json ./
COPY apps/web/package.json apps/web/package.json
COPY docs-site/package.json docs-site/package.json
COPY services/shared/package.json services/shared/package.json
COPY services/rfq-engine/package.json services/rfq-engine/package.json
COPY services/oracle-feeds/package.json services/oracle-feeds/package.json
COPY services/maker-bot/package.json services/maker-bot/package.json
COPY services/e2e/package.json services/e2e/package.json
# Install oracle-feeds and everything it depends on (@hedge/shared), incl. dev deps for the build.
RUN pnpm install --frozen-lockfile --filter "@hedge/oracle-feeds..."
# Sources for the two packages we build.
COPY services/shared services/shared
COPY services/oracle-feeds services/oracle-feeds
# Deployment address books (public, not secret) — read at startup via SATS_DEPLOYMENTS_DIR.
COPY protocol/deployments /app/protocol/deployments
# Build @hedge/shared via tsc directly (its `build` re-extracts ABIs from forge
# artifacts that live outside this context; the extracted src/abis are committed,
# so a plain tsc is correct), then build oracle-feeds.
RUN pnpm --filter @hedge/shared exec tsc -p tsconfig.json \
 && pnpm --filter @hedge/oracle-feeds build

# --- runtime stage ---
FROM base AS runtime
ENV NODE_ENV=production
ENV SATS_DEPLOYMENTS_DIR=/app/protocol/deployments
RUN useradd -m -u 10001 oracle
COPY --from=build --chown=oracle:oracle /app /app
USER oracle
WORKDIR /app/services/oracle-feeds
# Flexible entrypoint (the CLI); default CMD runs the deribit surface daemon.
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["daemon", "--source", "deribit"]
