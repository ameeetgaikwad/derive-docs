# BSC Testnet deployment (chainId 97)

Deployed 2026-06-11. All addresses in [`deployments/97.json`](deployments/97.json).

| Contract | Address |
|---|---|
| Matching | `0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285` |
| RfqModule | `0x2769E33b2169C83304cEa0c5C8fbC5a1707E305D` |
| SubAccounts | `0x99cE5Aa19B39a023A62cD70fe68712825Ad8cAD0` |
| StandardManager (SRM) | `0x4d55A929e184fc366664C11526E3B54aB70340B5` |
| CashAsset (USDT) | `0x5d9e4EbD7E28deEF6f9A1a89Ed7Ce8608EE9074F` |
| BTC OptionAsset | `0xD0dD8DcA596540F615e66E07F49d40647D8bC6eD` |
| BTCB base asset | `0xc17EbE645aca587d7D2077097D797133FE2a633e` |
| Mock BTCB (18 dec, open mint) | `0x32fCF6a260Cdd2A3dc79cD0d4aD6B6c46bF6798A` |
| Mock USDT (18 dec, open mint) | `0x9896AF08d261E52a629EF58cBebd32E8e0AA8eA9` |
| PythSpotFeed (BTC, live SRM spot feed) | `0xaAc2C29105928A6fe7788956058bcF3B9A3D5E51` |
| LyraSpotFeed (BTC, signed — kept as fallback) | `0x69662A47C3C2626EB75a8c861C48a0a87Cb01b2C` |

- EIP-712 domain separator: `0x4cc5ab9a5a9e3993fe20da61e691a365b4b67a1339557e5b0437ba83097c84b5` (verified on-chain)
- Feed signer: `0xdE50B8E965aD2B8E25f45a19FD87A2d2c737782F` (1-of-1, testnet only)
- Trade executor / deployer / feed poster: `0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB`
- RPC: `https://bsc-testnet.bnbchain.org` or thirdweb (key required); explorer: https://testnet.bscscan.com

Test tokens: `MockERC20.mint(address,uint256)` is **unrestricted** on both mocks — mint yourself
BTCB/USDT freely. Testnet-only convenience; real BTCB/USDT on mainnet.

To run the services against testnet, set in each service env:
`CHAIN_ID=97`, `RPC_URL=<rpc>`, `DEPLOYMENTS_PATH=protocol/deployments/97.json`, plus the
relevant keys (executor for rfq-engine, signer for oracle-feeds). See each service README.

Known testnet quirks:
- BSC testnet nodes mishandle EIP-1559 fee fields from forge — always broadcast with
  `--legacy --with-gas-price 200000000` (0.2 gwei).
- Public RPCs are flaky; prefer the thirdweb endpoint with `--retries 12 --delay 5`.

## OI fee fix (2026-06-12)

`SRMPortfolioViewer.OIFeeRateBPS` is — despite the name — a plain 18-decimal multiplier:
`fee = abs(delta) * forwardPrice * OIFeeRateBPS` (`BasePortfolioViewer.getAssetOIFee`),
floored by `BaseManager.minOIFee`. The deployed value `0.1e18` (taken from the vendored
`deploy-srm-option-only-market.s.sol`) therefore charged **10% of forward notional per
side** — that is the 6,279-USDT-per-side fee visible in the smoke trade below.

Changed on-chain via the owner setter `SRMPortfolioViewer.setOIFeeRateBPS(asset, rate)`:

