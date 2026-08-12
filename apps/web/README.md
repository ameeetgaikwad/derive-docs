# Hedge web

Next.js frontend for the Hedge covered-call RFQ protocol. It supports BSC
mainnet staging (56) and testnet (97), with deployment addresses imported from
`protocol/deployments/` and runtime network selection in the header. Chain 56
uses the isolated `protocol/deployments/staging/` deployment and must remain
visibly identified as staging until the production launch checklist is complete.

From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @hedge/web dev
```

The app opens at <http://localhost:3000>. Optional configuration belongs in
`apps/web/.env.local`:

```text
NEXT_PUBLIC_RFQ_ENGINE_URL_56=https://mainnet-staging-rfq.example.com
NEXT_PUBLIC_RFQ_ENGINE_URL_97=http://localhost:3030
NEXT_PUBLIC_BSC_MAINNET_RPC_URL=https://bsc-dataseed.bnbchain.org
NEXT_PUBLIC_BSC_TESTNET_RPC_URL=https://bsc-testnet.bnbchain.org
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

`NEXT_PUBLIC_RFQ_ENGINE_URL` is supported as a legacy fallback. Never put a
private key, authenticated RPC URL, or other secret in this app or in any
`NEXT_PUBLIC_*` variable. Both RFQ services may listen on `3030` when deployed
to different servers; when running both locally, give one a different port and
set its chain-specific URL accordingly.

## Checks

```sh
corepack pnpm --filter @hedge/web lint
corepack pnpm --filter @hedge/web test
corepack pnpm --filter @hedge/web typecheck
corepack pnpm --filter @hedge/web build
```

For the local oracle/RFQ/maker stack, use the repository-level `DEV.md`.
