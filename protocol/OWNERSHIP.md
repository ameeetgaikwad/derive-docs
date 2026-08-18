# Ownership & privileged roles

Who can do what on a Hedge deployment (BSC testnet 97 today, mainnet 56 next), and the
runbook for handing ownership from the deployer EOA to a Gnosis Safe.

Tooling:

- [`script/TransferOwnership.s.sol`](script/TransferOwnership.s.sol) — initiates the transfer
  of every owned contract to `SAFE_ADDRESS` and prints a verification table.
- [`safe/generate-accept-batch.sh`](safe/generate-accept-batch.sh) →
  [`safe/accept-ownership-batch.json`](safe/accept-ownership-batch.json) — the Safe
  Transaction Builder batch of `acceptOwnership()` calls (see [safe/README.md](safe/README.md)).

## 1. Ownership pattern per contract (verified from vendored source)

Every owned contract in the system uses **OpenZeppelin `Ownable2Step`** (OZ 4.8.3 pin,
`lib/v2-matching/lib/openzeppelin-contracts`): `transferOwnership(newOwner)` only sets
`pendingOwner`; the new owner must call `acceptOwnership()`. Nothing uses one-step OZ
`Ownable` or solmate `Owned`. Verified per contract (inheritance chain in parentheses):

| Contract | Pattern | Via |
|---|---|---|
| CashAsset | Ownable2Step | direct + `ManagerWhitelist` |
| SecurityModule | Ownable2Step | direct |
| DutchAuction | Ownable2Step | direct |
| StandardManager (SRM) | Ownable2Step | `BaseManager` |
| SRMPortfolioViewer | Ownable2Step | `BasePortfolioViewer` |
| OptionAsset (per market) | Ownable2Step | `PositionTracking` + `ManagerWhitelist` (single owner slot) |
| WrappedERC20Asset (per market) | Ownable2Step | `ManagerWhitelist` + `PositionTracking` |
| LyraSpotFeed / LyraForwardFeed / LyraVolFeed / LyraRateFeed (per market) | Ownable2Step | `BaseLyraFeed` |
| LyraSpotFeed (USDT stable feed) | Ownable2Step | `BaseLyraFeed` |
| PythSpotFeed (`src/PythSpotFeed.sol`, ours) | Ownable2Step | direct |
| AnchoredSettlementFeed (`src/AnchoredSettlementFeed.sol`, ours — in flight, not yet in `97.json`) | Ownable2Step | direct; also owner-only `proposeOverride` settlement override — covered by the tooling via the optional `btcSettlementFeed` / sidecar `settlementFeed` keys once deployed |
| Matching | Ownable2Step | `ActionVerifier` → `SubAccountsManager` |
| Deposit/Withdrawal/Transfer/Trade/Rfq modules | Ownable2Step | `BaseModule` |
| **SubAccounts** | **no owner** | ERC-721 registry; per-account authority = NFT ownership/approvals only |
| **InterestRateModel** | **no owner** | all params constructor-immutable; swapped via `CashAsset.setInterestRateModel` (CashAsset owner) |
| **OptionSettlementHelper** | **no owner** | stateless `IDataReceiver` |
| **LyraSettlementUtils** (`settlementUtils`) | **no owner** | stateless periphery |
| **SubAccountCreator** | **no owner** | stateless periphery |
| Mock BTCB / Mock USDT (testnet only) | **no owner** | `mint()` unrestricted by design; mainnet uses real BTCB/USDT |

Two ERC-721 subaccounts in `SubAccounts` matter:

- **Fee-recipient subaccount** (id 3 on 97): created by `DeployAll` as
  `subAccounts.createAccount(deployer, srm)` — the NFT is held **directly by the deployer
  EOA** (not inside Matching). All OI fees stream to it. Moved to the Safe by
  `TransferOwnership.s.sol` (plain single-step `transferFrom`).
- **SecurityModule subaccount** (id 1 on 97): created in the SecurityModule constructor as
  `createAccount(address(this), …)` — held **by the SecurityModule contract itself**. It
  cannot (and need not) be transferred; control follows SecurityModule's owner.

## 2. Privileged-role inventory

