# @hedge/oracle-feeds

Signed oracle feed poster (spot / forward / rate / SVI vol-surface) and option
settlement runner for the Hedge protocol.

Everything here is verified against the vendored source:

- `protocol/lib/v2-core/src/feeds/BaseLyraFeed.sol` — `FeedData(bytes data,uint256 deadline,uint64 timestamp)`
  EIP-712 struct, per-feed domains (`Lyra*Feed`, version `"1"`), whitelisted-signer check.
- `protocol/lib/v2-core/src/feeds/Lyra{Spot,Forward,Vol,Rate}Feed.sol` — inner `data` encodings.
- `protocol/lib/v2-core/src/feeds/LyraForwardFeed.sol` — settlement path: data with
  `timestamp == expiry` and TWAP aggregates such that
  `(currentSpotAggregate - settlementStartAggregate) / 30min == settlement price`.
- `protocol/lib/v2-core/test/integration-tests/standard-manager/settle-option.sol` —
  settlement sequence (`_setSettlementPrice` then `StandardManager.settleOptions`).

## Setup

```sh
pnpm install          # from services/
pnpm --filter @hedge/oracle-feeds build
pnpm --filter @hedge/oracle-feeds test   # smoke check (signing + SVI unit tests)
```

Requires `protocol/deployments/<chainId>.json` (written by the deploy script).
Feed addresses used: `btcSpotFeed`, `btcForwardFeed`, `btcVolFeed`, `btcRateFeed`;
settlement also uses `standardManager`, `btcOptionAsset`, `subAccounts`, `cashAsset`, `btcBaseAsset`.

### Environment

| Var | Default | Meaning |
|---|---|---|
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `CHAIN_ID` | `31337` | 31337 (anvil), 97, 56 |
| `FEED_SIGNER_KEY` | anvil key #0 on 31337, required elsewhere | must match the feed's whitelisted signer (`feedSigner` in the deployments file) |
| `FEED_DEADLINE_SEC` | `3600` | signature deadline horizon |
| `PRICE_SOURCE` | `static` | `static` (uses `SPOT_PRICE`) or `chainlink` (BSC stub) |
| `SPOT_PRICE` | — | decimal spot for the static source, e.g. `100000` |
| `CHAINLINK_AGGREGATOR` | — | AggregatorV3 address for `PRICE_SOURCE=chainlink` |

All prices/rates/IVs are decimal strings on the CLI and 18dp bigints internally.
Timestamps come from the **latest block** (anvil time warps are respected).

## One-shot snapshot (what e2e uses)

Post spot $100k plus forward / 5% rate / flat 60%-IV SVI surface for a 7-day expiry:

```sh
pnpm --filter @hedge/oracle-feeds post -- \
  --spot 100000 --expiry 1786000000 --iv 0.6 --rate 0.05
```

- `--expiry` is repeatable; `--forward` overrides the forward price (defaults to spot).
- The flat surface uses SVI `b = 0`, `a = iv^2 * tau`, `refTau = annualise(expiry - now)`
  (365-day year, per `lyra-utils/Black76.annualise`), so `SVI.getVol` returns the
  requested IV at every strike.

## Interval daemon

```sh
SPOT_PRICE=100000 pnpm --filter @hedge/oracle-feeds daemon -- \
  --interval 15 --expiry 1786000000
```

Reposts the snapshot every `--interval` seconds. Swap in the Chainlink-on-BSC
source with `PRICE_SOURCE=chainlink CHAINLINK_AGGREGATOR=0x...` (stubbed behind
the `PriceSource` interface for the testnet/mainnet rollout).

## Pyth push (`pyth-push`)

The BTC market on BSC testnet uses a `PythSpotFeed` adapter (`protocol/src/PythSpotFeed.sol`)
as the SRM spot feed: Pyth primary, Chainlink BTC/USD circuit breaker. Pyth is a pull
oracle — someone must land a signed Hermes update on-chain before `getSpot()` is fresh
(default staleness bound: 60s):

```sh
CHAIN_ID=97 RPC_URL=<rpc> FEED_SIGNER_KEY=<any funded key> \
  pnpm --filter @hedge/oracle-feeds pyth-push
```

Fetches the latest `Crypto.BTC/USD` update from Hermes (`HERMES_URL` env, default
`https://hermes.pyth.network`), quotes `IPyth.getUpdateFee`, submits
`updatePriceFeeds` with the fee attached, then reads `getSpot()` back through the
adapter. Defaults come from the deployments JSON keys `pyth`, `btcPythPriceId` and
`btcPythSpotFeed`; override with `--pyth`, `--price-id`, `--adapter`, `--hermes`.
The sender key only needs gas (no feed-signer whitelist involved).

## Settlement runner

After chain time passes the expiry (e2e warps anvil):

```sh
pnpm --filter @hedge/oracle-feeds settle -- \
  --expiry 1786000000 --price 120000 --subaccounts 4,5
```

Sequence:

1. posts a fresh spot (the cached one is stale after warping),
2. posts forward-feed settlement data (`timestamp == expiry`, aggregates that fix
   `getSettlementPrice(expiry)` to `--price`) — skipped if already settled or `--skip-feed`,
3. calls `StandardManager.settleOptions(btcOptionAsset, subaccount)` for every id
   (public, callable by anyone — verified in the vendored integration test),
4. prints resulting balances per subaccount (cash payout = `settlementPrice - strike`
   per ITM call, 0 if OTM).

## Library use

The package also exports `FeedPoster`, `SettlementRunner`, `flatIvSviParams`,
`annualise` and the `PriceSource` implementations for the e2e harness:

```ts
import { FeedPoster, feedAddressesFromDeployments } from "@hedge/oracle-feeds";
```
