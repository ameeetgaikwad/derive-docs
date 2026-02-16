# Derive Integration — Code Review

**Date:** 2025-02-15  
**Reviewer:** Wags (automated code review)

---

## 1. Architecture Overview

This is a **Next.js 16 + React 19** application with two distinct implementations:

### Main App (`src/`)
A full-featured options trading platform with clean separation of concerns:

```
src/
├── app/                          # Next.js App Router pages
│   ├── api/derive/[...path]/     # Catch-all proxy to Derive API (CORS bypass)
│   ├── trade/                    # Options trading page
│   ├── markets/                  # Market overview page
│   ├── portfolio/                # Positions, orders, collateral
│   └── strategies/               # Simplified strategy cards
├── lib/
│   ├── derive/                   # Core Derive protocol integration
│   │   ├── client.ts             # REST client (DeriveRestClient class)
│   │   ├── ws.ts                 # WebSocket client (DeriveWebSocket class)
│   │   ├── signing.ts            # EIP-712 signing (trades, deposits, withdrawals)
│   │   ├── auth.ts               # WS login param generation
│   │   ├── session.ts            # Session key management (localStorage)
│   │   ├── constants.ts          # Chain config, contract addresses, domain separators
│   │   ├── types.ts              # Full TypeScript type definitions
│   │   ├── utils.ts              # BigNumber helpers, instrument name parsing, SCW resolution
│   │   └── instrument-utils.ts   # Option chain grouping (by expiry, by strike)
│   ├── strategies/               # Strategy definitions + resolver
│   └── chain/                    # Derive chain definition for wagmi
├── stores/                       # Zustand stores (account, trade, markets, portfolio)
├── hooks/                        # React hooks organized by domain
│   ├── account/                  # useDeriveAuth, useDeriveAccount (main auth flow)
│   ├── market/                   # useTicker, useOrderbook, useInstruments, useLiveTicker
│   ├── mutations/                # useSubmitOrder, useDeposit, useCancelOrder
│   ├── portfolio/                # usePositions, useCollaterals, useOpenOrders
│   └── strategies/               # useStrategyPreview, useExecuteStrategy
├── providers/                    # DeriveProvider (context combining auth + WS)
└── components/                   # UI components organized by feature
    ├── trade/                    # OptionChain, TradePanel, OrderbookDisplay
    ├── portfolio/                # PositionsTable, CollateralCard, FundsModal
    ├── strategies/               # StrategyCard, PayoffDiagram
    ├── account/                  # AccountStatus, OnboardingModal
    ├── layout/                   # Header, WsStatusBanner, NetworkGuard
    └── ui/                       # Primitives (Button, Card, Input, etc.)
```

**Tech stack:** Next.js 16, React 19, Zustand (state), TanStack Query (data fetching), wagmi/viem (wallet), RainbowKit (connect), Radix UI (primitives), Tailwind CSS, Sonner (toasts).

### Amit's App (`amit/`)
A separate, standalone Next.js app (with its own `package.json`). Branded as **"axiom"** — a yield-focused UI for selling covered calls and cash-secured puts on Derive.

---

## 2. Derive API Integration

### REST API (`src/lib/derive/client.ts`)

**DeriveRestClient** communicates via JSON-RPC style POST requests. In the browser, requests proxy through `/api/derive/[...path]` (Next.js catch-all route) to avoid CORS. On the server, they go directly to `https://api.lyra.finance`.

**Auth mechanism:**
- Three custom headers: `X-LyraWallet`, `X-LyraTimestamp`, `X-LyraSignature`
- Timestamp = `Date.now().toString()` (milliseconds since epoch)
- Signature = `sign(timestamp)` using session key or EOA — **without `0x` prefix**
- Wallet = the Derive **smart contract wallet (SCW)** address, NOT the EOA

