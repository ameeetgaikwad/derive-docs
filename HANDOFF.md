# Hedge — Project Handoff

Single-file context for an AI agent picking this up cold. Read this first, then
`protocol/SPEC.md`, `protocol/PROVENANCE.md`, `protocol/TESTNET.md`, `DEV.md`,
and `docs/bnb-options-protocol-plan.md` for depth.

---

## 1. What this is

**Hedge** is a fully on-chain options protocol on **BNB Chain (BSC)**. V1 product:
**fully-collateralized BTC covered calls**, where a retail user deposits BTCB,
sells a call against it, and the call is bought by **market makers via a sealed-bid
RFQ auction**. Premium is paid upfront in USDT; options are European, physically
collateralized, settled at expiry. Robinhood-style simplicity on top of a full
exchange-grade protocol that can later grow into cash-secured puts, cash-settled
margin trading, and (optionally) a central limit order book.

The repo was originally a frontend for the **Derive** protocol (derive.xyz, ex-Lyra).
We pivoted **off Derive entirely** (business relationship ended + reliability concerns
+ strategic BNB alignment) and rebuilt the protocol ourselves on BSC.

### Key strategic decisions (already made — don't relitigate)
- **Build on BNB L1, not an own L2 and not opBNB.** BSC in 2026 is fast/cheap enough
  (0.45s blocks, ~1.1s finality, 0.05 gwei), has all liquidity (BTCB, USDT) and
  market makers, gasless options (MegaFuel paymaster + EIP-7702), and options are a
  white space there. An app-chain only made sense for Derive's portfolio-margin gas load.
- **Fork Derive's contracts, don't fork Rysk.** Derive's contracts are open-source,
  audited (Sigma Prime), and forkable at a specific pin (see licensing below). Rysk
  V12's core contracts are `UNLICENSED` (proprietary) — only their MM tooling is open.
  We took **Derive's audited on-chain machinery + Rysk's RFQ-auction MM distribution model.**
- **RFQ-only execution for v1** (no resting CLOB). Selling order flow atomically to MMs
  *is* the RFQ model (like Robinhood routing to wholesalers). TradeModule is deployed
  but dormant; a CLOB can be added later against live contracts with no migration.
- **Oracle = Aster's pattern**: Pyth primary spot + Chainlink 1% deviation circuit
  breaker. Signed feeds only for vol/forward (no oracle publishes vol surfaces on-chain).

---

## 2. ⚖️ Licensing — CRITICAL, do not break

Full analysis in `protocol/PROVENANCE.md`. Rules:
- `protocol/lib/v2-core` is pinned at commit **`0ae94c055fe69d1a724d39249fca3c8decb61e24`**
  (2025-01-31). This is the last commit **before 2025-02-17**, whose BUSL change date
  (2025-11-16) has passed → it is now **GPL-3.0**. Contains everything we use.
- `protocol/lib/v2-matching` pinned at **`ae6e3847a1a06e697ff670ed397da44a824a9063`**
  (AGPL-3.0); its v2-core submodule points at exactly our v2-core pin.
- **NEVER pull v2-core code committed on/after 2025-02-17** (BUSL until 2029-03-20) —
  specifically NO `PMRM_2` / `PMRM_2_1`.
- `LiquidateModule.sol` + 2 TSA files in v2-matching are headered `UNLICENSED` — **not used**;
  LiquidateModule is intentionally NOT deployed.
- No "Derive"/"Lyra" branding anywhere user-facing. Crediting the GPL/AGPL audited fork in
  architecture/licensing docs is correct and required.
- **The user's lawyer has confirmed the licensing is clear.** Vendored `lib/*` is READ-ONLY;
  all our code lives outside it. Restore vendor with `protocol/setup-vendor.sh`.

---

## 3. Repo layout

