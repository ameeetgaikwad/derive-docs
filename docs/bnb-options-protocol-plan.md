# BNB On-Chain Options Protocol — Decision Memo & Build Plan

_Researched June 2026. Sources: Derive (derivexyz) GitHub repos + docs, Rysk V12 docs/GitHub, BNB Chain 2026 roadmap, Sigma Prime audit reports._

## Decision: build directly on BNB Chain L1 (BSC). Not our own L2, not opBNB.

| Option | Verdict | Why |
|---|---|---|
| **Own OP-stack L2 (Derive-style)** | No | Derive only needed a private chain because PMRM portfolio-margin checks burn 1–60M gas per trade, forcing a 400 Mgas/s gas target and their own sequencer. An RFQ options protocol doesn't need that. An app-chain costs sequencer ops, bridge liquidity bootstrapping, and MM onboarding friction — and forfeits BNB-native distribution, which is the strategic reason for this move. Aster did $1T+ perp volume on BNB L1 before graduating to its own chain. |
| **opBNB** | No | Alive (250ms blocks post-Fourier) but repositioned as the consumer/gaming lane; ~$20M DeFi TVL, no MM presence, no BTCB/USDT depth, bridge friction. BSC L1 is now nearly as fast and as cheap. |
| **BNB L1 (BSC)** | **Yes** | Post-Fermi (Jan 2026): 0.45s blocks, ~1.1s finality, 0.05 gwei gas. Gasless UX via **MegaFuel paymaster** (sponsors plain-EOA txs, no 4337 migration) + **EIP-7702** (batched approve+trade, live since Pascal). All liquidity (BTCB, ~$14B stables, USDT ~60%), all oracles, MM hedging venues. Options are white space on BNB — no major live options protocol. Grant leverage: BNB Grant Program (≤$200K), MVB accelerator, Kickstart. |

Revisit own-chain only if/when we evolve into sub-100ms cross-margined CLOB territory — roughly when BNB's planned "1M TPS / 150ms trading chain" may exist as a landing zone anyway.

## Fork strategy: Derive v2 contracts (legally cleared paths only)

Derive's stack is the best forkable foundation — clean Foundry/Solidity 0.8.27 + OpenZeppelin, **zero L2-specific dependencies** (no OP predeploys, no precompile calls in deployed contracts, timestamp-based not block-based; v2-matching even ships a Base deployment folder). Audited by **Sigma Prime** (reports public at github.com/sigp/public-audits/tree/master/reports/derive).

### Licensing map (verified from LICENSE files, June 2026)

| Code | License | Use |
|---|---|---|
| `derivexyz/v2-core` **at last commit before 2025-02-17** | BUSL-1.1 whose Change Date (2025-11-16) has **passed → now GPL-3.0-or-later** | **Fork this snapshot.** Includes everything we need: SubAccounts, CashAsset, OptionAsset, PerpAsset, WrappedERC20Asset, StandardManager (SRM), PMRM v1, DutchAuction, SecurityModule, InterestRateModel, all Lyra signed feeds. |
| `v2-core` commits **on/after 2025-02-17** (PMRM_2, PMRM_2_1, OZ upgrade, recent scripts) | BUSL-1.1 until **2029-03-20** | Off-limits for production. Avoid, or negotiate a commercial license with Lyra Foundation. |
| `derivexyz/v2-matching` (current) | AGPL-3.0 | **Fork.** Matching, ActionVerifier, TradeModule, **RfqModule**, Deposit/Withdraw/Transfer modules, **CCTSA covered-call vault** (GPL-3.0-headered). ⚠️ 3 files headered `UNLICENSED` despite repo AGPL — `LiquidateModule.sol`, `CollateralManagementTSA.sol`, `TSAShareHandler.sol` → counsel review or clean-room rewrite. |
| `derivexyz/derive-utils` (math libs) | AGPL-3.0 | Fork. |
| `derivexyz/cockpit` (Rust exchange client, MM algos) | MIT | Use freely as MM SDK / executor skeleton. |
| `v2-aa`, `orderbook-stubs`, `v2-action-signing-python` | No license (all rights reserved) | Don't fork; reimplement. |
| Derive's off-chain matching engine | Closed source | Build our own (RFQ-first makes this small). |
| Rysk V12 contracts | Not published | Not forkable. Their MM tooling (`ryskV12-cli`, MIT) is a good RFQ-UX reference. |

GPL/AGPL grant no trademark rights — full rebrand required. AGPL copyleft means publishing our modifications to matching-layer code (fine — verified on-chain source anyway; applies to derivative off-chain works of that code).

## Product & architecture

**V1 = covered calls + RFQ rail, built on the full-protocol foundation** (subaccounts + modules from day one, so the same rails grow into a complete exchange).

Collateral model: **fully collateralized first** (Robinhood-style — the underlying is escrowed, premium paid upfront, no liquidation engine needed for covered positions). Cash-settled margin trading comes in Phase 2 using SRM + DutchAuction.