| Asset | Old | New | Tx |
|---|---|---|---|
| BTC OptionAsset `0xD0dD...c6eD` | `0.1e18` (10%) | `0.001e18` (0.1%) | [`0xc15b5239...`](https://testnet.bscscan.com/tx/0xc15b5239f0c0fd70fd67c4657354a48cb5d1a11110823278b37188198249106f) |
| BTCB base asset `0xc17E...633e` | `0.1e18` (10%) | `0.001e18` (0.1%) | [`0xf889c1ea...`](https://testnet.bscscan.com/tx/0xf889c1ea3e9761065e757c496b9005c4cf186fb35dc7e4ad9f0739ac2dc212fc) |

Both read back as `1e15`. `minOIFee` stays `10e18` (10 USDT floor). The default in
`script/DeployAll.s.sol` (now `script/MarketDeployerBase.sol`) is fixed to `0.001e18`
for future deploys. Per-side fee is now `max(0.001 x forward notional, 10 USDT)`.

## Oracle stack (2026-06-12)

The BTC market's SRM **spot feed** is now a Pyth adapter with a Chainlink circuit
breaker (`protocol/src/PythSpotFeed.sol`, GPL-3.0-or-later):

- **Pyth primary**: reads `Crypto.BTC/USD`
  (`0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`) from the
  official Pyth contract on BSC testnet `0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb`
  (docs.pyth.network). Reverts if the Pyth price is older than `pythStaleness`
  (default **60s**) — push a fresh update before trading (see below). Pyth's
  confidence interval is translated to the protocol's `[0, 1e18]` confidence:
  `1e18 - conf/price`, floored at 0.
- **Chainlink circuit breaker**: cross-checks Chainlink BTC/USD on BSC testnet
  `0x5741306c21795FdCBb9b265Ea0255F499DFe515C` (8 decimals). If the Chainlink answer
  is non-positive, older than `chainlinkStaleness` (default 24h), or deviates from
  the Pyth price by more than `deviationThreshold` (default **1%** = `0.01e18`),
  the returned confidence is **zeroed**, tripping the SRM's oracle-contingency
  margin penalty. All params owner-settable (`setPythStaleness`,
  `setChainlinkStaleness`, `setDeviationThreshold`, `setChainlinkAggregator` —
  `address(0)` disables the breaker).
- **Signed feeds unchanged**: forward, vol, rate and the USDT stable feed remain the
  Lyra signed feeds (posted by `oracle-feeds`). `LyraForwardFeed` still wraps the
  original `LyraSpotFeed`, so **settlement is still the signed print** — anchoring
  settlement to Pyth/Chainlink is a follow-up.

Deploy/wire txs:

| Step | Tx |
|---|---|
| Deploy PythSpotFeed `0xaAc2C29105928A6fe7788956058bcF3B9A3D5E51` | [`0x360ebd0a...`](https://testnet.bscscan.com/tx/0x360ebd0a75b49a57d18180d5d7cdbac34323734e9a9d7fe609cfbeb0477295a3) |
| First Pyth push (`oracle-feeds pyth-push`, BTC = 62,944.82) | [`0xc8f487d1...`](https://testnet.bscscan.com/tx/0xc8f487d1279652681f464da116ca986e03f8fc3a588a83d6ff2a117bb23ae2e2) |
| SRM spot-feed swap (`setOraclesForMarket(1, pyth, fwd, vol)`) | [`0x92bb856e...`](https://testnet.bscscan.com/tx/0x92bb856ef6df366ac9927de473a4fbb2fac9837580ba2015beab2b574dda5bbf) |

Post-swap `getSpot()` through the adapter returned `62,944.820134510` with confidence
`0.99935e18` (Chainlink was 62,886.56 — 0.09% away, breaker quiet).

Refresh the Pyth price (required before trades whenever it is >60s stale):

```sh
CHAIN_ID=97 RPC_URL=<rpc> FEED_SIGNER_KEY=<any funded key> \
  pnpm --filter @hedge/oracle-feeds pyth-push
```

Swap back to the signed LyraSpotFeed (kept deployed/configured as fallback):

```sh
cast send 0x4d55A929e184fc366664C11526E3B54aB70340B5 \
  "setOraclesForMarket(uint256,address,address,address)" 1 \
  0x69662A47C3C2626EB75a8c861C48a0a87Cb01b2C \
  0x86b7148B69F3eFad27Af6d0d892d063D6a6C9e05 \
  0x5a892364cFBd8e725eC1e7af25855005C0E0f0aE \
  --private-key $PRIVATE_KEY --legacy --gas-price 200000000 --rpc-url $RPC_URL_97_THIRDWEB
```

New `deployments/97.json` keys: `pyth`, `btcPythPriceId`, `btcPythSpotFeed`,
`btcChainlinkAggregator`.

## Multi-market deploy scripts (2026-06-12)

Per-market config (underlying token, name, Pyth feed id, Chainlink aggregator, caps,
margin params) now lives in `script/MarketDeployerBase.sol` — `getMarketConfig(0)` = BTC
(the live market), `getMarketConfig(1)` = ETH (example). `DeployAll.s.sol` consumes
entry 0; `script/AddMarket.s.sol` deploys + registers one additional market against an
existing deployment (reads `deployments/<chainId>.json`, requires the SRM owner key):

```sh
MARKET_INDEX=1 WETH_ADDRESS=0x... forge script script/AddMarket.s.sol \
  --rpc-url $RPC_URL_97_THIRDWEB --broadcast --legacy --with-gas-price 200000000 \
  --retries 12 --delay 5
```

New market addresses are written to `deployments/<chainId>-<NAME>.json` (sidecar — the
main JSON is never rewritten). Validated on a fresh anvil deploy (ETH market id 2);
the live testnet stack was NOT redeployed.

## Live smoke trade (2026-06-11)

First live end-to-end covered-call trade on BSC testnet, run by the services stack
(`oracle-feeds` + `maker-bot` + `rfq-engine`) via `services/e2e/src/testnet-smoke.ts`
(the anvil acceptance harness adapted for a live chain: no deploy, no time warp, no
settlement stage). **All six stages passed.** All txs are legacy type with gasPrice
0.2 gwei (see quirks above); the services' viem clients now force this on chain 97
(`services/shared/src/clients.ts`).

### Trade

| | |
|---|---|
| Instrument | **BTC-20260619-69000-C** — 1x BTC call, strike 69,000, expiry `1781856000` (2026-06-19 08:00 UTC), subId `39614110892406511198553831168` |
| Direction | taker SELLS 1x (covered call, 1 BTCB collateral), maker buys |
| Trade tx | [`0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3`](https://testnet.bscscan.com/tx/0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3) (`Matching.verifyAndMatch`, block 112792281) |
| Premium | **378.586807763808053551 USDT** (maker-bot Black-76 on the on-chain feeds: theo 398.51 x 0.95 bid ratio) |
| OI fee | **6,279 USDT per side** (`max(0.1 x forward 62,790, 10)`), 12,558 total to fee-recipient subaccount 3 |
| Maker | EOA `0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8`, subaccount **5** (150,000 USDT cash deposited via `maker-bot --setup`) |
| Taker | EOA `0x5Deb87Dd07734d0cDc553BE1502825934514be0e`, subaccount **6** (1 BTCB via `WrappedERC20Asset.deposit`) |
| RFQ | id `501329a3-aa90-45cd-8607-f37f8439971d`, orderHash `0xda4e1328cc4e60399d45385c8e2ba93a8f255da3bcbaebf0be81c3b887adcdbd`, 8s auction, 1 quote |

Post-trade balances (asserted on-chain): taker option **-1**, maker option **+1**,
taker cash `-5,900.413192236191946449` (premium - OI fee, borrowing against the BTCB),
maker cash `143,342.413192236191946449` (150k - premium - OI fee), fee recipient
`12,558`. SRM initial margin: taker `29,333.99` >= 0, maker `143,342.41` >= 0.

### Feeds (signed by feed signer `0xdE50...782F`, posted by deployer)

BTC spot source: **CoinGecko** `simple/price` = **62,790 USD** (cross-checked against
Chainlink BTC/USD on BSC testnet `0x5741306c21795FdCBb9b265Ea0255F499DFe515C` =
63,200.785 — within ~0.7%). Strike = 69,000 ~= 110% of spot, rounded to 1,000.

| Feed | Value | Tx |
|---|---|---|
| BTC spot | 62,790 | [`0xf1adc8c1...`](https://testnet.bscscan.com/tx/0xf1adc8c1048f4d5bc7ba7e4c88fe685a1f131e9e6522efb5b708f4a7c7624afe) (re-posted pre-trade: [`0x65fd862e...`](https://testnet.bscscan.com/tx/0x65fd862eeb16753e4b39728d6daad4d662cd16fa64148632bcb934ec1d0916da)) |
| BTC forward(1781856000) | 62,790 | [`0x91f9f84e...`](https://testnet.bscscan.com/tx/0x91f9f84e51f874588a05cca92d0c7953a1d9328f2bae15003a30c36cd593ac70) |
| BTC rate(1781856000) | 5% | [`0x1c0117bd...`](https://testnet.bscscan.com/tx/0x1c0117bd47048597ee05a0014097acd5966ae92e507281cbc286103336644e1f) |
| BTC vol surface | flat 60% IV (SVI) | [`0x9f954e14...`](https://testnet.bscscan.com/tx/0x9f954e14f6d3300d48f4f01f2659dfc6a52bf6291a4aede6ecbf4a6901a24492) |
| USDT stable | 1.0 | [`0x0416d58f...`](https://testnet.bscscan.com/tx/0x0416d58f8beafe39dbce1db4652d4cef5bea3125b9a018367f0420fc2f4d7af5) |

All read back on-chain: `getSpot`/`getForwardPrice` exact, `getVol(69000)` ~= 0.6,
stable `getSpot` = 1.0.

### Setup txs

- Fund maker/taker 0.02 tBNB each: [`0xde0870b1...`](https://testnet.bscscan.com/tx/0xde0870b1a920c0bbee198dfda28d98961169f69dde3378f0d9b30f312bc6ed36), [`0xfafd1b13...`](https://testnet.bscscan.com/tx/0xfafd1b135698463aeba68e2d8da180a1c40246d9feaeeacb162f621d2d9157a6)
- Mint 200k mock USDT -> maker: [`0x5a90a831...`](https://testnet.bscscan.com/tx/0x5a90a8319c9dcb85d6edd3c64a22c08399705cfd4084e1a58f60542584382703); 1 mock BTCB -> taker: [`0xd56acb79...`](https://testnet.bscscan.com/tx/0xd56acb7919ece4b08bb8d4dc107b80d449d785a7916adeb11cc48fd08c256a71)
- Maker `maker-bot --setup` -> subaccount 5 + 150k USDT cash: [`0xbce40758...`](https://testnet.bscscan.com/tx/0xbce4075817f423532b14fab92409c12cb6ce1d109db11062f99ff414225d2676) (+ approve/deposit)
- Taker `Matching.createSubAccount(SRM)` -> subaccount 6: [`0x9dc7ec5c...`](https://testnet.bscscan.com/tx/0x9dc7ec5c23f3c3de563bc2dd6fda1c7318e7c7c1079c1d8228075779dd67a3b5); BTCB approve [`0x6e104a28...`](https://testnet.bscscan.com/tx/0x6e104a2888a5fded5fb6491bfb26414b6e04316941cb1be52da4e75391adce0f) + deposit [`0x218f55d0...`](https://testnet.bscscan.com/tx/0x218f55d0db2629be27e160c9371281729813751496882a31feaf1295cfbc3b11)

Notes:

- Subaccount 4 is an orphan (created by a maker `--setup` attempt whose USDT deposit
  hit a lagging RPC node; the retried setup produced subaccount 5). Empty, harmless.
- Run report: `services/e2e/.tmp/testnet-smoke.md`. Maker/taker keys appended to
  `protocol/.env` (`TESTNET_MAKER_*` / `TESTNET_TAKER_*`).
- Total cost: ~0.0405 tBNB from the deployer (0.04 of it the maker/taker gas funding).
- **Settlement will be run at expiry** (2026-06-19 08:00 UTC):
  `oracle-feeds settle --expiry 1781856000 --price <BTC fix> --subaccounts 5,6`.
