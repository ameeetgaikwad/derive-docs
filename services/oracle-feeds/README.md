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
Feed addresses used: `btcSpotFeed`, `btcForwardFeed`, `btcVolFeed`, `btcRateFeed`, `stableFeed`;
settlement also uses `standardManager`, `btcOptionAsset`, `subAccounts`, `cashAsset`, `btcBaseAsset`.

### Environment

| Var | Default | Meaning |
|---|---|---|
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `CHAIN_ID` | `31337` | 31337 (anvil), 97, 56 |
| `FEED_SIGNER_KEY` | anvil key #0 on 31337, required elsewhere | must match the feed's whitelisted signer (`feedSigner` in the deployments file) |
| `FEED_SIGNER_KMS_KEY_ID` | — | production feed-signing KMS key; preferred over a raw key |
| `FEED_DEADLINE_SEC` | `3600` | signature deadline horizon |
| `INTERVAL_SEC` | `30` | Pyth refresh cadence; daemon rejects values >= its 60-second staleness limit |
| `FEED_INTERVAL_SEC` | `120` | signed BTC snapshot cadence; daemon rejects values >= the 180-second spot heartbeat |
| `EXPIRY_COUNT` | `4` | number of >24h Friday expiries exposed for new trades |
| `PRICE_SOURCE` | `static` | `static` (uses `SPOT_PRICE`) or live `chainlink` BTC/USD |
| `SPOT_PRICE` | — | decimal spot for the static source, e.g. `100000` |
| `CHAINLINK_AGGREGATOR` | — | AggregatorV3 address for `PRICE_SOURCE=chainlink` |
| `STABLE_PRICE_SOURCE` | `static` on anvil; required elsewhere | `static` for local/testnet or `chainlink` for a live source; static is rejected on chain 56 |
| `STABLE_PRICE` | `1` on anvil | decimal stable price required by `STABLE_PRICE_SOURCE=static` |
| `STABLE_FEED_INTERVAL_SEC` | `300` | stable update cadence; must remain below its 3600-second heartbeat |
| `STABLE_CHAINLINK_AGGREGATOR` | — | USDT/USD AggregatorV3 required by `STABLE_PRICE_SOURCE=chainlink` |
| `STABLE_CHAINLINK_MAX_STALE_SEC` | `3600` | maximum accepted Chainlink round age |
| `PYTH_PUSHER_KMS_KEY_ID` / `PYTH_PUSHER_PRIVATE_KEY` | feed signer account | separately funded Pyth submitter; it does not need a feed role |
| `ORACLE_DISCOVERY_FROM_BLOCK` | auto-detected | SubAccounts deployment block; set explicitly when the RPC cannot serve historical `eth_getCode` |
| `ORACLE_DISCOVERY_CONFIRMATIONS` | `6` on BSC, `0` on anvil | finalized-block lag for the active-position index |
| `ORACLE_DISCOVERY_BLOCK_CHUNK` | `2000` | `BalanceAdjusted` log replay chunk size |
| `ORACLE_DISCOVERY_INTERVAL_SEC` | `15` | active-position index refresh cadence |
| `ORACLE_STATE_PATH` | `.data/active-expiries.<chain>.json` | durable active-position checkpoint path |
| `ORACLE_TWAP_STATE_PATH` | `.data/settlement-twap.<chain>.json` | durable 30-minute settlement-TWAP accumulator path |
| `ORACLE_ALLOW_LATE_TWAP_BACKFILL` | `false` on chain 56, `true` elsewhere | permit a warned current-price backfill after starting inside the TWAP window |
| `ORACLE_EXTRA_EXPIRIES` | — | comma-separated break-glass additions; never the primary discovery path |
| `ORACLE_MAX_EXPIRIES` | `32` | reviewed capacity limit; exceeding it fails closed instead of dropping a series |
| `ORACLE_BATCH` | `true` on BSC | atomic Multicall3 signed snapshots; disabling is for diagnosis only |
| `ORACLE_ALLOW_UNBATCHED` | `false` | reviewed chain-56 incident override when Multicall3 must be bypassed |
| `DERIBIT_ALLOW_FLAT_FALLBACK` | `false` on chain 56, `true` elsewhere | whether a missing/unfittable Deribit surface may use flat 60% IV |
| `AUTO_SETTLE` | `false` | automatically fix anchored settlement and settle indexed accounts after expiry |
| `SETTLEMENT_INTERVAL_SEC` | `60` | expired-series worker cadence |
| `SETTLEMENT_RETRY_SEC` | `300` | cooldown while confirmed zero-balance events catch up |

All prices/rates/IVs are decimal strings on the CLI and 18dp bigints internally.
Timestamps come from the **latest block** (anvil time warps are respected).

## One-shot snapshot (what e2e uses)

Post stable $1, BTC spot $100k, plus forward / 5% rate / flat 60%-IV SVI surface for a 7-day expiry:

```sh
STABLE_PRICE_SOURCE=static STABLE_PRICE=1 \
  pnpm --filter @hedge/oracle-feeds post -- \
  --spot 100000 --expiry 1786000000 --iv 0.6 --rate 0.05
```

