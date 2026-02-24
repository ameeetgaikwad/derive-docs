# Covered Call Platform on Derive — Research & Architecture Report

> **Date:** 2026-02-22
> **Status:** Reference Document for Development Team
> **Project:** Strikely — Crypto Options Trading Platform

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Current Codebase Architecture](#2-current-codebase-architecture)
3. [Derive Protocol API](#3-derive-protocol-api)
4. [Derive's Margin Systems](#4-derives-margin-systems)
5. [Derive's Vault Infrastructure (CCTSA)](#5-derives-vault-infrastructure-cctsa)
6. [Derive GitHub Repositories](#6-derive-github-repositories)
7. [RFQ System](#7-rfq-system)
8. [Rysk Finance Comparison](#8-rysk-finance-comparison)
9. [Robinhood Covered Call UX (TradFi Reference)](#9-robinhood-covered-call-ux-tradfi-reference)
10. [Simplified Product Mental Model](#10-simplified-product-mental-model)
11. [Recommended Architecture — PM Subaccounts + RFQ](#11-recommended-architecture--pm-subaccounts--rfq)
12. [Alternative Approaches Considered](#12-alternative-approaches-considered)
13. [Sources](#13-sources)

---

## 1. Project Overview

Strikely is a crypto options trading platform built on **Next.js 16** with **React 19**, integrating with the **Derive protocol** — an OP Stack Layer 2 chain (Chain ID 957).

### Current Tech Stack

| Layer            | Technology                          |
| ---------------- | ----------------------------------- |
| Framework        | Next.js 16 (App Router)            |
| UI               | React 19, Tailwind CSS 4           |
| State Management | Zustand, React Query               |
| Wallet           | Wagmi, Viem, RainbowKit            |
| Account Abstraction | Alchemy AA (LightAccount, CREATE2) |
| Language         | TypeScript                          |

### Application Structure

Two applications exist within the repository:

- **Main app** (`src/`) — Primary trading platform
- **Amit's app** (`amit/`) — Secondary application

---

## 2. Current Codebase Architecture

### Routing

The app uses Next.js App Router with the following routes:

| Route          | Purpose                    |
| -------------- | -------------------------- |
| `/`            | Landing / Home             |
| `/trade`       | Trading interface          |
| `/markets`     | Market overview            |
| `/strategies`  | Strategy builder           |
| `/portfolio`   | Portfolio management       |

### API Proxy Routes

| Route                    | Purpose                           |
| ------------------------ | --------------------------------- |
| `/api/derive/[...path]`  | Proxy to Derive REST API          |
| `/api/paymaster`         | Gas sponsorship via paymaster     |
| `/api/create-account`    | Smart contract wallet creation    |

### State Management

Four Zustand stores manage application state:

1. **Account store** — Wallet connection, session keys, subaccount state
2. **Trade store** — Order parameters, instrument selection, order execution
3. **Markets store** — Instrument listings, tickers, price data
4. **Portfolio store** — Positions, collaterals, P&L tracking

### Key Infrastructure

- **DeriveProvider** context wrapping the app, providing REST + WebSocket clients
- **Session key authentication** using EIP-712 signing
- **Smart Contract Wallets** via Alchemy AA (LightAccount with CREATE2 deterministic addressing)
- **WebSocket** for real-time data (tickers, orderbook)
- **Bridge support** via Socket Finance (USDC, WETH, WBTC from Ethereum, Arbitrum, Base, Optimism)

---

## 3. Derive Protocol API

### Endpoints

| Environment | REST                              | WebSocket                              |
| ----------- | --------------------------------- | -------------------------------------- |
| Mainnet     | `https://api.lyra.finance`        | `wss://api.lyra.finance/ws`           |
| Testnet     | `https://api-demo.lyra.finance`   | `wss://api-demo.lyra.finance/ws`      |

### Protocol

All communication uses **JSON-RPC** format.

### Public Endpoints

- Instruments listing
- Tickers (individual and batch)
- Trade history
- Currencies

### Private Endpoints (Authenticated)

- Orders (create, cancel, modify)
- Positions
- Collaterals
- Deposits and withdrawals
- RFQ (request for quote)

### WebSocket Channels

| Channel Pattern                             | Purpose                    |
| ------------------------------------------- | -------------------------- |
| `orderbook.{instrument}.{group}.{depth}`    | Live orderbook updates     |
| `ticker.{instrument}.{interval}`            | Ticker updates             |
| `ticker_slim`                               | Lightweight ticker stream  |

### Order Configuration

| Parameter    | Options                                      |
| ------------ | -------------------------------------------- |
| Order types  | `limit`, `market`                            |
| Time in force| `gtc`, `post_only`, `fok`, `ioc`            |
| Triggers     | Trigger orders supported                     |

### Authentication

- **EIP-712** signed timestamps
- **Session keys** with scoped permissions (per-action granularity)

---

## 4. Derive's Margin Systems

Derive offers two distinct margin systems with fundamentally different approaches to capital efficiency.

### 4.1 Standard Margin (SMRM)

Standard Margin applies fixed haircuts and formula-based margin calculations.

#### Collateral Haircuts

| Asset | Maintenance Value | Initial Margin Scaling | Effective Initial Value |
| ----- | ----------------- | ---------------------- | ----------------------- |
| BTC   | 75% (25% haircut) | 0.93                   | ~69.75%                 |
| ETH   | 80% (20% haircut) | 0.9375                 | ~75%                    |

#### Short Call Margin Formulas

**Initial margin:**

```
n * (-max(0.15 - OTM/Spot, 0.13) * Spot + Mark Price)
```

**Maintenance margin:**

```
n * (-0.09 * Spot + Mark Price)
```

#### Naked Short Call Scaling

| Margin Type   | Scaling Factor |
| ------------- | -------------- |
| Initial       | 1.2x           |
| Maintenance   | 1.1x           |

#### Covered Call Recognition

Standard Margin **does** recognize covered calls via a "zero strike" offset mechanism. When a short call is backed by the underlying asset, it is **not** counted as naked, avoiding the 1.2x/1.1x scaling penalties.

#### Total Margin Formula

```
Total Margin = USDC Balance + Base Collateral + Perp Margin + Option Margin + Contingencies
```

### 4.2 Portfolio Margin (PMRM)

Portfolio Margin uses a scenario-based stress testing approach that naturally recognizes hedged positions.

#### Stress Test Configuration

- **23 scenarios** evaluated simultaneously
- Spot shocks: **-18% to +18%** in 4.5% increments
- Volatility: up, down, and flat for each spot shock
- Worst-case scenario determines margin requirement

#### Key Parameters

| Parameter       | Value | Description                              |
| --------------- | ----- | ---------------------------------------- |
| `BASE_FACTOR`   | 0.03  | 3% base contingency (vs 25% haircut in SM) |
| `IM_FACTOR`     | 1.25  | Initial margin multiplier                |
| `OPTION_FACTOR` | 0.015 | Per net short contract contingency       |

#### Account Constraints

- Each PM account supports **only one underlying asset**
- Multiple PM subaccounts can be created per wallet

#### Why PM Is Superior for Covered Calls

PM naturally recognizes hedged positions through scenario analysis. When BTC collateral backs a short call, the stress test sees the offsetting P&L across scenarios, resulting in dramatically lower margin requirements compared to Standard Margin's fixed haircuts.

### 4.3 Liquidation Analysis — Covered Calls on Portfolio Margin

This section provides a full worked example proving that liquidation is effectively impossible for 1:1 covered calls on PM.

#### Setup

| Component                | Value      |
| ------------------------ | ---------- |
| BTC held                 | 1 BTC      |
| BTC spot price           | $100,000   |
| Short call strike        | $110,000   |
| Premium received         | $500       |
| Base collateral value    | ~$97,000 (0.97 * spot) |
| Call mark-to-market      | ~$2,000    |
| **Account value**        | **~$95,500** |
| **Maintenance margin**   | **~$19,200** |
| **Surplus**              | **$76,300** |

The maintenance margin of ~$19,200 breaks down as:
- Worst scenario loss: ~$16,200
- Contingencies: ~$3,000

#### Crash Scenarios

| Scenario                    | BTC Price | Account Value | Margin Required | Surplus    | Status |
| --------------------------- | --------- | ------------- | --------------- | ---------- | ------ |
| 50% crash                   | $50,000   | ~$49,000      | ~$10,500        | ~$38,500   | SAFE   |
| 90% crash                   | $10,000   | ~$10,200      | ~$2,100         | ~$8,100    | SAFE   |
| Rally (call deep ITM)       | $200,000  | ~$104,500     | ~$6,000         | ~$98,500   | SAFE   |

#### Mathematical Proof

Liquidation occurs when account value falls below maintenance margin. For a 1:1 covered call on PM:

```
Liquidation requires: 0.97 * spot + premium < 0.21 * spot
Simplified:           0.76 * spot < -premium
```

Since `spot` is always positive and `premium` is always positive, this inequality **can never be satisfied**. The left side is always positive, and the right side is always negative.

**Conclusion: For a 1:1 covered call on Portfolio Margin, liquidation is mathematically impossible.**

---

## 5. Derive's Vault Infrastructure (CCTSA)

### 5.1 What CCTSA Is

**CCTSA** = Covered Call Tokenized SubAccount — a production V2 smart contract for pooled covered call vaults.

| Property           | Detail                                                        |
| ------------------ | ------------------------------------------------------------- |
| Type               | Pooled vault (multi-user, ERC20 shares)                       |
| Margin system      | Standard Margin (NOT Portfolio Margin)                        |
| Collateralization   | Enforces `shortCalls <= baseBalance` (1:1)                   |
| Pricing            | Black-76 with vol slippage for fair pricing validation        |
| Audit              | Sigma Prime                                                   |
| Source             | [CCTSA.sol](https://github.com/derivexyz/v2-matching/blob/master/src/tokenizedSubaccounts/CCTSA.sol) |

#### Configurable Parameters

| Parameter                | Purpose                                    |
| ------------------------ | ------------------------------------------ |
| `optionMaxDelta`         | Maximum delta for sold options              |
| `min/maxTimeToExpiry`    | Allowed expiry window                      |
| `optionVolSlippageFactor`| Vol slippage tolerance for pricing         |
| `optionMaxNegCash`       | Maximum negative cash allowed              |

### 5.2 Contract Hierarchy

```
BaseTSA.sol (abstract)
  +-- TSAShareHandler.sol (deposit/withdrawal/bridge)
  +-- BaseOnChainSigningTSA.sol (signature verification)
        +-- CollateralManagementTSA.sol (spot trading)
              +-- CCTSA.sol (Covered Call)
              +-- PPTSA.sol (Principal Protected / BULL)
              +-- LevBasisTSA.sol (Leveraged Basis)
```

### 5.3 Why CCTSA Is NOT Ideal for Our Use Case

| Issue                        | Impact                                              |
| ---------------------------- | --------------------------------------------------- |
| Pooled vault model           | Users cannot pick their own strikes/expiries         |
| Keeper-driven execution      | A keeper/executor decides what to sell, not the user |
| Standard Margin only         | 25% BTC haircut (worse than PM's 3% contingency)   |
| Per-user deployment overhead | Gas-intensive and operationally complex              |
| Not self-directed            | Fundamentally misaligned with per-user trading UX   |

### 5.4 Live Vault Products Using TSA

| Vault      | Strategy                   | Type         |
| ---------- | -------------------------- | ------------ |
| weETHC     | Covered Call / Harvest     | CCTSA        |
| rswETHC    | Covered Call / Harvest     | CCTSA        |
| rsETHC     | Covered Call / Harvest     | CCTSA        |
| weETHCS    | Spread                     | CCTSA-based  |
| LBTCCS     | Spread                     | CCTSA-based  |
| LBTCPS     | Spread                     | CCTSA-based  |
| weETHBULL  | Principal Protected / BULL | PPTSA        |
| sUSDeBULL  | Principal Protected / BULL | PPTSA        |
| bweETH     | Leveraged Basis            | LevBasisTSA  |
| bLBTC      | Leveraged Basis            | LevBasisTSA  |

---

## 6. Derive GitHub Repositories

| Repository                                                                 | Purpose                                | Notes               |
| -------------------------------------------------------------------------- | -------------------------------------- | -------------------- |
| [derivexyz/v2-matching](https://github.com/derivexyz/v2-matching)          | TSA contracts (CCTSA, PPTSA, etc.)     | **Key repo**         |
| [derivexyz/v2-core](https://github.com/derivexyz/v2-core)                  | Core protocol (SubAccounts, risk mgrs) | Options, perps       |
| [derivexyz/v2-aa](https://github.com/derivexyz/v2-aa)                      | Account abstraction helpers            | Deposit/withdraw     |
| [derivexyz/cockpit](https://github.com/derivexyz/cockpit)                  | Rust SDK                               | Vault executors, MM algos, CLI |
| [derivexyz/lyra-vaults](https://github.com/derivexyz/lyra-vaults)          | V1 legacy vaults                       | Unaudited, reference only |
| [derivexyz/v1-core](https://github.com/derivexyz/v1-core)                  | Original Lyra Protocol                 | Legacy               |
| [derivexyz/v2-scripts](https://github.com/derivexyz/v2-scripts)            | Tutorials and helpers                  | Good starting point  |

---

## 7. RFQ System

### 7.1 How Derive's RFQ Works

The Request for Quote (RFQ) system enables private, off-orderbook execution with market makers.

#### Flow

```
1. Taker creates RFQ
   POST /private/send_rfq
   Body: { legs: [{ instrument_name, amount, direction }] }

2. Market makers receive RFQ
   Via poll_rfqs or WebSocket channel: {wallet}.rfqs

3. MMs sign and send quotes
   Priced buy/sell offers with signatures

4. Taker polls quotes and selects best
   Receives legs_hash for the winning quote

5. Taker signs execute message
   Signs with legs_hash to finalize

6. On-chain settlement
   RfqModule.sol validates both signatures on-chain
```

#### Multi-Leg Support

The RFQ system supports complex multi-leg strategies:
- Spreads (bull call, bear put)
- Butterflies
- Condors
- Diagonal spreads

#### Market Maker Requirements

MM wallets **must be approved** by the Derive support team before they can participate in RFQ quoting.

### 7.2 Current RFQ Implementation in Our Codebase

**Status: ZERO implementation exists.**

| Component           | Status                                                       |
| ------------------- | ------------------------------------------------------------ |
| RFQ endpoints       | Not implemented                                              |
| RFQ types           | Not defined                                                  |
| RFQ hooks           | Not created                                                  |
| RFQ UI components   | Not created                                                  |
| Only reference      | A comment mentioning RFQ in session key scopes in `client.ts`|
| EIP-712 signing     | In place (can be extended for RFQ)                           |

#### What Needs to Be Built for RFQ

- REST endpoints: `send_rfq`, `poll_rfqs`, `rfq_accept`, `rfq_reject` in `client.ts`
- Types: `RFQRequest`, `RFQQuote`, `RFQQuoteStatus` interfaces in `types.ts`
- Hooks: `useRFQRequest`, `useRFQQuotes`, `useAcceptQuote`
- WebSocket: RFQ subscription channels

### 7.3 Derive Protocol Instrument Flexibility

| Layer       | Flexibility                                                                          |
| ----------- | ------------------------------------------------------------------------------------ |
| Protocol    | Permissionless — any strike, any expiry up to 400 days                               |
| Encoding    | `OptionAsset` uses `uint96 subId` encoding arbitrary strike/expiry/type             |
| Exchange    | Only listed instruments have active orderbooks                                       |
| RFQ         | Can potentially reference any valid instrument (settles on-chain)                   |
| Constraint  | Oracle feed must exist for the expiry; MM must be willing to quote                  |

---

## 8. Rysk Finance Comparison

### 8.1 How Rysk V12 Does Covered Calls

Rysk V12 is a covered call platform on **HyperEVM** (Hyperliquid's EVM) that takes a fundamentally different approach.

| Feature                | Rysk V12                                    |
| ---------------------- | ------------------------------------------- |
| Blockchain             | HyperEVM (Hyperliquid)                      |
| Collateralization      | 1:1 full collateralization, ZERO haircuts   |
| Margin engine          | None — no margin, no liquidation risk       |
| Settlement             | Physical (not cash)                         |
| Position model         | Per-user (NOT pooled vaults)                |
| Pricing                | RFQ — MMs bid on premiums                   |
| Premium payment        | Upfront in USDT0                            |
| Style                  | European, auto-settlement at 8:00 AM UTC    |
| Early exit             | Not available (secondary market in development) |
| Oracle                 | Stork Network for settlement prices         |
| Smart contracts        | Their own custom contracts                  |

### 8.2 Rysk's Trade-offs

| Advantage                    | Disadvantage                                  |
| ---------------------------- | --------------------------------------------- |
| Zero liquidation risk        | Zero capital efficiency (100% locked)         |
| Simple mental model          | No portfolio margining                        |
| Per-user, self-directed      | No early exit                                 |
| Clean 1:1 backing            | Built entirely their own protocol (huge effort) |

### 8.3 Rysk Evolution

| Version              | Model                                        | Chain    |
| -------------------- | -------------------------------------------- | -------- |
| V1/Alpha             | DHV (Dynamic Hedging Vault), pooled          | Arbitrum |
| Beyond               | Hybrid AMM + RFQ, still DHV                  | Arbitrum |
| V12 (Current)        | Per-user, fully collateralized, RFQ-only     | HyperEVM |

### 8.4 Rysk GitHub

- [rysk-finance/ciao-protocol](https://github.com/rysk-finance/ciao-protocol) — Rysk's smart contracts

---

## 9. Robinhood Covered Call UX (TradFi Reference)

Robinhood's covered call experience is the gold standard for retail UX. Understanding their flow informs our product design.

### 9.1 Prerequisites

- User must own 100+ shares of the stock (1 contract = 100 shares)
- Level 2 options approval required
- **No margin required** — the shares ARE the collateral
- No "buy-write" single order — user must own shares first, then sell call separately

### 9.2 Step-by-Step User Flow

```
1. Navigate to stock page (must own 100+ shares)
2. Tap Trade → Trade Options → Sell → Calls
3. Select expiration date (20-45 DTE recommended)
4. Choose strike price from chain showing:
   - Premium (bid/mark price)
   - Break-even price
   - Chance of profit (probability OTM)
5. Configure order:
   - Number of contracts
   - Limit price (near bid for fast fill)
   - Duration (Good-for-Day or Good-til-Canceled)
6. Review screen shows:
   - Max gain and max loss at expiration
   - Estimated credit received
   - Collateral/coverage confirmation
7. Swipe to submit
```

### 9.3 Collateral & Share Locking

- When the order fills, Robinhood **locks 100 shares per contract**
- Shares are frozen — user **cannot sell them** while the covered call is open
- No additional margin or cash deposit needed
- Shares are still visible in portfolio but carry a restriction

### 9.4 Position Display

- Stock and short call shown as **separate line items** (no unified "covered call" view)
- User must mentally combine P&L from both legs
- Options performance chart tracks returns over time
- P/L chart shows max gain, max loss, breakeven at expiration

### 9.5 What Happens at Expiration

| Scenario | What Happens | User Action |
|----------|-------------|-------------|
| **OTM** (price < strike) | Option expires worthless. Shares unlocked. Premium kept. | None required |
| **ITM** (price > strike) | Shares auto-sold at strike price. Premium kept. Settled in ~1 business day. | None required |

Both outcomes are **fully automatic**. No user action needed at expiry.

### 9.6 Early Exit Options

| Method | How It Works |
|--------|-------------|
| **Buy to Close** | Buy the call back. If cheaper than sold = profit. Shares unlock immediately. |
| **Roll** | Simultaneously close current call + open new one (different strike/expiry). Net credit/debit shown. |
| **Hold to Expiry** | Let it resolve automatically |

### 9.7 Fees

- **Commissions:** Zero
- **Regulatory fees:** ~$0.04-0.05 per contract (negligible)
- **Hidden cost:** Wider effective spreads due to PFOF model (~6.8% round-trip cost vs ~1.8% at Fidelity)

### 9.8 Key UX Observations for Our Product

1. **No unified P&L view** — Robinhood shows stock + option as separate items. We can do better by showing a single "covered call position" with combined P&L.
2. **Legging in required** — Robinhood makes you buy shares first, then sell call. We can offer a single "deposit + sell call" flow.
3. **Share locking is opaque** — We can make collateral locking explicit and visual.
4. **Rolling is first-class** — Robinhood built roll directly into the menu. We should too.
5. **Automatic settlement** — No user action at expiry. We should match this.
6. **Education integrated** — Greeks, probability, P/L charts embedded in the flow. Good model to follow.

### 9.9 Robinhood vs Our Platform

| Feature | Robinhood | Our Platform (Target) |
|---------|-----------|----------------------|
| Asset | Stocks (100 shares = 1 contract) | BTC/ETH (fractional, 1:1) |
| Collateral | Shares locked in brokerage | BTC/ETH locked in PM subaccount |
| Margin needed | None | None (PM makes liquidation impossible) |
| Execution | PFOF to market makers | RFQ to crypto MMs |
| Settlement | Physical (shares delivered) | Cash (app auto-sells BTC if ITM) |
| Early exit | Buy to close / Roll | Buy to close / Roll (advantage over Rysk) |
| Unified position view | No (separate line items) | Yes (single covered call card) |
| Fees | Zero commissions + ~$0.05 regulatory | TBD (Derive protocol fees) |

---

## 10. Simplified Product Mental Model

### 10.1 Key Insight: Covered Calls Have Only Two Outcomes

The margin system, mark-to-market, scenario analysis, and liquidation mechanics are **protocol-level concerns that the user never needs to see**. From the user's perspective, a covered call has exactly two outcomes:

**Outcome A — BTC stays below strike price:**
- Option expires worthless
- User gets BTC back
- User keeps the premium
- Done

**Outcome B — BTC goes above strike price:**
- User's BTC is effectively "sold" at the strike price
- User receives strike price value + premium
- User chose that strike, so they were happy to sell at that price
- Done

There is no "loss" scenario in the covered call framing. Both outcomes are wins — either you keep your asset + premium, or you sell at a price you chose + premium.

### 10.2 Why Margin Doesn't Matter (But We Still Need It)

Derive's Portfolio Margin system runs 23 scenario stress tests continuously during the option's life. For a 1:1 covered call, we proved that the margin surplus is always ~76% of BTC value — **liquidation is mathematically impossible**.

This means:
- The margin system will never bother the user
- No margin calls, no liquidation alerts, no forced closures
- The user experience is identical to Rysk's "locked collateral" model
- But unlike Rysk, users CAN exit early if they want

The margin system is a protocol detail we rely on but never expose to the user.

### 10.3 Cash Settlement Handling

Derive settles options in **cash (USDC)**, not physical delivery. When a call expires ITM:

1. Derive deducts `(BTC_price - strike_price)` in USDC from the subaccount
2. The user still holds their BTC in the subaccount
3. Our app **automatically sells the BTC** to cover the cash settlement
4. Net result to user: received `strike_price + premium` in USDC

The user sees: *"Your BTC was sold at $110,000. You received $110,500 ($110,000 + $500 premium)."*

Under the hood it's cash settlement + app-triggered BTC sale. Same net result as physical delivery.

### 10.4 Target User Flow

```
DEPOSIT
  1. User connects wallet
  2. User deposits BTC (bridge from L1/L2 if needed)
  3. BTC appears in their account

SELL COVERED CALL
  4. User sees: "Sell covered call — earn yield on your BTC"
  5. Picks expiry: 7 days
  6. Picks strike: $110,000 (shown with probability OTM, premium, APR)
  7. App requests RFQ → MM quotes arrive in seconds
  8. User sees: "Premium: $500 (24% APR)"
  9. User confirms → call is sold, $500 premium credited immediately

WHILE POSITION IS OPEN
  10. Single position card shows:
      - "1 BTC Covered Call @ $110,000"
      - "Expires: Feb 28, 2026 (5 days)"
      - "Premium earned: $500"
      - "Status: BTC at $103,000 (below strike — on track to keep BTC)"
  11. Option to "Buy to Close" or "Roll" at any time

AT EXPIRY (fully automatic, no user action)
  12a. BTC at $105,000 (below strike):
       → "Your call expired. You kept your BTC + $500 premium."
       → BTC unlocked, ready for next covered call

  12b. BTC at $120,000 (above strike):
       → "Your BTC was sold at $110,000. You received $110,500."
       → USDC credited to account
```

### 10.5 Comparison: Our UX vs Rysk vs Robinhood

| Feature | Robinhood | Rysk V12 | Our Platform |
|---------|-----------|----------|-------------|
| Deposit + sell in one flow | No (must own shares first) | Yes | Yes |
| Unified position view | No (separate legs) | Yes | Yes |
| Early exit | Yes (buy to close, roll) | No | Yes |
| Automatic settlement | Yes | Yes | Yes |
| Collateral haircut | None (shares = collateral) | None (1:1 locked) | ~3% (PM, but liquidation impossible) |
| Execution | PFOF | RFQ | RFQ |
| Physical vs cash settlement | Physical | Physical | Cash (app handles conversion) |
| Rolling | Yes (first-class) | No | Yes (planned) |
| Education in flow | Yes (Greeks, probability) | Minimal | Yes (planned) |

---

## 11. Recommended Architecture — PM Subaccounts + RFQ

### 11.1 Why This Approach

| Reason                                  | Detail                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| No custom contracts needed              | Everything uses existing Derive infrastructure                      |
| No haircut problem                      | PM gives ~3% contingency; liquidation is mathematically impossible  |
| Per-user, self-directed                 | Users pick their own strikes and expiries                           |
| RFQ for execution                       | MM fills privately, not competing on orderbook                      |
| Multiple subaccounts per wallet         | Supported natively by Derive                                        |
| Extensible from existing codebase       | Infrastructure already in place                                     |

### 11.2 Per-Position Subaccount Model

Each covered call position gets its own isolated PM subaccount:

```
1. Create new PM subaccount (margin_type: "PM")
2. Deposit BTC as base collateral into the subaccount
3. Sell 1 call via RFQ against the subaccount
4. Wait for expiry
   - OTM: Call expires worthless, BTC stays, premium kept
   - ITM: Cash settlement, app auto-sells BTC to cover difference
5. Close subaccount, return remaining funds to user
```

### 11.3 Benefits of Per-Position Subaccounts

- **Clean isolation** — each position is self-contained
- **Simple settlement logic** — no cross-position dependencies
- **Clear accounting** — P&L per position is trivially calculable
- **No cross-position risk contamination** — one bad position cannot affect others

### 11.4 What Exists in the Current Codebase

| Component                    | Status            | Notes                                    |
| ---------------------------- | ----------------- | ---------------------------------------- |
| SCW creation + session keys  | Fully implemented | Alchemy AA LightAccount with EIP-712     |
| BTC/ETH bridging via Socket  | Implemented       | `bridge-config.ts` has WBTC/WETH support |
| EIP-712 signing for trades   | Fully implemented | Can be extended for RFQ signatures       |
| EarnFlow UI skeleton         | Exists            | Needs adaptation for covered calls       |
| REST client pattern          | Implemented       | Extensible for RFQ endpoints             |
| WebSocket subscriptions      | Implemented       | Extensible for RFQ channels              |
| Zustand stores               | 4 stores          | Extensible for position tracking         |

### 11.5 What Needs to Be Built

#### 1. RFQ Integration

```
client.ts additions:
  - send_rfq(legs, subaccount_id)
  - poll_rfqs(rfq_id)
  - rfq_accept(rfq_id, quote_id)
  - rfq_reject(rfq_id, quote_id)

types.ts additions:
  - RFQRequest { legs, subaccount_id, direction }
  - RFQQuote { quote_id, legs_hash, price, expiry }
  - RFQQuoteStatus { status, quotes[], best_quote }

hooks:
  - useRFQRequest() — send RFQ and manage lifecycle
  - useRFQQuotes(rfq_id) — poll/subscribe to incoming quotes
  - useAcceptQuote(rfq_id, quote_id) — accept and execute

WebSocket:
  - Subscribe to {wallet}.rfqs channel for real-time quote updates
```

#### 2. Portfolio Margin Subaccounts

```
- Create PM subaccounts (margin_type: "PM" instead of "SM")
- Per-position subaccount creation and management
- Collateral deposit per subaccount (BTC/ETH, not just USDC)
- Subaccount lifecycle management (create, fund, trade, settle, close)
```

#### 3. Position Management

```
- Track covered call positions per subaccount
- Monitor expiry dates with countdown/alerts
- Auto-settlement logic (sell BTC if call expires ITM)
- Position history and performance tracking
- Aggregate portfolio view across all subaccounts
```

#### 4. UI/UX

```
- Deposit BTC/ETH flow (bridge from L1/other L2 + deposit to subaccount)
- Strike/expiry selector with live RFQ premium quotes
- Active positions dashboard (per-position cards with P&L)
- Settlement status tracking (pending, settled, claimed)
- Historical P&L display per position and aggregate
```

---

## 12. Alternative Approaches Considered

### Path A: Build on Derive with PM (RECOMMENDED)

| Aspect                | Assessment                                                    |
| --------------------- | ------------------------------------------------------------- |
| Time to market        | Fastest                                                       |
| Liquidity             | Leverage existing Derive MMs                                  |
| Capital efficiency    | ~3% base contingency, liquidation impossible for 1:1          |
| Custom contracts      | None required                                                 |
| Risk                  | Depends on Derive protocol availability and MM participation  |

### Path B: Build Own Settlement (Rysk-style)

| Aspect                | Assessment                                                    |
| --------------------- | ------------------------------------------------------------- |
| Collateralization     | Zero haircut, zero liquidation risk                           |
| Development effort    | Very high — building an options settlement protocol           |
| MM relationships      | Must establish independently                                  |
| Capital efficiency    | Zero (100% locked)                                            |
| Time to market        | Longest                                                       |

### Path C: Hybrid — Own Contracts + Derive's RFQ

| Aspect                | Assessment                                                    |
| --------------------- | ------------------------------------------------------------- |
| Architecture          | Simple escrow contracts locking BTC 1:1                       |
| Pricing               | Use Derive's RFQ for MM pricing                              |
| Feasibility concern   | Unknown whether MMs would settle against custom contracts     |
| Development effort    | Moderate                                                      |
| Risk                  | Highest uncertainty                                           |

### Path D: Per-User CCTSA Deployment

| Aspect                | Assessment                                                    |
| --------------------- | ------------------------------------------------------------- |
| Architecture          | Deploy CCTSA contract per user                                |
| Gas costs             | Very high per-user deployment                                 |
| Margin system         | Standard Margin only (25% haircut — worse than PM)           |
| Operational complexity| Very high                                                     |
| Recommendation        | **Not recommended**                                           |

---

## 13. Sources

### Derive Documentation

- [API Overview](https://docs.derive.xyz/reference/overview)
- [About Derive](https://docs.derive.xyz/docs/about-derive)
- [Standard Margin](https://docs.derive.xyz/docs/standard-margin-1)
- [Portfolio Margin](https://docs.derive.xyz/docs/portfolio-margin-1)
- [Supported Products](https://docs.derive.xyz/docs/supported-products-1)
- [Asset Parameters](https://docs.derive.xyz/docs/asset-parameters-1)
- [Orderbook Margin](https://docs.derive.xyz/reference/open-orders-margin)
- [Fees](https://docs.derive.xyz/reference/fees-1)
- [Session Keys](https://docs.derive.xyz/reference/session-keys)
- [Get Ticker](https://docs.derive.xyz/reference/public-get_ticker)
- [Get Tickers](https://docs.derive.xyz/reference/public-get_tickers)
- [Get All Currencies](https://docs.derive.xyz/reference/public-get_all_currencies)
- [Order Endpoint](https://docs.derive.xyz/reference/private-order)
- [RFQ Documentation](https://docs.derive.xyz/reference/rfq-quoting-and-execution)
- [Submit Order Guide](https://docs.derive.xyz/reference/submit-order)
- [Protocol Constants](https://docs.derive.xyz/reference/protocol-constants)

### Derive Insights Blog

- [Introducing Cross-Asset Collateral Portfolio Margin](https://insights.derive.xyz/introducing-cross-asset-collateral-portfolio-margin/)
- [A Technical Overview of Lyra V2](https://insights.derive.xyz/a-technical-overview-of-lyra-v2/)
- [Can an Orderbook Be a Public Good?](https://insights.derive.xyz/can-an-orderbook-be-a-public-good/)
- [C-Tokens](https://insights.derive.xyz/c-tokens/)
- [Introducing B-Tokens: Tokenized Basis Trades](https://insights.derive.xyz/introducing-b-tokens-tokenized-basis-trades/)
- [Derive's New RFQ Experience](https://insights.derive.xyz/derives-new-rfq-experience/)

### Derive GitHub

- [derivexyz (Organization)](https://github.com/derivexyz)
- [v2-matching — TSA Contracts](https://github.com/derivexyz/v2-matching)
- [CCTSA.sol — Covered Call Contract](https://github.com/derivexyz/v2-matching/blob/master/src/tokenizedSubaccounts/CCTSA.sol)
- [TSA Directory](https://github.com/derivexyz/v2-matching/tree/master/src/tokenizedSubaccounts)
- [v2-core — Core Protocol](https://github.com/derivexyz/v2-core)
- [v2-aa — Account Abstraction](https://github.com/derivexyz/v2-aa)
- [cockpit — Vault Executors & MM Algos (Rust)](https://github.com/derivexyz/cockpit)
- [lyra-vaults — V1 Legacy Vaults](https://github.com/derivexyz/lyra-vaults)
- [v1-core — V1 Core (Legacy)](https://github.com/derivexyz/v1-core)
- [v2-scripts — Tutorials](https://github.com/derivexyz/v2-scripts)

### Derive Help Center

- [Vault Smart Contracts](https://help.derive.xyz/en/articles/9351681-vault-smart-contracts)
- [Harvest Strategy](https://help.derive.xyz/en/articles/9351620-harvest-strategy)
- [BULL Execution](https://help.derive.xyz/en/articles/9555719-bull-execution)
- [Audits — Vault Smart Contracts](https://help.derive.xyz/en/articles/9709491-audits-vault-smart-contracts)

### Rysk Finance

- [Rysk Documentation](https://docs.rysk.finance)
- [Rysk V12 Solution](https://docs.rysk.finance/getting-started/solution-rysk-v12)
- [How It Works](https://docs.rysk.finance/getting-started/protocol-and-product/how-it-works)
- [Products](https://docs.rysk.finance/getting-started/protocol-and-product/products)
- [FAQ](https://docs.rysk.finance/getting-started/protocol-and-product/faq)
- [Why Rysk](https://docs.rysk.finance/why-rysk)
- [What Are Covered Calls](https://docs.rysk.finance/what-are-covered-calls)
- [How to Use Rysk](https://docs.rysk.finance/getting-started/protocol-and-product/how-to-use-rysk)
- [Rysk Ciao Protocol (GitHub)](https://github.com/rysk-finance/ciao-protocol)
- [Rysk App](https://app.rysk.finance)

### Robinhood

- [Basic Options Strategies (Level 2)](https://robinhood.com/us/en/support/articles/basic-options-strategies/)
- [Options Strategies for Retirement Accounts](https://robinhood.com/us/en/learn/articles/options-strategies-for-retirement-accounts/)
- [Placing an Options Trade](https://robinhood.com/us/en/support/articles/placing-an-options-trade/)
- [Options Chain](https://robinhood.com/us/en/support/articles/options-chain/)
- [Options Chain Metrics](https://robinhood.com/gb/en/support/articles/options-chain-metrics/)
- [Options Collateral](https://robinhood.com/us/en/support/articles/options-collateral/)
- [Expiration, Exercise, and Assignment](https://robinhood.com/us/en/support/articles/expiration-exercise-and-assignment/)
- [Navigating Exercise & Assignment](https://robinhood.com/us/en/learn/articles/navigating-exercise-and-assignment/)
- [Options Rolling](https://robinhood.com/us/en/support/articles/options-rolling/)
- [Profit and Loss Charts](https://robinhood.com/us/en/support/articles/profit-loss-chart/)
- [Trading Fees on Robinhood](https://robinhood.com/us/en/support/articles/trading-fees-on-robinhood/)

### Key Deployed Contracts — Derive Mainnet (Chain ID 957)

| Contract               | Address                                      |
| ---------------------- | -------------------------------------------- |
| SubAccount             | `0xE7603DF191D699d8BD9891b821347dbAb889E5a5` |
| Matching               | `0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD` |
| TradeModule            | `0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b` |
| RFQ                    | `0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D` |
| ETH Option             | `0x4BB4C3CDc7562f08e9910A0C7D8bB7e108861eB4` |
| BTC Option             | `0xd0711b9eBE84b778483709CDe62BacFDBAE13623` |
| StandardRiskManager    | `0x28c9ddF9A3B29c2E6a561c1BC520954e5A33de5D` |
| Entry Point (v0.6.0)   | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| Light Account Factory  | `0x000000893A26168158fbeaDD9335Be5bC96592E2` |
| Paymaster              | `0xa179c3b32d3eE58353d3F277b32D1e03DD33fFCA` |
