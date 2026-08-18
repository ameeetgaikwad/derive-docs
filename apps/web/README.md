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

`NEXT_PUBLIC_RFQ_ENGINE_URL_56` is mandatory whenever chain 56 is exposed, and
the web app verifies that its `/health` response reports chain ID 56 before any
subaccount or deposit transaction. `NEXT_PUBLIC_RFQ_ENGINE_URL` remains a
legacy fallback for testnet only. Never put a private key, authenticated RPC
URL, or other secret in this app or in any `NEXT_PUBLIC_*` variable. Both RFQ
services may listen on `3030` when deployed to different servers; when running
both locally, give one a different port and set its chain-specific URL
accordingly.

## Trading subaccounts

The connected wallet receives an enumerable list from the RFQ engine's
`GET /subaccounts` directory. The browser treats those IDs as candidates and
live-validates the logical owner, StandardManager, Matching NFT custodian, and
current balances in one multicall before rendering the selector. The user must
choose an account explicitly or create another; the directory list and selected
account ID are not written to local storage.

If the directory request fails, the browser scans wallet-filtered
`DepositedSubAccount` logs from the deployment's recorded
`matchingDeploymentBlock`, then applies the same live validation. A failed API
or RPC request is shown as an error, never as an empty account list. A newly
confirmed `Matching.createSubAccount` receipt is decoded, validated, inserted,
and selected immediately while the directory catches up asynchronously.

## Checks

```sh
corepack pnpm --filter @hedge/web lint
corepack pnpm --filter @hedge/web test
corepack pnpm --filter @hedge/web typecheck
corepack pnpm --filter @hedge/web build
```

For the local oracle/RFQ/maker stack, use the repository-level `DEV.md`.
