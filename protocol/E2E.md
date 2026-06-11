# Hedge E2E acceptance run

**Result: PASSED**

- date: 2026-06-11T07:46:47.092Z
- chain: anvil (chainId 31337) on http://127.0.0.1:8545
- command: pnpm --filter @hedge/e2e e2e  (services/e2e/src/run.ts)
- maker EOA: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (anvil #1)
- taker EOA: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (anvil #2)
- winning premium: 516.405735099544585864 USDT
- OI fee per side: 10000 USDT

## Stage 1: fresh anvil + DeployAll.s.sol — PASS

anvil up on http://127.0.0.1:8545 (chainId 31337)
deployments/31337.json written; Matching domain separator verified on-chain (`0x045d8d913190e5bad23c8f6d6df5ac4e560f8bd5429019c38eb7218e4c3a6970`)
- Matching: `0xD8a5a9b31c3C0232E196d518E89Fd8bF83AcAd43` RfqModule: `0x0355B7B8cb128fA5692729Ab3AAa199C1753f726`
- OptionAsset: `0x1291Be112d480055DaFd8a610b7d1e203891C274` CashAsset: `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` BTCB base: `0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154`
option: BTC call, strike 110000, expiry 1781768813 (chain now + 7d), subId 39614128501772424798553743981

## Stage 2: oracle-feeds: spot / forward / rate / vol (+ USDT stable) — PASS

- BTC spot = 100000: tx `0x34b776a4334b2f37fa30bee94e6e09147932c8db295bc82849cf1cf10e4dc06d`
- BTC forward(expiry) = 100000: tx `0x9e2c50ec270533a21bf644b121a3881ced49d05b6c9c8418f33255fad8f90ae4`
- BTC rate(expiry) = 0.05: tx `0x63d053df123565dbc6a3a443d05e059bf7a35b9bcc1f46ae07fdb8c999cd3044`
- BTC vol surface flat IV = 0.6 (SVI): tx `0x3fae28aab52f7b17fa331aa89a99038ece4ce45c669ac5510d38d21bf5d785b7`
- USDT stable feed = 1.0: tx `0x0c6af5081a917877b153a6848d402a6d975e90bad2a449f6c93eaf6e0c5949c7`
read-back OK: getSpot=100000, getForwardPrice(1781768813)=100000

## Stage 3: fund EOAs + open maker/taker subaccounts — PASS

- mint 150000 mock USDT -> maker EOA 0x70997970C51812dc3A010C7d01b50e0d17dc79C8: tx `0x38e297517871886bbe263e31a32f3651808f12840aa7babc273d86277a9798e7`
- mint 1 mock BTCB -> taker EOA 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC: tx `0x00db3e737d78014a6a1821ae1ab1fb4148d0741bee93e3b9ab69dca2ef566494`
maker-bot --setup: subaccount 4 created under Matching, 150000 USDT cash deposited
- taker Matching.createSubAccount(SRM) -> subaccount 5: tx `0x2483d678c8a217e0a16e39a31eff5f6ddb847f9311d4be01b1b7ff16cafefecc`
- taker BTCB.approve(WrappedERC20Asset): tx `0xb64177476453843b24d2f6a725eea32e6ad4db74a066cdb5aa6cf11c1703d6a2`
- taker WrappedERC20Asset.deposit(1 BTCB) — covered-call collateral: tx `0x24d8aa80130a8686a7d8f16e768842dda9088496c68bd3eb8b8c4759128d16a9`
Balances — after setup:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | 0 | 1 | 0 |
| maker | 150000 | 0 | 0 |
| fee recipient (3) | 0 | 0 | 0 |


## Stage 4: rfq-engine + maker-bot up — PASS

rfq-engine healthy on http://127.0.0.1:3030 (executor = registered tradeExecutor 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
maker-bot connected (prices from on-chain feeds: forward/vol/rate — no env overrides)

## Stage 5: RFQ auction: taker sells 1x BTC-110000-C (7d) — PASS

- re-post BTC spot (3-minute heartbeat): tx `0xa42ed0e2abc647da00b371b144130541e38c9d4d76b90233e384c7cd04e261e1`
RFQ `53a851d5-db94-4686-9f16-f971112d48f1` opened: BTC-20260618-110000-C, auction window 4s
winning quote: maker `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` premium 516.405735099544585864 USDT (orderHash `0x230c2c089a9bead4711a77f915bbdcd1e509d7011b6650a6ece5dc6236ff73ec`)

## Stage 6: execute on-chain via RfqModule (Matching.verifyAndMatch) — PASS

Balances — before execution:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | 0 | 1 | 0 |
| maker | 150000 | 0 | 0 |
| fee recipient (3) | 0 | 0 | 0 |

- verifyAndMatch executed (block 24): tx `0x4db95dd1b93c6eee8abe639de4b41fb781ee2e7596f7e3902b8cf09154792dd3`
expected OI fee per side: 10000 USDT (rate 0.1 x forward 100000, min 10)
Balances — after execution:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | -9483.594264900455414136 | 1 | -1 |
| maker | 139483.594264900455414136 | 0 | 1 |
| fee recipient (3) | 20000 | 0 | 0 |

SRM initial margin (taker subaccount 5): 46722.304339391691885864 USDT (>= 0)
SRM initial margin (maker subaccount 4): 139483.594264900455414136 USDT (>= 0)

## Stage 7: settlement — OTM (settle @ 90000) — PASS

warped chain time to 1781768873 (expiry 1781768813 + 60s)
- post spot = 90000: tx `0x0aea2e146cc9ff8f4c59aa45447e64429157ede42ec2dc1f20fb6bead6ddeffa`
- post forward-feed settlement data for expiry 1781768813: tx `0x1a9c32e4f2d2f4e646fae4bf43f5005781ca1184b24aa161ceba2e6dd26875f5`
settlement price fixed on-chain: 90000
- settleOptions(btcOptionAsset, maker subaccount 4): tx `0x9a06f31c20d604f96db24f374c4a13eea01f22874c55275f9b10f014bca8cc25`
- settleOptions(btcOptionAsset, taker subaccount 5): tx `0x8618ded8324ecd6453f150380c30c25c9458b1920a559aa255c6f6683fb63c14`
Balances — after OTM settlement:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | -9488.098481413344549769 | 1 | 0 |
| maker | 139486.745758000223602034 | 0 | 0 |
| fee recipient (3) | 20000 | 0 | 0 |

OTM: payout 0 USDT/option — maker 3.151493099768187898, taker -4.504216512889135633 (interest drift within 25)

## Stage 8: settlement — ITM (settle @ 130000) — PASS

warped chain time to 1781768873 (expiry 1781768813 + 60s)
- post spot = 130000: tx `0x14106bea6654e2a7adc3e2bee675332d074d419156d2518e04f622ac4ee9e356`
- post forward-feed settlement data for expiry 1781768813: tx `0xad1d36c23ace513e69a41de8f972c56c9077321ae3ee2f1142cbade891045bb7`
settlement price fixed on-chain: 130000
- settleOptions(btcOptionAsset, maker subaccount 4): tx `0x249a6e8c70c72eea2390dc8c7997b60a2b411915cd18ecd9dcfeef78e610dd87`
- settleOptions(btcOptionAsset, taker subaccount 5): tx `0x0a2a51628ecfe3748751bfbfad5b13e4f3579a1f568339ce4ba0f8e97757c503`
Balances — after ITM settlement:

| subaccount | USDT cash | BTCB | option (BTC call) |
| --- | --- | --- | --- |
| taker | -29488.098481413344549769 | 1 | 0 |
| maker | 159486.745758000223602034 | 0 | 0 |
| fee recipient (3) | 20000 | 0 | 0 |

ITM: payout 20000 USDT/option — maker 20003.151493099768187898, taker -20004.504216512889135633 (interest drift within 25)