Holders "today" are the live testnet-97 values. Deployer = `0x6e154BEA…1EE9eB`,
feed signer = `0xdE50B8E9…782F`.

| Contract | Role / power | Holder today | After handover |
|---|---|---|---|
| every Ownable2Step contract above | `owner()` — all setters below plus ownership itself | deployer EOA | **Safe** |
| Matching | `tradeExecutors[addr]` — may call `verifyAndMatch` (submit signed order matches) | deployer EOA (rfq-engine key) | **hot key (stays)**; Safe can rotate via `setTradeExecutor` |
| Matching | `allowedModules[addr]` — modules executable through matching | 5 Hedge modules | unchanged; Safe-managed |
| Matching / BaseModule | `withdrawERC20` — sweep stray tokens out of Matching/modules | owner | Safe |
| BaseLyraFeed ×6 (BTC spot/fwd/vol/rate + stable; +4 per extra market) | `signers[addr]` + `requiredSigners` (=1) — signed price data accepted on-chain | feed signer EOA (oracle-feeds key) | **hot key (stays)**; Safe can rotate via `addSigner` / raise `setRequiredSigners` |
| BaseLyraFeed ×6 | `acceptData` (posting) | **permissionless** — any address with validly-signed payloads; the "poster" key only pays gas | unchanged |
| StandardManager | `whitelistedCallee[addr]` — contracts callable through manager during trades | feeds + OptionSettlementHelper | unchanged; Safe-managed |
| StandardManager | `feeBypassedCaller[addr]` | none set | none; Safe-managed |
| StandardManager | `trustedRiskAssessor[addr]` | none set | none; Safe-managed |
| StandardManager (BaseManager) | `guardian` — can pause/unpause adjustments (`setAdjustmentsPaused`, guardian-only, NOT owner) | **unset (`address(0)`) — nobody can pause today** | set post-handover: Safe, or an ops hot key for fast incident response |
| StandardManager | market/margin/fee/oracle setters (`createMarket`, `whitelistAsset`, `setOraclesForMarket`, `set*MarginParams`, `setFeeRecipient`, `setMinOIFee`, …) | deployer (owner) | Safe |
| CashAsset | `setInterestRateModel`, `setSmFee`, `setSmFeeRecipient`, `setLiquidationModule`, manager whitelist | deployer (owner) | Safe |
| SecurityModule | `withdraw` / `recoverERC20` — **moves SM funds**; `setWhitelistModule` | deployer (owner); whitelisted module = DutchAuction | Safe |
| DutchAuction | `setAuctionParams`, `setMtmCutoff`, `setSMAccount`, `setWhitelistManager` | deployer (owner); whitelisted manager = SRM | Safe |
| SRMPortfolioViewer | `setOIFeeRateBPS`, `setStandardManager` | deployer (owner) | Safe |
| OptionAsset / WrappedERC20Asset | `setWhitelistManager`, `setTotalPositionCap`, `setSettlementFeed` (option) | deployer (owner); whitelisted manager = SRM | Safe |
| TradeModule / RfqModule | `setFeeRecipient(uint subacc)`, `setPerpAsset` | deployer (owner); feeRecipient = subacc 3 | Safe |
| PythSpotFeed | `setPythStaleness`, `setChainlinkStaleness`, `setDeviationThreshold`, `setChainlinkAggregator` | deployer (owner) | Safe |
| ChainlinkSpotFeed | `setStaleness` | deployer (owner) | Safe |
| PythSpotFeed | Pyth price pushes (`updatePriceFeeds` on the Pyth contract) | **permissionless** (anyone pays the Pyth fee) | unchanged |
| SubAccounts | fee-recipient subaccount NFT (id 3) — owner may withdraw accrued fee cash | deployer EOA | **Safe** (single-step NFT transfer) |
| SubAccounts | SM subaccount NFT (id 1) | SecurityModule contract | unchanged (follows SecurityModule owner) |
| SubAccounts | `createAccount`, adjustments | permissionless / asset-gated | unchanged |
| Mock BTCB / USDT (97 only) | `mint` | **everyone** (testnet convenience) | unchanged on testnet; N/A mainnet |