```
protocol/
  lib/v2-core, lib/v2-matching   # vendored, pinned, READ-ONLY (gitignored; setup-vendor.sh restores)
  src/PythSpotFeed.sol           # OUR Pyth+Chainlink spot adapter (GPL-3.0)
  script/                        # OUR deploy scripts: DeployAll, MarketDeployerBase, AddMarket
  deployments/                   # 56.json (mainnet), 97.json (testnet), local anvil output
  PROVENANCE.md SPEC.md MAINNET.md TESTNET.md E2E.md README.md
services/                        # @hedge/* packages in the root pnpm workspace
  shared/        # ABIs, EIP-712 Action signing, RFQ encoding, viem clients (chain-97 legacy-gas forced)
  rfq-engine/    # WS/REST RFQ auction + on-chain executor (Matching.verifyAndMatch)
  oracle-feeds/  # signed feed poster (spot/forward/vol/rate/stable) + settlement + pyth-push
  maker-bot/     # reference market maker (Black-76 pricing off on-chain feeds, auto-quotes)
  e2e/           # anvil acceptance harness (run.ts) + testnet smoke (testnet-smoke.ts)
apps/web/        # Next.js 16 frontend; apps/web/src/lib/protocol/ = integration layer
docs/            # market-maker-integration.md (full MM spec)
docs-site/       # Mintlify docs site (20 pages, 3 tabs) — validated, not yet published
.github/workflows/ # Turborepo/Foundry CI and AWS OIDC CD
infra/           # Terraform: ECR, ECS, ALB, IAM/KMS access, SSM and GitHub OIDC
DEV.md           # local runbook (how to start all services + frontend)
```

Frontend integration lives in `apps/web/src/lib/protocol/` (deployments, ABIs, EIP-712 signing
verified against vendored source, RFQ encoding, local strike-board, client-side Black-76,
rfq-engine REST client). All old Derive plumbing (`apps/web/src/lib/derive/*`, AA/session keys,
paymaster, bridge, proxy API routes) was **deleted**.

---

## 4. What's DONE and verified

- **Contracts deployed + wired on BSC testnet (chainId 97)** — addresses in
  `protocol/deployments/97.json`, table in `protocol/TESTNET.md`.
- **Mainnet contracts deployed on 2026-07-01 (chainId 56)** — repository deployment
  record and remaining launch gates are in `protocol/MAINNET.md`; this does not by
  itself confirm the services are currently running.
- **Frontend supports both chain 56 and 97** with runtime network selection and
  chain-specific deployments, RPCs, RFQ endpoints, explorers, and testnet-only faucets.
- **Anvil E2E passed** (deploy → feeds → deposit → RFQ → on-chain fill → ITM+OTM settlement).
- **First live covered-call trade on testnet** (`protocol/TESTNET.md` "Live smoke trade"):
  tx `0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3`, premium 378.59 USDT.
- **OI fee fixed**: was 10% of notional (vendored `OIFeeRateBPS=0.1e18` is an 18-dec
  multiplier, NOT bps), now **0.1%** (`0.001e18`) on testnet + deploy default. Floor 10 USDT.
- **Oracle upgraded**: `PythSpotFeed` (Pyth primary + Chainlink 1% breaker) deployed and
  swapped into the SRM for the BTC market. LyraSpotFeed kept as fallback. 23 Foundry tests.
- **Multi-asset ready**: market configs are data (`MarketDeployerBase.sol`, BTC=0, ETH=1);
  `AddMarket.s.sol` adds a market against the live deployment. Validated on anvil.
- **rfq-engine hardened for MM onboarding** (8 gaps closed): maker allowlist, taker rate
  limiting + host binding, taker-accept deadline + maker failure/expiry notifications + fill
  reports, quote cancel/replace + connection dedupe, WS heartbeats, durable JSONL store with
  crash recovery, fee-aware collateral pre-check (reads live OI fee). maker-bot speaks it.
- **Monorepo validation**: `corepack pnpm turbo lint test build typecheck` covers the
  web app and TypeScript services. Foundry validation restores the pinned vendor repos,
  builds them, then runs `forge fmt --check src script test`, `forge build`, and `forge test`.
- **Production infrastructure authored** for `rfq-engine` and `oracle-feeds`: Docker,
  GitHub OIDC CI/CD, and Terraform/ECS/KMS. Repository presence does not prove AWS is
  currently applied or healthy; use `infra/README.md` for the gated rollout.
- **Docs**: `docs/market-maker-integration.md` + Mintlify `docs-site/` (validated, no broken links).

### Key testnet addresses (chainId 97)
- Matching `0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285`, domain separator
  `0x4cc5ab9a5a9e3993fe20da61e691a365b4b67a1339557e5b0437ba83097c84b5`
