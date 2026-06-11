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
