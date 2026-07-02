# Hedge reference market-maker bot.
# Build from the services/ directory (it needs the pnpm workspace):
#   docker build -f maker-bot/Dockerfile -t hedge-maker-bot .
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- build stage: install the maker-bot + its workspace dep (shared), compile ---
FROM base AS build
# Workspace manifests first (better layer caching for the install graph).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY shared/package.json shared/package.json
COPY rfq-engine/package.json rfq-engine/package.json
COPY oracle-feeds/package.json oracle-feeds/package.json
COPY maker-bot/package.json maker-bot/package.json
COPY e2e/package.json e2e/package.json
# Install maker-bot and everything it depends on (@hedge/shared), incl. dev deps for the build.
RUN pnpm install --frozen-lockfile --filter "@hedge/maker-bot..."
# Sources for the two packages we build.
COPY shared shared
COPY maker-bot maker-bot
# Build shared via tsc directly (its `build` also re-extracts ABIs from the
# forge artifacts, which live outside this context; the extracted src/abis
# are committed, so a plain tsc is correct here), then the maker-bot.
RUN pnpm --filter @hedge/shared exec tsc -p tsconfig.json \
 && pnpm --filter @hedge/maker-bot build

# --- runtime stage ---
FROM base AS runtime
ENV NODE_ENV=production
RUN useradd -m -u 10001 maker
COPY --from=build --chown=maker:maker /app /app
USER maker
WORKDIR /app/maker-bot
# No args = run the quoting bot. Pass `--setup` (once) to create the maker
# subaccount and deposit USDT. Configure entirely via env (see MAKER.md).
ENTRYPOINT ["node", "dist/index.js"]
