# @hedge/e2e

End-to-end acceptance harness for the full Hedge v1 covered-call flow
(SPEC.md "E2E acceptance"). One command spins up a fresh anvil, deploys the
protocol, posts signed feeds, funds and opens maker/taker subaccounts, runs a
live RFQ auction through the real `rfq-engine` + `maker-bot`, executes the
trade on-chain via `RfqModule`, exercises paused, idle-full, and margin-limited
executor-backed withdrawals, then settles BOTH an OTM and an ITM scenario. The
ITM branch finishes with a direct wallet-to-`CashAsset` USDT repayment and a
fresh Max preview, asserting balances and NFT custody at every stage.

## Run

```sh
# from services/ — builds of shared/oracle-feeds/rfq-engine/maker-bot must exist
pnpm install
pnpm -r build

# the one command:
pnpm --filter @hedge/e2e e2e
```

Results are written to `protocol/E2E.md` (stage-by-stage, tx hashes, balance
tables). Exit code 0 only if every stage asserted green.

For validation runs that must not modify the tracked protocol report, set an
alternate report path:

```sh
E2E_REPORT_PATH=/tmp/hedge-e2e.md pnpm --filter @hedge/e2e e2e
```

Relative `E2E_REPORT_PATH` values are resolved from the command's working
directory. The parent directory must already exist.

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
| 5 | temporarily pause StandardManager adjustments; preview BTCB | real pinned simulation returns `ADJUSTMENTS_PAUSED` and zero Max; snapshot restores unpaused state |
| 6 | withdraw idle taker BTCB and maker cash in full | protocol Max and recommended Max equal full balance; exact wallet/ledger movement; NFT returned to Matching; snapshot restores funding |
| 7 | `POST /rfq` sell 1x BTC-110000-C 7d; 4s auction | >=1 quote, premium within Black-76 sanity bounds |
| 8 | taker signs `TakerOrder`; `POST /rfq/:id/accept` -> `Matching.verifyAndMatch` | option -1/+1, premium moved, fee computed from live `OIFeeRateBPS`/`minOIFee`, SRM IM >= 0 both sides |
| 9 | preview BTC withdrawal max; reject max+1; sign/submit/poll a buffered partial withdrawal | wallet/ledger movement exact; NFT returned to Matching; snapshot restored before settlement |
| 10 | snapshot; warp +7d; settle @ 90k (OTM) | options cleared, cash unchanged (interest tolerance) |
| 11 | revert; warp; settle @ 130k (ITM) | options cleared, maker +20k / taker -20k cash (interest tolerance) |
| 12 | mint USDT; approve and call `CashAsset.deposit` directly | interest-adjusted debt decreases; BTC Max increases; token movement exact; NFT remains in Matching |

Notes:

- The USDT **stable feed** must be posted before any trade — the SRM depeg
  check (`_getDepegMultiplier`) calls `stableFeed.getSpot()` on every initial
  margin check (verified against `StandardManager.sol`).
- Spot heartbeat is 3 minutes (deploy config), so the harness re-posts spot
  right before opening the RFQ.
- OI fee inputs are governance-settable. The harness reads
  `SRMPortfolioViewer.OIFeeRateBPS(btcOptionAsset)` and
  `StandardManager.minOIFee()` live, then reproduces the contract formula. The
  current fresh deployment charges 100 USDT per side at a 100k forward.
- Cash settlement: the ITM payout is `settlement - strike` in USDT cash; the
  1 BTCB collateral stays in the taker subaccount in both scenarios.
- The withdrawal branch runs while the RFQ engine is configured with
  `WITHDRAWALS_ENABLED=true` and a temporary `FUNDS_STORE_PATH`. Snapshot
  isolation restores funds after idle full withdrawals and restores the
  one-BTCB covered-call state after the open-position partial withdrawal.
- Debt repayment intentionally bypasses the executor: the taker approves the
  stable token to `CashAsset` and calls `deposit(subaccountId, amount)` while
  Matching continues to hold the account NFT. A fresh preview before and after
  repayment proves that the contract-authoritative BTC Max increases.
