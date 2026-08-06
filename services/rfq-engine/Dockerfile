# Hedge RFQ auction + execution engine (WS + REST server).
#
# Build from the REPO ROOT (the pnpm workspace), not from services/:
#   docker build -f services/rfq-engine/Dockerfile -t hedge-rfq-engine .
#
# Runtime env (see services/rfq-engine/src/config.ts):
#   CHAIN_ID                  target chain id (e.g. 56). No anvil default in prod.
#   RPC_URL                   JSON-RPC endpoint for the chain.
#   RFQ_PORT                  listen port (default 3030). PORT is also honored.
#   HOST                      bind address; set 0.0.0.0 in the container (default 127.0.0.1).
#   EXECUTOR_KMS_KEY_ID       AWS KMS key id/ARN/alias for the trade executor
#                             (alias/hedge-executor). Used instead of a raw key.
#   EXECUTOR_KMS_REGION       AWS region for the executor KMS key (else standard AWS chain).
#   AUCTION_WINDOW_MS         auction window in ms (default 3000).
#   MAKER_ALLOWLIST           comma-separated maker EOAs; empty = open/dev mode.
#   STORE_PATH                JSONL persistence file; unset = in-memory store.
#   TAKER_ACCEPT_DEADLINE_MS  ms the taker has to accept a won auction (default 120000).
# Contract addresses are read from protocol/deployments/<CHAIN_ID>.json — mount that
# dir and point SATS_DEPLOYMENTS_DIR at it (it is intentionally NOT baked into the image).
#
# ECR: hedge/rfq-engine (us-east-1, account 985539774899).
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- build stage: install rfq-engine + its workspace dep (shared), compile ---
FROM base AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Workspace manifests first for better layer caching of the install graph.
COPY pnpm-workspace.yaml pnpm-lock.yaml turbo.json package.json ./
COPY apps/web/package.json apps/web/package.json
COPY docs-site/package.json docs-site/package.json
COPY services/shared/package.json services/shared/package.json
COPY services/rfq-engine/package.json services/rfq-engine/package.json
COPY services/oracle-feeds/package.json services/oracle-feeds/package.json
COPY services/maker-bot/package.json services/maker-bot/package.json
COPY services/e2e/package.json services/e2e/package.json
# Install rfq-engine and everything it depends on (@hedge/shared), incl. dev deps for the build.
RUN pnpm install --frozen-lockfile --filter "@hedge/rfq-engine..."
# Sources for the two packages we build.
COPY services/shared services/shared
COPY services/rfq-engine services/rfq-engine
# Deployment address books (public, not secret) — services read
# protocol/deployments/<CHAIN_ID>.json at startup via SATS_DEPLOYMENTS_DIR.
COPY protocol/deployments /app/protocol/deployments
# Build @hedge/shared from the committed ABI snapshot, then build the rfq-engine.
RUN pnpm --filter @hedge/shared exec tsc -p tsconfig.json \
 && pnpm --filter @hedge/rfq-engine build

# --- runtime stage ---
FROM base AS runtime
ENV NODE_ENV=production
ENV SATS_DEPLOYMENTS_DIR=/app/protocol/deployments
RUN useradd -m -u 10001 rfq
COPY --from=build --chown=rfq:rfq /app /app
USER rfq
WORKDIR /app/services/rfq-engine
# Bind to all interfaces inside the container; front with a TLS proxy for wss.
ENV HOST=0.0.0.0
EXPOSE 3030
ENTRYPOINT ["node", "dist/index.js"]
