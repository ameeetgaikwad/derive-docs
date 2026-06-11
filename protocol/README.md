# Hedge protocol — deployment workspace

Foundry workspace that deploys and wires the full Hedge v1 on-chain system
(BTC covered calls sold to market makers via RFQ), built entirely from the vendored,
pinned, read-only sources in `lib/v2-core` and `lib/v2-matching` (see `PROVENANCE.md`).

## One-command deploy (anvil)

```sh
# terminal 1 — vanilla anvil (default port 8545)
anvil

# terminal 2 — deploy everything (uses anvil's well-known key 0 by default)
cd protocol
forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

That's it. All addresses (plus the Matching EIP-712 domain separator, action typehash
and chainId) are written to `deployments/31337.json` with flat, descriptive keys.

The RPC is always a parameter — to avoid port collisions you can run anvil on any
port (e.g. `anvil --port 8587`) and pass `--rpc-url http://127.0.0.1:8587`.

### Environment variables (all optional on anvil)

| Var | Default | Meaning |
|---|---|---|
| `PRIVATE_KEY` | anvil well-known key 0 | deployer / owner of everything |
| `FEED_SIGNER` | deployer address | 1-of-1 signer registered on every signed feed |
| `TRADE_EXECUTOR` | deployer address | address allowed to call `Matching.verifyAndMatch` |
| `BTCB_ADDRESS`, `USDT_ADDRESS` | — (required when chainId != 31337) | real 18-decimal token addresses |

### BSC testnet (97) stub

`foundry.toml` ships an `bsc_testnet` RPC alias. Mocks are anvil-only; on any other
chain the script requires `BTCB_ADDRESS` / `USDT_ADDRESS` env vars (both must be
18 decimals — BTCB and BSC USDT are) and writes `deployments/97.json`:

```sh
PRIVATE_KEY=0x... BTCB_ADDRESS=0x... USDT_ADDRESS=0x... \
forge script script/DeployAll.s.sol --rpc-url bsc_testnet --broadcast
```

## What gets deployed

- 18-decimal mock `BTCB` + `USDT` with open `mint(address,uint)` (chainId 31337 only)
- `SubAccounts`, `InterestRateModel` + `CashAsset` (USDT), `SecurityModule`,
  `DutchAuction` (required by the SRM constructor), `SRMPortfolioViewer`,
  `StandardManager` (SRM)
- Signed feeds, all 1-of-1 with `FEED_SIGNER`: USDT stable `LyraSpotFeed`, and the BTC
  market's `LyraSpotFeed`, `LyraForwardFeed`, `LyraVolFeed`, `LyraRateFeed`
- BTC market on the SRM: `OptionAsset` (settling against the forward feed) +
  `WrappedERC20Asset` (BTCB) whitelisted, oracles registered, margin params / oracle
  contingency / caps / OI fees copied from the vendored deployment configs
  (`lib/v2-core/scripts/config-mainnet.sol`, `deploy-srm-option-only-market.s.sol`)
- `Matching` + `DepositModule`, `WithdrawalModule`, `TransferModule`, `TradeModule`
  (dormant in v1), `RfqModule` (primary v1 execution path) — all whitelisted on
  Matching; trade executor registered; fee recipient subaccount created for the
  Trade/Rfq modules
- Settlement periphery: `OptionSettlementHelper` (whitelisted SRM callee) and
  `LyraSettlementUtils`; plus `SubAccountCreator`
- NOT deployed: `LiquidateModule` (UNLICENSED at this pin — pending counsel review,
  see `PROVENANCE.md`), perps (not needed for v1)

## EIP-712 signing facts (verified against vendored source)

- Domain: name `"Matching"`, version `"1.0"`, chainId, verifyingContract = `matching`
  (`lib/v2-matching/src/ActionVerifier.sol`); the computed `domainSeparator` is in the
  deployments JSON
- `Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)`
- Feeds use their own EIP-712 domains (e.g. `"LyraSpotFeed"`/`"1"`) with
  `FeedData(bytes data,uint256 deadline,uint64 timestamp)`

## Smoke check

```sh
# after deploying:
J=deployments/31337.json; RPC=http://127.0.0.1:8545
cast call $(jq -r .matching $J) "allowedModules(address)(bool)" $(jq -r .rfqModule $J) --rpc-url $RPC   # true
cast call $(jq -r .standardManager $J) "getMarketFeeds(uint256)(address,address,address)" 1 --rpc-url $RPC
cast call $(jq -r .cashAsset $J) "wrappedAsset()(address)" --rpc-url $RPC                                # == .usdt
```

## Layout

```
foundry.toml          # remappings into lib/v2-core + lib/v2-matching pinned submodules
script/DeployAll.s.sol  # the whole system, one script (GPL-3.0-or-later)
script/mocks/MockERC20.sol
deployments/<chainId>.json
lib/                  # vendored, READ-ONLY (see PROVENANCE.md)
```

Note: `solc 0.8.20` / `evm_version shanghai` / explicit remappings match the vendored
repos. OpenZeppelin resolves to v2-matching's pin (4.8.3) for all sources — the same
combination upstream v2-matching uses to compile its v2-core submodule (== our
`lib/v2-core` pin), keeping cross-repo interface types identical.
