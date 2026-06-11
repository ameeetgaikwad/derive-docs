# sats-options — BNB on-chain options protocol (build spec)

Goal: a fully on-chain options protocol on BNB Chain, forked from Derive v2 (see PROVENANCE.md),
launching as **fully-collateralized BTC covered calls sold to market makers via RFQ**.
This spec coordinates the initial build. Working name: `sats-options` (rebrand later).

## Repo layout

```
protocol/
  lib/v2-core        # vendored, pinned, READ-ONLY (GPL snapshot)
  lib/v2-matching    # vendored, pinned, READ-ONLY (AGPL)
  foundry.toml       # our foundry workspace (remappings into lib/)
  script/            # OUR deploy scripts (Deploy*.s.sol) — GPL-3.0 headers
  deployments/       # addresses JSON per chain (31337 = anvil, 97 = BSC testnet, 56 = BSC)
services/
  shared/            # TS package: ABIs, EIP-712 action signing, RFQ encoding, viem clients
  rfq-engine/        # WS/REST RFQ auction service + on-chain executor
  oracle-feeds/      # signed feed poster (spot/forward/vol) + settlement runner
  maker-bot/         # reference market-maker (Black-76 pricing, auto-quoting)
  e2e/               # end-to-end test harness scripts
```

## Architecture (target)

- **On-chain** (all from vendored source, deployed by our scripts): SubAccounts, CashAsset (USDT),
  WrappedERC20Asset (BTCB collateral), OptionAsset (BTC options), StandardManager (SRM) with the BTC
  market registered, the Lyra signed feeds (spot / forward / vol / rate / perp not required for v1),
  Matching + modules: DepositModule, WithdrawalModule, TransferModule, **RfqModule** (primary v1
  execution path), TradeModule (deployed but dormant). InterestRateModel + SecurityModule as required
  by CashAsset/SRM constructors.
- **Off-chain**: rfq-engine (maker WS channel streams RFQs, makers respond with signed quotes, best
  bid wins, executor submits `Matching.verifyAndMatch`), oracle-feeds (signs + posts feed data; runs
  settlement at expiry), maker-bot (reference counterparty).
- **Users sign EIP-712 Actions directly with EOAs** in v1 (no AA / session keys on anvil). The
  existing frontend code at `src/lib/derive/signing.ts` is a working reference for the Action
  typehash and signing flow — the same scheme, our domain/addresses.

## Hard requirements

1. Vendored `protocol/lib/*` is read-only. All our code lives outside it.
2. Verify everything against the vendored source — do NOT trust memory of Derive's deployed system.
   E.g. check the EIP-712 domain in `v2-matching/src/Matching.sol` / `ActionVerifier.sol`, the RFQ
   order encoding in `v2-matching/src/modules/RfqModule.sol`, feed data formats in
   `v2-core/src/feeds/*.sol`. The vendored `test/` dirs contain full integration setups
   (deployment helpers, mocks) — mine them for correct wiring/parameters.
3. Token decimals on BNB: **BTCB and BSC USDT are both 18 decimals** (unlike WBTC/USDC). Mocks on
   anvil must use 18 decimals; conversion handled via the contracts' decimal-conversion paths.
4. TypeScript services: Node 22, pnpm, viem (NOT ethers), strict TS, each service a small standalone
   package with `pnpm dev` + a README. Shared logic only in `services/shared`.
5. Chains: anvil (31337) is the acceptance target now; BSC testnet (97) config stubs alongside.
6. Every component must be runnable with one documented command and pass its own smoke check.

## E2E acceptance (services/e2e, run on anvil)

1. `anvil` up → deploy script runs clean → `protocol/deployments/31337.json` written.
2. oracle-feeds posts spot (e.g. $100k), forward, and a vol surface for a 7-day expiry.
3. Maker + taker EOAs funded with mock BTCB/USDT; both open subaccounts under Matching.
4. Taker deposits 1 BTCB (covered-call collateral); maker deposits USDT.
5. Taker requests a quote: sell 1x BTC call, strike $110k, 7-day expiry. maker-bot streams back a
   signed quote (Black-76 premium). rfq-engine executes via RfqModule.
6. Assert on-chain: taker option balance −1, maker +1, premium moved in cash, SRM margin checks pass.
7. Warp past expiry, post settlement price, settle the option; assert correct physical/cash outcome
   for both ITM and OTM scenarios (run both).
8. Full run scripted: `services/e2e` README documents the one-command run; results in `protocol/E2E.md`.