**Endpoints used:**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| Public | `public/get_instruments` | List options/perps for a currency |
| Public | `public/get_ticker` | Get ticker for one instrument |
| Public | `public/get_time` | Server time |
| Public | `public/get_all_currencies` | Supported currencies |
| Public | `public/build_register_session_key_tx` | Build on-chain session key registration tx |
| Public | `public/register_session_key` | Register session key (with signed tx) |
| Public | `public/deposit_debug` / `public/withdraw_debug` | Debug signature hashes |
| Private | `private/get_subaccounts` | List subaccounts for a wallet |
| Private | `private/get_account` | Get account info |
| Private | `private/order` | Submit a signed order |
| Private | `private/cancel` / `private/cancel_all` | Cancel orders |
| Private | `private/get_positions` | Current positions |
| Private | `private/get_collaterals` | Subaccount collateral |
| Private | `private/get_open_orders` | Open orders |
| Private | `private/get_margin` / `private/estimate_order_margin` | Margin info |
| Private | `private/create_subaccount` | Create subaccount with deposit |
| Private | `private/deposit` / `private/withdraw` | Fund management |
| Private | `private/register_scoped_session_key` | Register session key (alt method) |

### WebSocket (`src/lib/derive/ws.ts`)

**DeriveWebSocket** handles:
- JSON-RPC 2.0 over WebSocket (`wss://api.lyra.finance/ws`)
- Auto-reconnect with exponential backoff (1s → 30s max)
- 30s heartbeat ping
- Automatic resubscription on reconnect
- Subscription channels: `orderbook.{instrument}.{group}.{depth}`, `ticker_slim.{instrument}.{interval}`
- WS login via `public/login` (wallet + timestamp + signature)

### EIP-712 Signing (`src/lib/derive/signing.ts`)

The signing module is the most complex and critical piece:

- **Order signing:** Encodes trade data as `(address asset, uint subId, int limitPrice, int amount, uint maxFee, uint subaccountId, bool isBid)`, computes EIP-712 `Action` hash with domain separator from Matching.sol, and signs with raw ECDSA (`sign()`) — NOT `signMessage()` which adds an EIP-191 prefix.
- **Deposit/Withdraw signing:** Similar flow but with different module addresses and data encoding. Can use either session key (`signAction`) or wallet (`signActionWithWallet` via `signTypedData`).
- **Domain separator:** Pre-computed from `Matching.sol` on each chain (testnet chain 901, mainnet chain 957).

### Session Key Flow (`src/hooks/account/useDeriveAccount.ts`)

The full authentication flow:

1. **Resolve SCW:** Call `LightAccountFactory.getAddress(eoa, 0)` on Derive Chain RPC (deterministic CREATE2)
2. **Check localStorage** for existing valid session key
3. **Generate new session key** (random private key, 7-day expiry)
4. **Register on-chain:** Build tx → switch to Derive Chain → `SCW.execute(matching, 0, registerSessionKey_data)` via `sendTransaction` → poll until backend recognizes it
5. **Fetch subaccounts** using session key auth
6. **WS login** with session key

Only **1 wallet popup** is needed (the `sendTransaction` for session key registration).

---

## 3. Key Features

### Main App (`src/`)
- **Option Chain:** Full call/put grid grouped by expiry, with real-time ticker data (REST + WS overlay). Click bid/ask to populate order form.
- **Order Submission:** Limit orders with EIP-712 signed trade data. Session key signs orders (no wallet popup per trade).
- **Orderbook:** Live WebSocket orderbook display.
- **Portfolio:** Positions table, open orders (with cancel), collateral balances, P&L summary.
- **Deposits/Withdrawals:** Full flow including ERC-20 transfer (EOA ↔ SCW) + signed internal ledger operations.
- **Strategy Cards:** Predefined strategies (Bullish Bet = buy call, Downside Protection = buy put, Earn Sideways = sell covered call) with auto-instrument selection based on spot price.
- **Account Onboarding:** Create subaccount with initial deposit.

### Amit's App (`amit/`)
- **Yield-focused UI:** "Earn" page for selling covered calls and cash-secured puts
- **Strike selector cards** with APR calculation
- **Outcome calculator** showing premium earned and expiry scenarios
- **Portfolio view** showing positions
- **Simpler auth:** Signs timestamp with EOA directly (no session key rotation), tries EOA as wallet → create account → fallback to manual Derive wallet input