### On-chain (BNB L1)
- **Accounts**: SubAccounts (ERC-721) owned by the Matching contract; users sign EIP-712 Actions with session keys (same scheme the frontend already implements).
- **Assets**: WrappedERC20Asset for **BTCB** collateral; CashAsset on **USDT** (premium/settlement leg; USDC/USD1 optional later); OptionAsset for the option balances.
- **Risk**: StandardManager (SRM) only at launch — light gas, fine on shared blockspace. PMRM v1 (GPL snapshot) later with position caps; PMRM_2 path blocked until 2029 or licensed.
- **Execution**: Matching + **RfqModule** (multi-leg block trades) — no resting orderbook on day one. TradeModule ships dormant for the CLOB phase.
- **Covered-call product**: fork **CCTSA** (tokenized covered-call subaccount) or drive per-user subaccounts directly from the existing frontend flow.

### Oracles
- Derive's signed-feed pattern (BaseLyraFeed, now GPL): N-of-M whitelisted signers, heartbeats, confidence scores. We run the signer service.
- Vol/forward surface (SVI, 5 params/expiry) from Block Scholes or Amberdata, or self-fit.
- Anchor spot to **Chainlink** (or Pyth/RedStone) on BSC; settlement = 30-min TWAP print at expiry, Derive-style. Avoid Binance Oracle (migrating to Atlas).

### Off-chain services (we build)
1. **RFQ engine**: WebSocket service — user requests quote (asset/strike/expiry/size), lined-up MMs stream signed quotes, best bid wins, executor submits `Matching.verifyAndMatch` on-chain. Rysk-style streaming first-price auction; far smaller than a CLOB.
2. **Executor/poster**: batches matches, piggybacks signed oracle updates onto trades (Derive's `_processManagerData` pattern); submit via a private relay (bloXroute/48Club) to avoid public-mempool MEV.
3. **Settlement cron**: expiry detection, ITM physical settlement, premium distribution (the repo's stubbed `settlement-service.ts` becomes real).
4. **MM SDK**: fork `cockpit` (MIT, Rust) + the action-signing scheme; mirror Rysk's `wss://…/rfqs/<asset>` + `wss://…/maker` interface shape.

### Gasless UX
MegaFuel sponsor policies (we sponsor deposit/trade/settle tx types) + EIP-7702 batched approve+deposit+trade. Replaces Derive's Conduit bundler/paymaster — the frontend's paymaster plumbing gets repointed, not rewritten.

### Order-flow monetization
- V1: RFQ flow sold to committed MMs (taker-side fees; Derive charges options takers `$0.5 + min(0.03% notional, 12.5% premium)`, makers `min(0.01%, 12.5% premium)` — good starting template).
- Later: Derive's **API Broker** (10–50% fee share by volume tier) + **Builder Fee** (per-order `extra_fee` pass-through) model for B2B2C distribution — relevant for Whop-style embedded distribution.

## Frontend migration (this repo)

Per the codebase review: ~70 files (all React components, APR math, wagmi/RainbowKit, Zustand stores) port as-is; ~30 files in `/src/lib/derive/*` + hooks need repointing — same EIP-712 Action schema (we keep it), new domain separator/addresses/chain ID 56, our REST/WS endpoints instead of `api.lyra.finance`, MegaFuel instead of Derive paymaster, no Socket bridge (native BTCB). The existing `useRFQ.ts` hook maps directly onto the new RFQ engine.

## Phases

1. **Phase 0 (1–2 wks)** — Counsel sign-off (GPL snapshot date, 3 UNLICENSED matching files, AGPL obligations, rebrand). Pin fork commits. Apply to BNB Kickstart/MVB + MegaFuel sponsorship.
2. **Phase 1 (6–10 wks)** — Covered-call RFQ MVP on BSC testnet → mainnet: SubAccounts/assets/SRM/Matching/RfqModule deploy, signed feeds + Chainlink anchor, RFQ engine + executor + settlement cron, MM onboarding (committed MMs), frontend repoint. Diff-audit on our changes (Sigma Prime audited the base).
3. **Phase 2** — Cash-settled options + margin: SRM margin trading, DutchAuction liquidations, SecurityModule, more underlyings (BNB, ETH), put-selling.
4. **Phase 3** — CLOB via TradeModule + own matching engine (or stay RFQ), portfolio margin (rebuild vs license PMRM_2 vs wait for 2029), broker/builder-fee program.

## Key risks
- **Licensing precision**: the GPL conversion applies only to pre-2025-02-17 v2-core code; fork hygiene matters (pin the commit, don't cherry-pick from master). Counsel must clear the 3 UNLICENSED files.
- **Oracle integrity**: we become the vol-feed operator; HSM keys, N-of-M signers, monitoring. KiloEx's $7M oracle exploit on opBNB is the cautionary tale.
- **Public-mempool MEV** on executor txs → private relay from day one.
- **PMRM gas** on shared blockspace when we get to portfolio margin → position caps, or revisit chain question then.
