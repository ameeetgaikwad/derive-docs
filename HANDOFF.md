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
  deployments/                   # 31337.json (anvil), 97.json (BSC testnet) + sidecars
  PROVENANCE.md SPEC.md TESTNET.md E2E.md README.md
services/                        # pnpm workspace, Node 22, viem, strict TS. Packages = @hedge/*
  shared/        # ABIs, EIP-712 Action signing, RFQ encoding, viem clients (chain-97 legacy-gas forced)
  rfq-engine/    # WS/REST RFQ auction + on-chain executor (Matching.verifyAndMatch)
  oracle-feeds/  # signed feed poster (spot/forward/vol/rate/stable) + settlement + pyth-push
  maker-bot/     # reference market maker (Black-76 pricing off on-chain feeds, auto-quotes)
  e2e/           # anvil acceptance harness (run.ts) + testnet smoke (testnet-smoke.ts)
src/             # Next.js 16 frontend (App Router, wagmi/RainbowKit, viem). src/lib/protocol/ = integration layer
docs/            # market-maker-integration.md (full MM spec)
docs-site/       # Mintlify docs site (20 pages, 3 tabs) — validated, not yet published
DEV.md           # local runbook (how to start all services + frontend)
```

Frontend integration lives in `src/lib/protocol/` (deployments, ABIs, EIP-712 signing
verified against vendored source, RFQ encoding, local strike-board, client-side Black-76,
rfq-engine REST client). All old Derive plumbing (`src/lib/derive/*`, AA/session keys,
paymaster, bridge, proxy API routes) was **deleted**.

---

## 4. What's DONE and verified

- **Contracts deployed + wired on BSC testnet (chainId 97)** — addresses in
  `protocol/deployments/97.json`, table in `protocol/TESTNET.md`.
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
- **Tests green**: services 69, Foundry 23, frontend 8. Frontend `pnpm build` clean.
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
   trades fail. Run `pnpm --filter @hedge/oracle-feeds pyth-push` (or loop it) before/while trading.
4. **Lyra signed feeds (forward/vol/rate) have heartbeats** → must be posted recently or
   `getSpot`/margin reverts. The `oracle-feeds daemon` keeps them fresh; **the feed signer
   needs tBNB** (it posts the txs — top it up from the deployer).
5. **When verifying on-chain reads in bash**, an RPC error can look like success — check for
   non-empty, non-zero output explicitly (this caused a false "mint landed" earlier).
6. To run the full stack locally: follow **`DEV.md`** (oracle-feeds daemon + pyth-push loop +
   rfq-engine on :3030 + maker-bot + `pnpm dev` frontend on :3000).

### Known open thread (last session, incomplete)
A browser walkthrough of the frontend was in progress (recording a GIF of the full flow).
The "Get test BTCB" mint via MetaMask did not confirm (user reported the wallet signing
didn't go through). Nothing is broken — the live smoke trade already proved the flow via the
services. To finish the browser demo: ensure feeds are fresh, connect wallet on BSC testnet,
fund it with tBNB from the deployer, mint test BTCB, then drive deposit → RFQ → sign → settle.

---

## 6. Next steps to go live (mainnet)

**Pre-mainnet gates (require the user / external):**
1. **Ownership → multisig.** Right now the deployer hot key (`0x6e15…`) owns every contract.
   Move all owner roles to a Gnosis Safe the user controls. Disqualifying for mainnet otherwise.
2. **Feed signer hardening.** Testnet is 1-of-1. Mainnet needs **N-of-M signers** (contracts
   already support it) with HSM-held keys, and a **real vol/forward data source** (SVI fit
   from Deribit/Binance options, or a vendor like Block Scholes; Stork is the Rysk approach).
3. **Anchor settlement to Pyth/Chainlink.** Settlement still uses the signed forward print
   (`LyraForwardFeed` wraps `LyraSpotFeed`). Anchor the expiry print to Pyth/Chainlink TWAP —
   this is the number that moves money (cf. the KiloEx oracle exploit).
4. **Diff-audit.** Sigma Prime audited the forked base; our deltas (PythSpotFeed adapter,
   deploy/config changes) are new code and should get a focused review.
5. **MM onboarding.** Collect real market-maker addresses for `MAKER_ALLOWLIST`; have ≥1 MM
   quote on testnet through the docs for a week of adversarial use before real money.
6. **Real tokens + config.** Use canonical BSC BTCB/USDT addresses (both 18 decimals);
   set sane caps/margin params; decide premium-leg stablecoin (USDT vs USD1/FDUSD).
7. **Gasless UX** (optional but planned): wire MegaFuel paymaster + EIP-7702 for sponsored
   plain-EOA transactions (replaces what was Derive's bundler/paymaster).
8. **Service hosting**: rfq-engine + oracle-feeds (+ pyth-push loop) + maker-bot need a host
   with TLS/wss (reverse proxy) and monitoring; durable store path configured.
9. **Docs publish**: connect Mintlify GitHub app to the repo, content dir `docs-site/`
   (hobby tier, `*.mintlify.app`). Steps in `docs-site/README.md`.

**Near-term build items (can proceed on testnet now):**
- Finish the browser walkthrough / demo GIF.
- Settlement rehearsal for the live position (instrument expires **2026-06-19 08:00 UTC**;
  `oracle-feeds settle --expiry 1781856000 --price <fix> --subaccounts 5,6`).
- Add cash-secured puts (nearly free on the deployed contracts — put seller deposits USDT
  into the same CashAsset, sells via the same RfqModule; mostly frontend + config).
- Deploy the ETH market to testnet via `AddMarket.s.sol` to exercise multi-asset.
- pyth-push as a proper daemon / pre-trade hook (not a one-shot loop).

---

## 7. Phase roadmap
1. **Phase 1 (current)**: covered calls + RFQ, fully collateralized, BTC only, BSC testnet → mainnet.
2. **Phase 2**: cash-secured puts; cash-settled margin trading (SRM margin + DutchAuction
   liquidations — DutchAuction is deployed, dormant); more underlyings (ETH, BNB).
3. **Phase 3**: optional CLOB via the dormant TradeModule + own matching engine; portfolio
   margin (rebuild vs license PMRM_2 vs wait until 2029); broker/builder-fee distribution program.