- RfqModule `0x2769E33b2169C83304cEa0c5C8fbC5a1707E305D`, SRM `0x4d55A929e184fc366664C11526E3B54aB70340B5`
- CashAsset/USDT `0x5d9e4EbD7E28deEF6f9A1a89Ed7Ce8608EE9074F`, OptionAsset `0xD0dD8DcA596540F615e66E07F49d40647D8bC6eD`
- PythSpotFeed (live) `0xaAc2C29105928A6fe7788956058bcF3B9A3D5E51`
- Mock BTCB `0x32fCF6a260Cdd2A3dc79cD0d4aD6B6c46bF6798A`, Mock USDT `0x9896AF08d261E52a629EF58cBebd32E8e0AA8eA9` (both open-mint)
- Deployer = executor = feed poster `0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB` (owns everything; ~0.037 tBNB)
- Feed signer `0xdE50B8E965aD2B8E25f45a19FD87A2d2c737782F` (1-of-1, testnet only)
- Keys are in **`protocol/.env`** (gitignored).

---

## 5. Operational gotchas (will bite you)

1. **BSC testnet nodes mishandle EIP-1559 fees** → "insufficient funds: have 0" / "gas
   required exceeds allowance". ALL txs must be **legacy, gasPrice 0.2 gwei**
   (`--legacy --with-gas-price 200000000`; the services' viem clients force this on chain 97).
2. **Public BSC testnet RPCs are flaky.** Prefer the thirdweb endpoint in `.env`
   (`RPC_URL_97_THIRDWEB`), retry `--retries 12 --delay 5`.
3. **Pyth staleness = 60s.** The SRM spot feed reverts if the Pyth price is >60s old →
   trades fail. The `oracle-feeds daemon` refreshes Pyth and signed feeds by default.
4. **Lyra signed feeds (forward/vol/rate) have heartbeats** → must be posted recently or
   `getSpot`/margin reverts. The `oracle-feeds daemon` keeps them fresh; **the feed signer
   needs tBNB** (it posts the txs — top it up from the deployer).
5. **When verifying on-chain reads in bash**, an RPC error can look like success — check for
   non-empty, non-zero output explicitly (this caused a false "mint landed" earlier).
6. To run the full stack locally: follow **`DEV.md`** (oracle-feeds daemon,
   rfq-engine on :3030, maker-bot, and `corepack pnpm --filter @hedge/web dev`
   for the frontend on :3000).

---

## 6. Mainnet contracts are deployed; product launch is still gated

**Launch gates (require the user / external):**
1. **Real-BTCB smoke trade.** Complete the tiny mainnet end-to-end trade and
   settlement rehearsal documented in `protocol/MAINNET.md` before opening the UI.
2. **Ownership → multisig.** Right now the deployer hot key (`0x6e15…`) owns every contract.
   Move all owner roles to a Gnosis Safe the user controls. Disqualifying for mainnet otherwise.
3. **Diff-audit.** Sigma Prime audited the forked base; our deltas (PythSpotFeed adapter,
   deploy/config changes) are new code and should get a focused review.
4. **MM onboarding.** Collect real market-maker addresses for `MAKER_ALLOWLIST`; have ≥1 MM
   quote on testnet through the docs for a week of adversarial use before real money.
5. **Service hosting**: apply/verify the authored AWS stack for rfq-engine +
   oracle-feeds, configure TLS/wss and monitoring, and set a durable RFQ store path.
   The maker-bot is a separate market-maker artifact, not an ECS service in `infra/`.
6. **Frontend production config**: set the chain-56 RPC and RFQ endpoints, verify
   the TLS domain, and run a wallet-level mainnet review before public release.

**Near-term build items:**
- Add cash-secured puts (nearly free on the deployed contracts — put seller deposits USDT
  into the same CashAsset, sells via the same RfqModule; mostly frontend + config).
- Deploy the ETH market to testnet via `AddMarket.s.sol` to exercise multi-asset.
- Publish the Mintlify docs and consider gas sponsorship after the core launch gates.

---

## 7. Phase roadmap
1. **Phase 1 (current)**: covered calls + RFQ, fully collateralized, BTC only;
   testnet proven, mainnet contracts deployed, launch gates outstanding.
2. **Phase 2**: cash-secured puts; cash-settled margin trading (SRM margin + DutchAuction
   liquidations — DutchAuction is deployed, dormant); more underlyings (ETH, BNB).
3. **Phase 3**: optional CLOB via the dormant TradeModule + own matching engine; portfolio
   margin (rebuild vs license PMRM_2 vs wait until 2029); broker/builder-fee distribution program.