- `--expiry` is repeatable; `--forward` overrides the forward price (defaults to spot).
- The flat surface uses SVI `b = 0`, `a = iv^2 * tau`, `refTau = annualise(expiry - now)`
  (365-day year, per `lyra-utils/Black76.annualise`), so `SVI.getVol` returns the
  requested IV at every strike.

## Interval daemon

```sh
STABLE_PRICE_SOURCE=static STABLE_PRICE=1 \
  pnpm --filter @hedge/oracle-feeds dev
```

The daemon runs independent schedules for Pyth (`INTERVAL_SEC`), the signed BTC
snapshot (`FEED_INTERVAL_SEC`), and stable price (`STABLE_FEED_INTERVAL_SEC`). A
failure in one schedule does not suppress the others. Writes made by the same
account pass through a FIFO transaction queue so concurrent schedules cannot
race nonces. A separate `PYTH_PUSHER_*` account removes even that small shared
transaction boundary. Swap in the
Chainlink-on-BSC BTC source with
`PRICE_SOURCE=chainlink CHAINLINK_AGGREGATOR=0x...`; configure a live stable
source separately with
`STABLE_PRICE_SOURCE=chainlink STABLE_CHAINLINK_AGGREGATOR=0x...`.

The package's `dev` script deliberately keeps `--source deribit`: Deribit supplies
the BTC forward and volatility surface used for option quoting, while Pyth remains
the StandardManager's live BTC spot source.

### Expiry coverage invariant

Oracle coverage is not limited to the expiries currently visible in the UI. On
startup the daemon replays finalized `SubAccounts.BalanceAdjusted` events for the
deployed BTC option asset, then checkpoints every non-zero `(account, subId)`
balance. Every signed update posts the sorted union:

```text
frontend tradeable expiries
  U expiries with confirmed non-zero option balances
  U ORACLE_EXTRA_EXPIRIES (break-glass only)
```

This is the durable fix for an old position becoming unpriceable after its
expiry leaves the frontend's `>24h` list. No expiry is removed because a clock
rolled forward. It leaves the live set only after settlement emits confirmed
zero `postBalance` events. State writes are atomic, the last finalized block hash
is checked on restart, and a reorg causes a full replay from the deployment
block. Mount both `.data` files on durable storage; do not share them between
multiple active writers without leader election.

On BSC, spot plus every forward/rate/vol update is signed at one observation
timestamp and submitted atomically through Multicall3. In the final 30 minutes,
the daemon persists and posts the rolling trapezoidal spot integral required by
`LyraForwardFeed`; a late tracker start is explicitly warned instead of being
hidden. Chain 56 also fails closed when Deribit has no usable surface rather than
inventing a flat volatility curve.

Before enabling quotes after a restart, run the read-only coverage check:

```sh
pnpm --filter @hedge/oracle-feeds status
```

It must list every held option and its expiry. For the chain-97 position that
originally exposed this bug, accounts `4` and `5` must keep expiry `1786089600`
in `active expiries` until their balances are settled to zero.

## Pyth push (`pyth-push`)

The BTC market on BSC testnet uses a `PythSpotFeed` adapter (`protocol/src/PythSpotFeed.sol`)
as the SRM spot feed: Pyth primary, Chainlink BTC/USD circuit breaker. Pyth is a pull
oracle — someone must land a signed Hermes update on-chain before `getSpot()` is fresh
(default staleness bound: 60s):

```sh
CHAIN_ID=97 RPC_URL=<rpc> PYTH_PUSHER_PRIVATE_KEY=<funded-key> \
  pnpm --filter @hedge/oracle-feeds pyth-push
```

Fetches the latest `Crypto.BTC/USD` update from Hermes (`HERMES_URL` env, default
`https://hermes.pyth.network`), quotes `IPyth.getUpdateFee`, submits
`updatePriceFeeds` with the fee attached, then reads `getSpot()` back through the
adapter. Defaults come from the deployments JSON keys `pyth`, `btcPythPriceId` and
`btcPythSpotFeed`; override with `--pyth`, `--price-id`, `--adapter`, `--hermes`.
The sender key only needs gas (no feed-signer whitelist involved).

## Settlement runner

On deployments with `btcSettlementFeed`, the default path is permissionless and
anchored to Chainlink round history, with the configured Pyth cross-check. After
chain time passes the expiry:

```sh
pnpm --filter @hedge/oracle-feeds settle -- \
  --expiry 1786000000 --subaccounts 4,5
```

Sequence:

1. reads or permissionlessly fixes the immutable anchored settlement price,
2. calls `StandardManager.settleOptions(btcOptionAsset, subaccount)` for every id
   (public, callable by anyone — verified in the vendored integration test),
3. prints resulting balances per subaccount (cash payout = `settlementPrice - strike`
   per ITM call, 0 if OTM).

`AUTO_SETTLE=true` applies that anchored path to expired accounts discovered by
the durable index. It is intentionally opt-in. The daemon never auto-invents a
signed settlement price. Plain-anvil/legacy deployments can still use the
explicit `--signed --price ...` CLI path for e2e testing.

## Library use

The package also exports `FeedPoster`, `SettlementRunner`, `ActiveExpiryIndex`,
`SettlementTwapTracker`, `flatIvSviParams`, `annualise` and the `PriceSource`
implementations for the e2e harness:

```ts
import { FeedPoster, feedAddressesFromDeployments } from "@hedge/oracle-feeds";
```