### What stays on hot keys deliberately — and blast radius

| Hot key | Why it stays hot | Blast radius if compromised |
|---|---|---|
| **Trade executor** (rfq-engine) | submits every match; needs sub-second latency, cannot be a multisig | Bounded: `verifyAndMatch` only executes **actions signed by the account owners** — it cannot forge trades or withdraw for users. Worst case: replaying not-yet-executed signed actions, selective ordering/censorship, gas griefing. Rotate: Safe → `Matching.setTradeExecutor(old,false)/(new,true)`. |
| **Feed signer** (oracle-feeds, 1-of-1) | posts spot/forward/vol/rate/stable prints continuously | **Largest hot-key risk**: a forged print moves margin, can trigger wrongful liquidations, and the signed forward feed **is the settlement price**. Bounds: heartbeats (spot 3 min … fwd 60 min) limit staleness, SRM's live spot is the Pyth adapter with Chainlink circuit breaker (testnet), depeg/oracle-contingency penalties. Rotate: Safe → `addSigner(old,false)/(new,true)`; harden later by raising `setRequiredSigners`. |
| **Feed poster / Pyth pusher** | not actually a role — posting is permissionless | ~zero: invalid signatures revert; the key only spends its own gas. |

Nothing else needs a hot key. There is **no privileged role that cannot be moved to the
Safe** — the only "cannot move" items are contracts with no owner at all (SubAccounts,
InterestRateModel, the stateless periphery, the open-mint testnet mocks) and the SM
subaccount NFT (held by the SecurityModule contract itself).

> New contracts (e.g. a future settlement feed) must be added to the target list in
> `TransferOwnership.s.sol::_collectTargets` **and** `safe/generate-accept-batch.sh::CORE_KEYS`.

## 3. Handover runbook

### Testnet (97)

1. **Create the Safe** on BSC testnet (app.safe.global → chain "BNB Smart Chain Testnet").
   Record `SAFE_ADDRESS`. Execute one trivial test transaction from the Safe first.
2. **Dry-run** (no broadcast; expects all rows MISMATCH → confirms target list resolves):
   ```sh
   SAFE_ADDRESS=0x... forge script script/TransferOwnership.s.sol --rpc-url $RPC_URL_97_THIRDWEB
   ```
3. **Initiate** (deployer key; legacy gas per TESTNET.md quirks):
   ```sh
   SAFE_ADDRESS=0x... PRIVATE_KEY=$DEPLOYER_KEY forge script script/TransferOwnership.s.sol \
     --rpc-url $RPC_URL_97_THIRDWEB --broadcast --legacy --with-gas-price 200000000 \
     --retries 12 --delay 5
   ```
   The script refuses a `SAFE_ADDRESS` with no code off-anvil (typo/undeployed guard),
   requires the broadcaster to be the current owner, is idempotent on re-run, and ends
   with the verification table: every contract `PENDING`, the fee-recipient NFT `DONE`.
4. **Accept from the Safe** (one batched transaction):
   ```sh
   ./safe/generate-accept-batch.sh 97 0x<safeAddress>
   ```
   Import `safe/accept-ownership-batch.json` in the Safe app → Transaction Builder →
   simulate → sign to threshold → execute (19 `acceptOwnership()` calls on testnet).
5. **Verify** (reverts if anything is off):
   ```sh
   SAFE_ADDRESS=0x... forge script script/TransferOwnership.s.sol --sig "verify()" \
     --rpc-url $RPC_URL_97_THIRDWEB
   ```
   All rows must read `DONE`.
6. **Post-handover**: services keep running unchanged (executor + signer roles are
   untouched). Consider `StandardManager.setGuardian(<ops key or Safe>)` from the Safe —
   the pause switch is currently unset.

Extra markets added via `AddMarket.s.sol` (sidecar `deployments/97-<NAME>.json`): pass
`MARKET_NAMES=ETH[,X…]` to both `run()` and `verify()`; the batch generator picks up
sidecars automatically.

### Mainnet (56)

Same flow with additions:

