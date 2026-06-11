# @sats-options/shared

Shared TypeScript library for all sats-options services (rfq-engine, oracle-feeds,
maker-bot, e2e). Node 22 + pnpm + viem, strict TS, ESM.

Everything protocol-facing in here is verified against the vendored, pinned
Solidity at `protocol/lib/v2-matching` and `protocol/lib/v2-core` (see
`protocol/PROVENANCE.md`) — not against Derive's production deployment, whose
encodings differ in places.

## What's inside

- **`src/abis/`** — generated `as const` ABIs extracted from the vendored forge
  artifacts (`scripts/extract-abis.mjs`): Matching, ActionVerifier, the five
  modules (Rfq/Trade/Deposit/Withdrawal/Transfer), SubAccounts, CashAsset,
  OptionAsset, WrappedERC20Asset, StandardManager, InterestRateModel,
  SecurityModule, the four Lyra feeds, ERC20 + MockERC20.
- **`src/constants.ts`** — EIP-712 domains/typehashes:
  - Matching domain: `name="Matching"`, `version="1.0"` (ActionVerifier.sol).
  - `ACTION_TYPEHASH` for `Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)`.
  - Feed domains: `LyraSpotFeed/LyraForwardFeed/LyraVolFeed/LyraRateFeed`, version `"1"`,
    `FeedData(bytes data,uint256 deadline,uint64 timestamp)`.
- **`src/actions.ts`** — `buildAction`, `signAction` (any viem account with
  `signTypedData`), digest helpers, and module data encoders:
  `encodeDepositData`, `encodeWithdrawData`, `encodeTransferData`,
  `encodeTradeData`, `encodeTradeOrderData`, `encodeManagerData`.
- **`src/rfq.ts`** — RfqModule encodings per `IRfqModule.sol`:
  `encodeRfqOrder` (maker), `encodeTakerOrder` + `hashRfqTrades`
  (`keccak256(abi.encode(trades))`), `encodeRfqFillData` (executor actionData),
  and `buildRfqActionPair` producing the `[makerAction, takerAction]` pair in
  the exact order `RfqModule.executeAction` expects.
- **`src/feeds.ts`** — `signFeedData` (multi-signer, returns bytes for
  `acceptData`) plus inner encoders `encodeSpotData`, `encodeForwardData`,
  `encodeVolData` (SVI), `encodeRateData`.
- **`src/instruments.ts`** — `encodeOptionSubId`/`decodeOptionSubId`
  (lyra-utils OptionEncoding bit layout: `isCall<<95 | (strike/1e10)<<32 | expiry`)
  and `instrumentName` (`BTC-20260617-110000-C`).
- **`src/deployments.ts`** — `readDeployments(chainId)` for
  `protocol/deployments/<chainId>.json` (loosely typed; returns `null` if the
  contracts track hasn't produced it yet). Override dir with `SATS_DEPLOYMENTS_DIR`.
- **`src/clients.ts`** — viem public/wallet client factories. Env: `RPC_URL`
  (default `http://127.0.0.1:8545`), `CHAIN_ID` (default `31337`; also 97/56).
- **`src/units.ts`** — `toUnit` / `fromUnit` / `toTokenAmount` (18dp on BNB for
  both BTCB and USDT).

## Commands

```sh
pnpm install        # from services/
pnpm build          # regenerates src/abis from forge artifacts, then tsc
pnpm test           # vitest: typehash-vs-bytecode, subId round-trip, sign+recover, rfq/feed encodings
pnpm smoke          # build + test
```

ABI extraction requires the vendored repos to be `forge build`-built
(`protocol/lib/*/out` present); they are at the pinned commits.