---

## 4. `amit/` vs `src/` — Key Differences

| Aspect | `src/` (main) | `amit/` |
|--------|---------------|---------|
| **Branding** | Generic options trading | "axiom" — yield-focused |
| **Auth** | Session key on-chain registration (1 popup), session keys for ongoing signing | EOA timestamp signing (1 popup per session), signs orders with EOA wallet |
| **API calls** | Class-based `DeriveRestClient` with singleton pattern | Functional `post()` helper with per-route Next.js API endpoints |
| **API routes** | Single catch-all proxy `[...path]/route.ts` | Individual routes: `/api/derive/order`, `/api/derive/tickers`, etc. |
| **WebSocket** | Full WS client with live tickers + orderbook | No WebSocket — polls REST every 5-10s |
| **Order signing** | Session key raw ECDSA (`sign()` hash directly) | `walletClient.signTypedData()` with EOA |
| **EIP-712 domain** | `{name: "Matching", version: "1.0", chainId, verifyingContract: matching}` | `{name: "Derive", version: "1", chainId}` (⚠️ no `verifyingContract`) |
| **Trade data encoding** | Binary ABI: `(address, uint256, int256, int256, uint256, uint256, bool)` | Higher-level: `(string instrumentName, bool, uint256, uint256, uint256, string orderType, bool)` |
| **State management** | Zustand stores + TanStack Query | React `useState` + context |
| **UI** | Full option chain + orderbook + portfolio | Streamlined earn flow with strike cards |
| **Deposit/Withdraw** | Full implementation (ERC-20 transfer + internal ledger) | Links to app.derive.xyz for deposits |

**⚠️ Critical difference in signing:** The `amit/` version uses a different EIP-712 domain (missing `verifyingContract`) and encodes trade data differently (string instrument name vs binary address+subId). The `src/` version matches the actual Derive protocol more closely. The `amit/` signing may not work correctly for order submission.

---

## 5. Code Quality Assessment

### Strengths
- **Excellent TypeScript coverage:** Comprehensive types for all API responses, WebSocket messages, and internal state
- **Well-organized architecture:** Clean separation into lib/hooks/stores/components
- **Robust auth flow:** Session key management with localStorage persistence, auto-restore, background verification, and graceful fallbacks
- **Good error handling in REST client:** Handles HTML responses from nginx, non-JSON responses, wraps errors in typed `DeriveApiError`
- **WebSocket resilience:** Auto-reconnect, heartbeat, resubscription, cleanup on disconnect
- **Detailed inline comments:** Especially in signing and auth code — explains WHY decisions were made (e.g., "Raw ECDSA sign — NO EIP-191 prefix")

### Issues & Concerns

**Security:**
- 🔴 **Session private keys in localStorage:** `strikely_session_key` stores the raw private key. Any XSS vulnerability leaks signing capability. This is somewhat mitigated by 7-day expiry and scoped permissions, but is still a risk.
- 🟡 **Verbose console.log in production:** Auth headers, wallet addresses, and signature prefixes are logged. These should be behind a debug flag.
- 🟡 **API proxy forwards all headers:** The catch-all proxy (`[...path]/route.ts`) forwards auth headers, which is correct, but has no rate limiting or validation.

**Code Quality:**
- 🟡 **Singleton pattern for clients:** `getSharedRestClient()` / `getSharedWsClient()` use module-level variables. This works but makes testing difficult and can cause issues with HMR in development.
- 🟡 **`useDeriveAccount` is very large** (~250 lines): The `authenticate` callback handles SCW resolution, session key generation, on-chain registration, polling, and subaccount fetching. Could be broken into smaller functions.
- 🟡 **Inconsistent response handling in `getSubaccounts`:** Handles 4+ different response formats with cascading fallbacks. This suggests the API is unstable or underdocumented — but the code handles it gracefully.
- 🟡 **Magic numbers:** `maxFee: "100"` hardcoded in order submission, `1000000` gas in session key registration. Should be configurable or at least named constants.
- 🟠 **`amit/` domain separator mismatch:** Missing `verifyingContract` field will likely cause signature validation failures. This is a potential bug if `amit/` is used for actual trading.