- Safe threshold ≥ 2/3, signers on hardware wallets; execute a test tx before handover.
- Use a **dedicated trade-executor key** (not the deployer) and rotate the feed signer to
  a fresh key before or right after handover; consider `setRequiredSigners > 1`.
- Run step 3, **verify every row is PENDING before touching the Safe**, then accept
  (step 4) in the same maintenance window. Keep the deployer funded and its key available
  until step 5 passes — it remains the rollback path (see below) until acceptance.
- No `--legacy` quirk documented for mainnet yet; confirm gas settings before broadcast.

### Anvil validation flow (repeatable; this exact flow was run green)

```sh
anvil --port 8546                                   # terminal 1; chainId 31337
cd protocol
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # anvil #0
SAFE=0x70997970C51812dc3A010C7d01b50e0d17dc79C8      # anvil #1 plays the Safe (EOA ok on 31337)
SAFE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
MARKET_INDEX=1 forge script script/AddMarket.s.sol --rpc-url http://127.0.0.1:8546 --broadcast  # optional ETH sidecar

SAFE_ADDRESS=$SAFE MARKET_NAMES=ETH forge script script/TransferOwnership.s.sol \
  --rpc-url http://127.0.0.1:8546 --broadcast
# -> table: 24 rows PENDING, fee-recipient NFT DONE

./safe/generate-accept-batch.sh 31337 $SAFE -o /tmp/accept-31337.json
jq -r '.transactions[].to' /tmp/accept-31337.json | while read a; do
  cast send "$a" "acceptOwnership()" --private-key $SAFE_KEY --rpc-url http://127.0.0.1:8546
done                                                # simulates the Safe's batched acceptance

SAFE_ADDRESS=$SAFE MARKET_NAMES=ETH forge script script/TransferOwnership.s.sol \
  --sig "verify()" --rpc-url http://127.0.0.1:8546
# -> all 25 rows DONE (verify() reverts otherwise)

git checkout deployments/31337.json && rm -f deployments/31337-ETH.json   # restore repo state
```

Note: `protocol/.env` contains testnet keys that forge auto-loads — always pass
`PRIVATE_KEY` explicitly on anvil.

## 4. Rollback notes

- **Two-step is the safety net.** `transferOwnership` only sets `pendingOwner`; the
  deployer remains full owner of every contract until the Safe executes
  `acceptOwnership()`. A pending transfer grants the target nothing.
- **Wrong `SAFE_ADDRESS`, caught before acceptance**: re-run `TransferOwnership.s.sol`
  with the correct address — each new `transferOwnership` overwrites `pendingOwner`.
  To cancel outright: `cast send <contract> "transferOwnership(address)" <deployer>` per
  contract (self-pending is inert). **Exception — the fee-recipient subaccount NFT is
  single-step**: sent to a wrong address it is gone. Recovery: the (still-deployer-owned)
  SRM + Trade/Rfq modules can be pointed at a fresh subaccount
  (`subAccounts.createAccount` → `srm.setFeeRecipient` + both modules' `setFeeRecipient`);
  only fees already accrued in the old subaccount are lost. The script's code-existence
  check on `SAFE_ADDRESS` is the first line of defense.
- **Wrong address has already accepted**: that address is the owner; recovery only with
  its cooperation. This is why acceptance happens as a single reviewed, simulated
  Transaction Builder batch from the Safe itself — the Safe can only accept transfers
  pointed at it.
- **Safe lost/compromised after acceptance**: no protocol-level recovery — owner powers
  (params, whitelists, SecurityModule funds, fee subaccount) are frozen or hostile.
  Mitigate with standard Safe hygiene: threshold ≥ 2/3, geographically split hardware
  signers, tested recovery signers. Note the system keeps **trading** even with a dead
  owner (executor/signer roles are separate); you lose the ability to reconfigure,
  add markets, rotate compromised hot keys, or withdraw SM/fee funds.
- **Stuck halfway (some accepted, some pending)**: harmless — owners are independent.
  Re-run the generator/batch for the remaining contracts (already-accepted ones are
  excluded from PENDING and their `acceptOwnership` would revert; regenerating after a
  partial run and dropping DONE rows in the Transaction Builder avoids that).
