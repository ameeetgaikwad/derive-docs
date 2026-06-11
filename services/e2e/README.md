# @sats-options/e2e

End-to-end acceptance harness for the full sats-options v1 covered-call flow
(SPEC.md "E2E acceptance"). One command spins up a fresh anvil, deploys the
protocol, posts signed feeds, funds and opens maker/taker subaccounts, runs a
live RFQ auction through the real `rfq-engine` + `maker-bot`, executes the
trade on-chain via `RfqModule`, then warps past expiry and settles BOTH an OTM
and an ITM scenario (via `evm_snapshot`/`evm_revert`), asserting balances at
every stage.

## Run

```sh
# from services/ — builds of shared/oracle-feeds/rfq-engine/maker-bot must exist
pnpm install
pnpm -r build

# the one command:
pnpm --filter @sats-options/e2e e2e
```

Results are written to `protocol/E2E.md` (stage-by-stage, tx hashes, balance
tables). Exit code 0 only if every stage asserted green.

Requirements: `anvil` + `forge` on PATH (foundry), Node 22, free ports 8545
(anvil) and 3030 (rfq-engine) — override with `ANVIL_PORT` / `RFQ_PORT`.
All keys are derived from the anvil default mnemonic
(`test test ... junk`, override `ANVIL_MNEMONIC`): #0 deployer/feed
signer/trade executor, #1 maker, #2 taker. Every spawned process (anvil,
rfq-engine, maker-bot) is killed before the harness exits.

## Scenario

| step | what | assertion |
|---|---|---|
| 1 | anvil + `forge script script/DeployAll.s.sol --broadcast` | deployments JSON written, on-chain `Matching.domainSeparator` matches |
| 2 | feeds: spot 100k, forward 100k, rate 5%, flat 60% IV SVI for `now+7d`, USDT stable 1.0 | feed read-backs exact |
| 3 | mint mock USDT/BTCB; `maker-bot --setup` (150k USDT cash); taker `Matching.createSubAccount` + 1 BTCB deposit | subaccount owners + balances exact |
| 4 | start rfq-engine (executor preflight) + maker-bot (prices from on-chain feeds) | `/health`, WS auth |
| 5 | `POST /rfq` sell 1x BTC-110000-C 7d; 4s auction | >=1 quote, premium within Black-76 sanity bounds |
| 6 | taker signs `TakerOrder`; `POST /rfq/:id/accept` -> `Matching.verifyAndMatch` | option -1/+1, premium moved, OI fee (`max(0.1 x fwd, 10)` per side) to fee recipient, SRM IM >= 0 both sides |
| 7 | snapshot; warp +7d; settle @ 90k (OTM) | options cleared, cash unchanged (interest tolerance) |
| 8 | revert; warp; settle @ 130k (ITM) | options cleared, maker +20k / taker -20k cash (interest tolerance) |

Notes:

- The USDT **stable feed** must be posted before any trade — the SRM depeg
  check (`_getDepegMultiplier`) calls `stableFeed.getSpot()` on every initial
  margin check (verified against `StandardManager.sol`).
- Spot heartbeat is 3 minutes (deploy config), so the harness re-posts spot
  right before opening the RFQ.
- OI fees at the deployed config (`OI_FEE_BPS = 0.1e18`, copied from the
  vendored `config-mainnet.sol`) are 10,000 USDT per side at a 100k forward —
  larger than the option premium. The taker's cash goes negative (borrow
  against the BTCB collateral), which is why settlement cash assertions carry
  a small interest-accrual tolerance (25 USDT over the 7-day warp).
- Cash settlement: the ITM payout is `settlement - strike` in USDT cash; the
  1 BTCB collateral stays in the taker subaccount in both scenarios.
