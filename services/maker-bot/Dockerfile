# Hedge reference market-maker bot.
# Build from the REPO ROOT (the pnpm workspace):
#   docker build -f services/maker-bot/Dockerfile -t hedge-maker-bot .
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- build stage: install the maker-bot + its workspace dep (shared), compile ---
FROM base AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Workspace manifests first (better layer caching for the install graph).
COPY pnpm-workspace.yaml pnpm-lock.yaml turbo.json package.json ./
COPY apps/web/package.json apps/web/package.json
COPY docs-site/package.json docs-site/package.json
COPY services/shared/package.json services/shared/package.json
COPY services/rfq-engine/package.json services/rfq-engine/package.json
COPY services/oracle-feeds/package.json services/oracle-feeds/package.json
COPY services/maker-bot/package.json services/maker-bot/package.json
COPY services/e2e/package.json services/e2e/package.json
# Install maker-bot and everything it depends on (@hedge/shared), incl. dev deps for the build.
RUN pnpm install --frozen-lockfile --filter "@hedge/maker-bot..."
# Sources for the two packages we build.
COPY services/shared services/shared
COPY services/maker-bot services/maker-bot
COPY protocol/deployments /app/protocol/deployments
# Build shared from the committed ABI snapshot, then build the maker-bot.
RUN pnpm --filter @hedge/shared exec tsc -p tsconfig.json \
 && pnpm --filter @hedge/maker-bot build

# --- runtime stage ---
FROM base AS runtime
ENV NODE_ENV=production
ENV SATS_DEPLOYMENTS_DIR=/app/protocol/deployments
RUN useradd -m -u 10001 maker
COPY --from=build --chown=maker:maker /app /app
USER maker
WORKDIR /app/services/maker-bot
# No args = run the quoting bot. Pass `--setup` (once) to create the maker
# subaccount and deposit USDT. Configure entirely via env (see MAKER.md).
ENTRYPOINT ["node", "dist/index.js"]
