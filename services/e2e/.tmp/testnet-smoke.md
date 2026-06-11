# sats-options E2E acceptance run

**Result: PASSED**

- date: 2026-06-11T17:39:02.215Z
- chain: BSC testnet (chainId 97)
- command: tsx src/testnet-smoke.ts  (services/e2e)
- BTC spot: 62790 USD (CoinGecko simple/price (cross-check: Chainlink BTC/USD on BSC testnet = 63200.785))
- maker EOA: 0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8
- taker EOA: 0x5Deb87Dd07734d0cDc553BE1502825934514be0e
- winning premium: 378.586807763808053551 USDT
- OI fee per side: 6279 USDT
- trade tx: https://testnet.bscscan.com/tx/0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3
- maker subaccount: 5
- taker subaccount: 6
- expiry: 1781856000 (2026-06-19T08:00:00.000Z) — settlement to be run at expiry

## Stage 1: testnet context: deployments/97.json + domain separator — PASS

chainId 97 (BSC testnet), RPC OK; Matching domain separator verified (`0x4cc5ab9a5a9e3993fe20da61e691a365b4b67a1339557e5b0437ba83097c84b5`)
deployer `0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB` is the registered trade executor
option: BTC-20260619-69000-C — strike 69000 (~110% of spot 62790, source: CoinGecko simple/price (cross-check: Chainlink BTC/USD on BSC testnet = 63200.785)), expiry 1781856000 (2026-06-19T08:00:00.000Z), subId 39614110892406511198553831168

## Stage 2: feeds: LIVE spot / forward / rate / vol (+ USDT stable) — PASS

BTC spot source: CoinGecko simple/price (cross-check: Chainlink BTC/USD on BSC testnet = 63200.785) -> 62790 USD
- BTC spot = 62790: tx `[`0xf1adc8c1048f4d5bc7ba7e4c88fe685a1f131e9e6522efb5b708f4a7c7624afe`](https://testnet.bscscan.com/tx/0xf1adc8c1048f4d5bc7ba7e4c88fe685a1f131e9e6522efb5b708f4a7c7624afe)`
- BTC forward(1781856000) = 62790: tx `[`0x91f9f84e51f874588a05cca92d0c7953a1d9328f2bae15003a30c36cd593ac70`](https://testnet.bscscan.com/tx/0x91f9f84e51f874588a05cca92d0c7953a1d9328f2bae15003a30c36cd593ac70)`
- BTC rate(1781856000) = 0.05: tx `[`0x1c0117bd47048597ee05a0014097acd5966ae92e507281cbc286103336644e1f`](https://testnet.bscscan.com/tx/0x1c0117bd47048597ee05a0014097acd5966ae92e507281cbc286103336644e1f)`
- BTC vol surface flat IV = 0.6 (SVI): tx `[`0x9f954e14f6d3300d48f4f01f2659dfc6a52bf6291a4aede6ecbf4a6901a24492`](https://testnet.bscscan.com/tx/0x9f954e14f6d3300d48f4f01f2659dfc6a52bf6291a4aede6ecbf4a6901a24492)`
- USDT stable feed = 1.0: tx `[`0x0416d58f8beafe39dbce1db4652d4cef5bea3125b9a018367f0420fc2f4d7af5`](https://testnet.bscscan.com/tx/0x0416d58f8beafe39dbce1db4652d4cef5bea3125b9a018367f0420fc2f4d7af5)`
read-back OK: getSpot=62790, getForwardPrice=62790, getVol(strike)=0.59999999999999997, stable getSpot=1

## Stage 3: maker --setup (150k USDT cash) + taker subaccount (1 BTCB) — PASS

maker subaccount 5 reused from /Users/brahma/Projects/sats/derive/services/e2e/.tmp/maker-state.97.json (cash 150000 USDT already deposited)
- taker Matching.createSubAccount(SRM) -> subaccount 6: tx `[`0x9dc7ec5c23f3c3de563bc2dd6fda1c7318e7c7c1079c1d8228075779dd67a3b5`](https://testnet.bscscan.com/tx/0x9dc7ec5c23f3c3de563bc2dd6fda1c7318e7c7c1079c1d8228075779dd67a3b5)`
- taker BTCB.approve(WrappedERC20Asset): tx `[`0x6e104a2888a5fded5fb6491bfb26414b6e04316941cb1be52da4e75391adce0f`](https://testnet.bscscan.com/tx/0x6e104a2888a5fded5fb6491bfb26414b6e04316941cb1be52da4e75391adce0f)`
- taker WrappedERC20Asset.deposit(1 BTCB) — covered-call collateral: tx `[`0x218f55d0db2629be27e160c9371281729813751496882a31feaf1295cfbc3b11`](https://testnet.bscscan.com/tx/0x218f55d0db2629be27e160c9371281729813751496882a31feaf1295cfbc3b11)`
Balances — after setup:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | 0 | 1 | 0 |
| maker | 150000 | 0 | 0 |
| fee recipient (3) | 0 | 0 | 0 |


## Stage 4: rfq-engine + maker-bot up (against testnet) — PASS

rfq-engine healthy on http://127.0.0.1:3030 (executor = registered tradeExecutor 0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB)
maker-bot connected (prices from on-chain feeds: forward/vol/rate — no env overrides)

## Stage 5: RFQ auction: taker sells 1x BTC-69000-C (~7d) — PASS

- re-post BTC spot (3-minute heartbeat): tx `[`0x65fd862eeb16753e4b39728d6daad4d662cd16fa64148632bcb934ec1d0916da`](https://testnet.bscscan.com/tx/0x65fd862eeb16753e4b39728d6daad4d662cd16fa64148632bcb934ec1d0916da)`
RFQ `501329a3-aa90-45cd-8607-f37f8439971d` opened: BTC-20260619-69000-C, auction window 8s
winning quote: maker `0x5c9Ca4A3f39Cf36C968402C8E933cB2979882BF8` premium 378.586807763808053551 USDT (orderHash `0xda4e1328cc4e60399d45385c8e2ba93a8f255da3bcbaebf0be81c3b887adcdbd`)

## Stage 6: execute on-chain via RfqModule (Matching.verifyAndMatch) — PASS

Balances — before execution:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | 0 | 1 | 0 |
| maker | 150000 | 0 | 0 |
| fee recipient (3) | 0 | 0 | 0 |

- verifyAndMatch executed (block 112792281): tx `[`0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3`](https://testnet.bscscan.com/tx/0x2d5d7c88ca7ea1c7f8bf46760487c01331525666546903c41dda29d5c2d4d9d3)`
expected OI fee per side: 6279 USDT (rate 0.1 x forward 62790, min 10)
Balances — after execution:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | -5900.413192236191946449 | 1 | -1 |
| maker | 143342.413192236191946449 | 0 | 1 |
| fee recipient (3) | 12558 | 0 | 0 |

SRM initial margin (taker subaccount 6): 29333.995069739323594681 USDT (>= 0)
SRM initial margin (maker subaccount 5): 143342.413192236191946449 USDT (>= 0)