**Missing Features:**
- No market orders (only limit orders implemented)
- No multi-leg order support (needed for spreads/straddles)
- No trade history display
- No WebSocket authentication error recovery

---

## 6. RangeBet Applicability

For building a **"In Range / Breaks Out"** betting UI on Derive, here's what's directly reusable:

### Core Infrastructure (use as-is)
| Component | Location | Why |
|-----------|----------|-----|
| **DeriveRestClient** | `src/lib/derive/client.ts` | Full REST API wrapper — works for any Derive interaction |
| **DeriveWebSocket** | `src/lib/derive/ws.ts` | Live price feeds for strike monitoring |
| **EIP-712 signing** | `src/lib/derive/signing.ts` | Order signing, deposit/withdraw signing — battle-tested |
| **Session key mgmt** | `src/lib/derive/session.ts` | No-popup trading after initial setup |
| **Auth flow** | `src/hooks/account/useDeriveAccount.ts` | Full onboarding (SCW resolution → session key → subaccount) |
| **Types** | `src/lib/derive/types.ts` | Comprehensive TypeScript types |
| **Constants** | `src/lib/derive/constants.ts` | Contract addresses, chain config |
| **API proxy** | `src/app/api/derive/[...path]/route.ts` | CORS bypass |
| **Deposit/Withdraw** | `src/hooks/mutations/useDeposit.ts` | Full fund management |

### What RangeBet Needs to Build

A "Range Bet" is essentially buying a **strangle** (or selling a strangle):
- **"In Range"** = Sell OTM call + Sell OTM put (profit if price stays between strikes)
- **"Breaks Out"** = Buy OTM call + Buy OTM put (profit if price moves beyond strikes)

**New components needed:**

1. **Range Selector UI:** Two strike pickers (upper and lower bound) instead of the option chain. Could adapt `amit/`'s `StrikeCard` pattern.

2. **Multi-leg Order Submission:** Currently `useSubmitOrder` handles single orders. Need to submit 2 orders atomically or in sequence (call + put at different strikes, same expiry).

3. **Payout Calculator:** Given range [low, high], premium collected/paid, show payoff diagram. The `src/lib/strategies/` module has the pattern but only handles single-leg strategies.

4. **Spot Price Monitor:** `useLiveTicker` with `{asset}-PERP` gives real-time spot. Use this to show live "in range / out of range" status.

5. **Simplified Instrument Resolution:** Given an asset, expiry preference, and desired range width, auto-select the right call and put instruments. Adapt `src/lib/strategies/resolver.ts`.

### Suggested Architecture

```
rangebet/
├── lib/derive/          # Copy entire directory from src/lib/derive/
├── hooks/
│   ├── useRangebet.ts   # Core: select range, calculate premiums, submit 2-leg order
│   └── useSpotMonitor.ts # Live "in range" status
├── components/
│   ├── RangeSelector.tsx # Slider or card-based range picker
│   ├── PayoffPreview.tsx # Visual payoff diagram
│   └── BetCard.tsx       # "In Range" / "Breaks Out" toggle + submit
└── app/
    └── page.tsx          # Single-page betting UI
```

**Key insight:** The entire `lib/derive/` directory is protocol-level code with no UI coupling. It's the main asset — copy it wholesale and build a simpler UI on top.

---

## Summary

This is a **well-built, production-quality Derive integration**. The `src/` codebase has correct EIP-712 signing, robust session key management, and comprehensive API coverage. The `amit/` version is a useful UX reference for simplified flows but has signing discrepancies that may prevent it from working.

For RangeBet, use `src/lib/derive/*` as the foundation and build a new UI layer focused on range selection and dual-leg order execution.
