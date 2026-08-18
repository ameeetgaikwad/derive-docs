# References

Last link review: 2026-08-14.

Protocol and venue documentation changes. Before implementing or approving a live adapter, pin the exact deployed environment, contract addresses/ABI, API schema, venue metadata, and SDK commit; re-read the current official source rather than relying on this dated index.

## Derive primary sources

- [RFQ Quoting and Execution (official Derive API reference)](https://docs.derive.xyz/reference/rfq-quoting-and-execution). Documents self-custodial signed RFQs, maker polling/socket access, maker/taker flow, direction semantics, signed legs, fees, quote identity, transaction status, and execution.
- [Derive machine-readable documentation index](https://docs.derive.xyz/llms.txt). Entry point for current API/OpenAPI and reference pages.
- The deployed Derive RFQ contract ABI, verified contract source, network/chain configuration, and actual event receipts must be added to this list and pinned before fill-confirmation code is accepted. An example documentation address is not production authority.

## Hyperliquid primary sources

- [Exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint). Order fields, IOC/GTC/ALO behavior, `cloid`, reduce-only, subaccount/vault addressing, response forms, and `expiresAfter`.
- [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions). `l2Book`, `orderUpdates`, `userFills`, funding, clearinghouse state, and snapshot behavior.
- [WebSocket connection guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket). Reconnection and missed-data guidance.
- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint). Metadata, books, account/order/fill query schemas used for reconciliation.
- [Notation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation). Price/size precision conventions.
- [Nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets). Signer-scoped nonce window/set behavior, API-wallet lifecycle, pruning/replay warning, and subaccount guidance.
- [Contract specifications](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications). Linear perpetual units, collateral/denomination, funding interval, and position/order characteristics.
- [Margining](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining). Cross/isolated modes, leverage, initial/maintenance margin, and liquidation relationship.
- [Liquidations](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations). Venue liquidation behavior and risks.
- [Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding). Funding calculation/timing and sign behavior.
- [Fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees). Dynamic account fee tiers and formula.
- [Robust price indices](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices). Oracle and mark construction and update behavior.
- [Order book](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/order-book). Tick/lot behavior, matching, and margin checks.
- [Official Python SDK `exchange.py`](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/exchange.py). Reference encoding and convenience-order behavior. Production must pin and review a commit rather than track `master` implicitly.

## Pricing and market-making research

- Fischer Black, [“The Pricing of Commodity Contracts”](https://doi.org/10.1016/0304-405X(76)90024-6), *Journal of Financial Economics* 3 (1976), 167–179. Primary Black forward-option model source.
- Sasha Stoikov and Mehmet Sağlam, [“Option Market Making under Inventory Risk”](https://people.orie.cornell.edu/~sfs33/StoikovSaglam.pdf). Inventory-aware option quoting and hedging research. It informs future calibration questions; it is not a protocol specification or a directly implemented strategy.

## Current implementation as source of truth

- [`domain/types.ts`](../src/domain/types.ts): current runtime input shape and documented units.
- [`config.ts`](../src/config.ts): current shadow policy and partial validation.
- [`black76.ts`](../src/pricing/black76.ts): implemented formulas and Greeks.
- [`quote-engine.ts`](../src/decision/quote-engine.ts): actual gate order, economics, reservation proposal, and diagnostics.
- [`exposures.ts`](../src/risk/exposures.ts): actual aggregation and hard-limit checks.
- [`reservations.ts`](../src/risk/reservations.ts): in-memory CAS prototype semantics.
- [`order-book.ts`](../src/market/order-book.ts): L2 walk and IOC price rounding.
- [`hyperliquid-plan.ts`](../src/hedging/hyperliquid-plan.ts): current plan-only target and order-intent logic.

If prose and code differ for current behavior, stop and resolve the discrepancy before using either result. If code and a current protocol specification differ at a signing/venue boundary, the integration remains disabled until reviewed and corrected.

