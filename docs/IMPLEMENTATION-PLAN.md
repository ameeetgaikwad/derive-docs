# Covered Call Platform — Implementation Plan

> **Date:** 2026-02-22
> **Prereq:** [COVERED-CALL-PLATFORM-RESEARCH.md](./COVERED-CALL-PLATFORM-RESEARCH.md)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Critical Design Correction: Cash Settlement](#2-critical-design-correction-cash-settlement)
3. [Phase 1: Foundation — Constants & Multi-Asset Support](#3-phase-1-foundation--multi-asset-support)
4. [Phase 2: PM Subaccount Lifecycle](#4-phase-2-pm-subaccount-lifecycle)
5. [Phase 3: RFQ Integration](#5-phase-3-rfq-integration)
6. [Phase 4: Position Management & Settlement](#6-phase-4-position-management--settlement)
7. [Phase 5: Frontend — Covered Call Flow](#7-phase-5-frontend--covered-call-flow)
8. [Phase 6: Backend Settlement Service](#8-phase-6-backend-settlement-service)
9. [Smart Contract Assessment](#9-smart-contract-assessment)
10. [File-by-File Change Map](#10-file-by-file-change-map)
11. [Open Questions](#11-open-questions)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    USER WALLET                       │
│              (MetaMask / WalletConnect)              │
└───────────────┬─────────────────────────┬────────────┘
                │                         │
        Bridge WBTC/WETH          Connect + Session Key
        (Socket Finance)          (Alchemy AA / EIP-712)
                │                         │
                ▼                         ▼
┌───────────────────────┐   ┌──────────────────────────┐
│   Derive Chain (L2)   │   │    Next.js Frontend      │
│                       │   │                          │
│  ┌─────────────────┐  │   │  - Deposit flow          │
│  │ PM2 Subaccount  │  │   │  - Strike/expiry picker  │
│  │ (per position)  │  │   │  - RFQ premium display   │
│  │                 │  │   │  - Position dashboard     │
│  │ - WBTC collat.  │  │   │  - Settlement display     │
│  │ - Short call    │  │   │                          │
│  │ - USDC (prem.)  │  │   └────────────┬─────────────┘
│  └─────────────────┘  │                │
│                       │                │ REST + WebSocket
│  Matching / RFQ       │◄───────────────┘
│  Settlement           │
│  Risk Manager (PM2)   │   ┌──────────────────────────┐
│                       │   │  Settlement Service       │
└───────────────────────┘   │  (Backend / Cron)         │
                            │                           │
                            │  - Poll settlement        │
                            │  - ITM: auto-sell BTC     │
                            │    to cover USDC deficit  │
                            │  - Return BTC at strike   │
                            │  - Uses shared session key│
                            └───────────────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Margin type | **PM2** (Portfolio Margin v2) | 3% base contingency, best capital efficiency, liquidation impossible for 1:1 covered calls |
| Execution | **RFQ** (not orderbook) | Private MM fills, better pricing for block trades, no orderbook competition |
| Subaccount model | **Per-position** | Clean isolation, simple accounting, no cross-position risk |
| Settlement handling | **Auto-sell via backend** | ITM: auto-sell BTC to cover USDC deficit, return remaining BTC worth strike price. No user decision needed. |
| Session keys | **Two per user** (frontend + backend) | Both wallet-level admin scope. Frontend key in localStorage for user actions. Separate backend key in Vercel KV for auto-sell at settlement. Registered together during onboarding. |
| ITM return asset | **BTC** (not USDC) | Users deposited BTC because they want BTC. Return strike-price-worth of BTC. Can add USDC option later. |
| Asset support | **WBTC, WETH** | PM2 accounts are single-market (one per underlying) |

---

## 2. Cash Settlement + Auto-Rebalance

**Derive options are cash-settled in USDC, not physically delivered.** We handle this transparently: on ITM expiry, we auto-sell enough BTC to cover the USDC deficit and return remaining BTC (worth ~strike price) to the user. No delays, no user choices at settlement time.

### What Actually Happens at ITM Expiry

Example: User holds 1 WBTC + short 1 BTC $110k call. BTC settles at $120k.

```
BEFORE SETTLEMENT:
  Subaccount balance:
    WBTC: 1.0
    USDC: +$500 (premium received)
    Short call: 1 contract

STEP 1 — PROTOCOL SETTLEMENT (automatic at 8:00 AM UTC):
  - Short call removed from positions
  - USDC debited: -(120,000 - 110,000) = -$10,000

  Subaccount after settlement:
    WBTC: 1.0
    USDC: -$9,500  ($500 premium - $10,000 settlement)

STEP 2 — AUTO-REBALANCE (our backend, immediate):
  - Detect negative USDC balance
  - Sell WBTC via spot market order: sell 0.0792 BTC at $120k = $9,500
  - USDC deficit cleared to $0

  Subaccount after rebalance:
    WBTC: 0.9208  (worth $110,500 at $120k = strike + premium)
    USDC: $0

STEP 3 — WITHDRAW:
  - Withdraw 0.9208 WBTC to user's wallet
  - User received: strike_price + premium worth of BTC
```

### OTM Expiry (Simple)

```
BEFORE: WBTC: 1.0, USDC: +$500, Short call: 1 contract
AFTER:  WBTC: 1.0, USDC: +$500  ← Call expired worthless, premium kept
```

User gets all BTC back + premium (converted to BTC or kept as USDC).

### UX Presentation

```
ITM: "Your BTC was sold at $110,000. You received 0.9208 BTC ($110,500)."
     [Withdraw BTC] [Sell Another Call]

OTM: "Your call expired. You kept your BTC + $500 premium."
     [Withdraw All] [Sell Another Call]
```

### Why Return BTC, Not USDC

- Users deposited BTC because they want to hold BTC
- Returning strike-price-worth of BTC = same economic outcome as physical delivery
- Can add "auto-sell to USDC" option later, but default is BTC back
- Simpler than asking users to make decisions at settlement time

### Auto-Rebalance Implementation

The auto-sell uses Derive's spot market via `private/order`:

```
instrument_name: "BTC-USDC"
direction: "sell"
order_type: "market"
time_in_force: "ioc"  (immediate or cancel)
amount: abs(usdc_deficit) / btc_spot_price
```

This is signed with the existing session key (admin scope, wallet-level — works across all subaccounts). See Section 2.1 for session key details.

### 2.1 Session Key Architecture

**Session keys are wallet-level, not per-subaccount.** One admin session key operates across all PM2 subaccounts.

```
EOA (user's MetaMask)
  ↓ deterministic (CREATE2)
Derive SCW (Smart Contract Wallet)
  ↓ registered once during onboarding
Session Key (admin scope, ~perpetual on-chain expiry)
  ↓ can sign for ANY subaccount under this wallet
  ├── PM2 Subaccount #1 (BTC covered call position)
  ├── PM2 Subaccount #2 (another BTC position)
  └── PM2 Subaccount #3 (ETH position)
```

**Key facts:**
- On-chain expiry: `9999999999` (~317 years, effectively permanent)
- Client-side rotation: 7 days (localStorage), re-registered if expired
- Registration: once during onboarding via paymaster-sponsored UserOp
- Scope: `admin` — can trade, deposit, withdraw on any subaccount
- **No re-registration needed** when creating new subaccounts
- Stored in localStorage as `strikely_session_key`

**Two session keys per user:**

| Key | Purpose | Registered | Stored |
|-----|---------|------------|--------|
| Frontend session key | User-facing: deposits, RFQ execution, withdrawals | During onboarding (paymaster-sponsored) | localStorage |
| Backend session key | Auto-sell at ITM settlement | During onboarding (same UserOp bundle) | Vercel KV (encrypted) |

**What this means for covered calls:**
- Create as many PM2 subaccounts as needed (up to 32 per wallet)
- Both session keys operate across all subaccounts (wallet-level scope)
- Frontend key: user signs RFQ, deposits BTC, withdraws after expiry
- Backend key: settlement service auto-sells BTC to cover USDC deficit at ITM expiry

---

## 3. Phase 1: Foundation — Multi-Asset Support

### 3.1 Extend Constants

**File:** `src/lib/derive/constants.ts`

```
Changes needed:
- Add WETH_DECIMALS = 18, WBTC_DECIMALS = 8
- Add wethAddress, wethCashAsset to DeriveConfig
- Add wbtcAddress, wbtcCashAsset to DeriveConfig
- Add portfolioManager address (PM2 risk manager contract)
- Create getAssetConfig(assetName) helper function
- Populate mainnet + testnet addresses
```

**Addresses needed (must look up from Derive protocol constants):**
- WETH token address on Derive L2
- WETH cash asset address on Derive L2
- WBTC token address on Derive L2
- WBTC cash asset address on Derive L2
- PM2 risk manager contract address

**Source for addresses:** [Protocol Constants](https://docs.derive.xyz/reference/protocol-constants) or querying `public/get_all_currencies` API.

### 3.2 Extend Client Types

**File:** `src/lib/derive/client.ts`

```
Change:
  margin_type?: "SM" | "PM"
To:
  margin_type?: "SM" | "PM" | "PM2"
```

### 3.3 Parameterize Deposit Hooks

**File:** `src/hooks/mutations/useDeposit.ts`

This file has **7 hardcoded USDC references** that need parameterization:

```
1. createSubaccount: asset_name: "USDC" → asset_name: assetName
2. createSubaccount: margin_type: "SM" → margin_type: marginType
3. deposit: asset_name: "USDC" → asset_name: assetName
4. withdraw: asset_name: "USDC" → asset_name: assetName
5. encodeDepositData: config.usdcCashAsset → assetConfig.cashAsset
6. toTokenAmount: USDC_DECIMALS → assetConfig.decimals
7. ensureScwHasUsdc: config.usdcAddress → assetConfig.tokenAddress
```

**Interface changes:**
```typescript
// Before
interface DepositParams { amount: string }

// After
interface DepositParams {
  amount: string;
  assetName?: "USDC" | "WETH" | "WBTC";  // default "USDC"
}

interface CreateSubaccountParams {
  amount: string;
  assetName?: "USDC" | "WETH" | "WBTC";
  marginType?: "SM" | "PM" | "PM2";       // default "SM"
}
```

### 3.4 Extend SCW Approvals + Backend Session Key

**File:** `src/lib/derive/scw-actions.ts`

Current onboarding only approves USDC. For covered calls we need WBTC approval + backend session key.

**Updated onboarding UserOp bundle (single wallet signature, paymaster-sponsored):**
```
1. Register frontend session key (existing)
2. Register backend session key (NEW — generated server-side)
3. Approve USDC to deposit/withdraw modules (existing)
4. Approve WBTC to deposit module (NEW — lazy, or bundle here)
5. Approve WBTC to withdraw module (NEW — lazy, or bundle here)
6. Create initial subaccount (existing)
```

**Backend session key generation:**
- Frontend calls `POST /api/onboarding/backend-key` to get backend key's public address
- Backend generates keypair, stores private key in Vercel KV
- Public key is included in the UserOp bundle for on-chain registration
- Both keys registered in a single paymaster-sponsored transaction

**WBTC approval:** Recommend bundling into onboarding (not lazy) since we know this is a covered call platform — every user will deposit WBTC.

### What Already Works (No Changes)

| Component | Status |
|-----------|--------|
| Bridge config (bridge-config.ts) | Already supports USDC, WETH, WBTC |
| Bridge logic (bridge.ts) | Token-agnostic, works with any BridgeToken |
| Bridge hook (useBridge.ts) | Accepts `token: BridgeToken` parameter |
| Bridge UI (BridgeModal.tsx) | Already has token selector |
| Signing (signing.ts) | encodeDepositData accepts any asset address |
| API client (client.ts) | Accepts asset_name and margin_type params |
| Types (types.ts) | Subaccount has margin_type field |

---

## 4. Phase 2: PM Subaccount Lifecycle

### 4.1 New Hook: `useCoveredCallSubaccount`

**File:** `src/hooks/covered-call/useCoveredCallSubaccount.ts` (new)

Manages the per-position subaccount lifecycle:

```typescript
function useCoveredCallSubaccount() {
  return {
    // Create a new PM2 subaccount with WBTC deposit
    createPosition: (params: {
      amount: string;        // Amount of BTC to deposit
    }) => Promise<{ subaccountId: number }>,

    // Close a position subaccount (withdraw all remaining assets)
    closePosition: (subaccountId: number) => Promise<void>,

    // Get all covered call subaccounts
    positions: CoveredCallPosition[],
  }
}
```

**Flow:**
```
1. Create PM2 subaccount with margin_type: "PM2"
   → Pass portfolioManager address as managerForNewAccount
2. Session key already works (wallet-level, no re-registration needed)
3. Approve WBTC to deposit module (lazy approval, if not already done)
4. Transfer WBTC from EOA → SCW (if needed)
5. Deposit WBTC into the subaccount
6. Return subaccount_id for subsequent RFQ/trading
```

### 4.2 New Store: Covered Call Positions

**File:** `src/stores/covered-call.ts` (new)

```typescript
interface CoveredCallPosition {
  subaccountId: number;
  asset: "WBTC";                     // BTC only for MVP
  amount: string;                    // Deposited WBTC amount
  instrumentName: string | null;     // e.g., "BTC-20260301-110000-C"
  strike: number | null;
  expiry: number | null;             // Unix timestamp
  premiumUsdc: string | null;        // USDC premium received (withdrawn to EOA)
  status: "deposited" | "quoted" | "active" | "expiring" | "settled" | "closed";
  settlementResult?: {
    outcome: "otm" | "itm";
    settlementPrice: number;
    btcReturned: string;             // WBTC amount returned after auto-sell (if ITM)
    pnl: string;
  };
}

interface CoveredCallStore {
  positions: CoveredCallPosition[];
  addPosition: (pos: CoveredCallPosition) => void;
  updatePosition: (subaccountId: number, update: Partial<CoveredCallPosition>) => void;
  removePosition: (subaccountId: number) => void;
}
```

### 4.3 Subaccount Limits

- Max **32 subaccounts** per wallet (Derive limit)
- PM2 accounts are **single-market** (1 per underlying: ETH-only or BTC-only)
- Max **128 positions** per subaccount, **11 expiries**
- For per-position model: each covered call = 1 subaccount = 2 positions (base collateral + short call)

At 32 max subaccounts, user can have ~30 active covered calls (reserving 1-2 for other use). This should be sufficient for retail users.

---

## 5. Phase 3: RFQ Integration

### 5.1 API Client Extensions

**File:** `src/lib/derive/client.ts`

Add these methods to DeriveRestClient:

```typescript
// Send an RFQ to market makers
async sendRfq(params: {
  subaccount_id: number;
  legs: Array<{
    instrument_name: string;
    direction: "buy" | "sell";
    amount: string;
  }>;
}): Promise<{ rfq_id: string }>

// Poll for quotes on an active RFQ
async pollRfqs(params: {
  subaccount_id: number;
  rfq_id?: string;
  status?: "open" | "filled" | "cancelled" | "expired";
}): Promise<{ rfqs: RFQQuote[] }>

// Execute (accept) a quote
async executeQuote(params: {
  subaccount_id: number;
  rfq_id: string;
  legs: Array<{
    instrument_name: string;
    direction: "buy" | "sell";
    amount: string;
    limit_price: string;
    max_fee: string;
  }>;
  nonce: number;
  signature_expiry_sec: number;
  signer: string;
  signature: string;
}): Promise<{ trades: Trade[] }>

// Cancel an RFQ
async cancelRfq(params: {
  subaccount_id: number;
  rfq_id: string;
}): Promise<{ status: string }>
```

### 5.2 RFQ Types

**File:** `src/lib/derive/types.ts`

```typescript
export interface RFQRequest {
  rfq_id: string;
  subaccount_id: number;
  legs: RFQLeg[];
  status: "open" | "filled" | "cancelled" | "expired";
  created_at: number;
}

export interface RFQLeg {
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
}

export interface RFQQuote {
  rfq_id: string;
  quote_id: string;
  legs: Array<{
    instrument_name: string;
    direction: "buy" | "sell";
    amount: string;
    price: string;
  }>;
  legs_hash: string;
  total_premium: string;      // Net premium in USDC
  created_at: number;
  valid_until: number;
}
```

### 5.3 RFQ Hooks

**File:** `src/hooks/covered-call/useRFQ.ts` (new)

```typescript
// Request quotes for selling a covered call
function useRequestQuote() {
  return useMutation({
    mutationFn: async (params: {
      subaccountId: number;
      instrumentName: string;  // e.g., "BTC-20260301-110000-C"
      amount: string;          // e.g., "1" for 1 contract
    }) => {
      return restClient.sendRfq({
        subaccount_id: params.subaccountId,
        legs: [{
          instrument_name: params.instrumentName,
          direction: "sell",
          amount: params.amount,
        }],
      });
    },
  });
}

// Poll for incoming quotes
function useQuotes(rfqId: string | null) {
  return useQuery({
    queryKey: ["rfq-quotes", rfqId],
    queryFn: () => restClient.pollRfqs({ rfq_id: rfqId }),
    enabled: !!rfqId,
    refetchInterval: 2000,  // Poll every 2 seconds
  });
}

// Accept a quote (sign and execute)
function useAcceptQuote() {
  return useMutation({
    mutationFn: async (params: {
      subaccountId: number;
      rfqId: string;
      quote: RFQQuote;
    }) => {
      // Sign each leg with session key (EIP-712)
      // Submit to executeQuote
    },
  });
}
```

### 5.4 WebSocket RFQ Channel

**File:** `src/lib/derive/ws.ts` (extend)

```
Subscribe to: {wallet}.rfqs
This channel pushes real-time quote updates instead of polling.
```

### 5.5 RFQ Signing

The RFQ execution requires EIP-712 signing similar to regular orders. The `legs_hash` from the quote is incorporated into the signature to ensure both parties agree on exact terms.

**File:** `src/lib/derive/signing.ts` (extend)

```typescript
// Encode RFQ execution data (similar to encodeTradeData but for multi-leg)
function encodeRfqData(params: {
  legs: Array<{
    asset: Hex;
    subId: bigint;
    limitPrice: bigint;
    amount: bigint;
    maxFee: bigint;
  }>;
  subaccountId: number;
  isBid: boolean;
}): Hex
```

Refer to [RFQ Quoting and Execution](https://docs.derive.xyz/reference/rfq-quoting-and-execution) for exact signing format.

### 5.6 Premium Withdrawal to EOA

When the RFQ fills, premium USDC lands in the PM2 subaccount. We immediately withdraw it to the user's EOA on Derive L2.

**Flow:**
```
1. RFQ fills → premium USDC credited to PM2 subaccount
2. Withdraw USDC from PM2 subaccount → SCW (via private/withdraw)
3. Transfer USDC from SCW → EOA on Derive L2 (on-chain transfer)
4. User sees USDC in their wallet, can bridge out or hold
```

This uses the existing `useWithdraw()` flow in `useDeposit.ts`, targeting the PM2 subaccount instead of the default subaccount. The premium is the user's to keep regardless of option outcome.

---

## 6. Phase 4: Position Management & Settlement

### 6.1 Position Monitoring Hook

**File:** `src/hooks/covered-call/usePositionMonitor.ts` (new)

```typescript
function usePositionMonitor(subaccountId: number) {
  // Poll positions every 10s
  const positions = useQuery({
    queryKey: ["cc-positions", subaccountId],
    queryFn: () => restClient.getPositions(subaccountId),
    refetchInterval: 10_000,
  });

  // Poll collaterals every 15s
  const collaterals = useQuery({
    queryKey: ["cc-collaterals", subaccountId],
    queryFn: () => restClient.getCollaterals(subaccountId),
    refetchInterval: 15_000,
  });

  // Compute derived state
  const status = useMemo(() => {
    if (!positions.data) return "loading";
    const hasOption = positions.data.some(p => p.instrument_type === "option");
    if (!hasOption && collaterals.data) return "settled";  // Option expired
    return "active";
  }, [positions.data, collaterals.data]);

  return { positions, collaterals, status };
}
```

### 6.2 Settlement Detection

**Detection methods (ordered by preference):**

1. **WebSocket** `{subaccount_id}.balances` — Real-time USDC balance changes at settlement
2. **Poll** `private/get_positions` — Option disappears from active positions
3. **Poll** `public/get_option_settlement_prices` — Settlement price transitions from null to number

**File:** `src/hooks/covered-call/useSettlementDetector.ts` (new)

```typescript
function useSettlementDetector(position: CoveredCallPosition) {
  // Only activate near expiry (within 1 hour)
  const nearExpiry = position.expiry && Date.now() > (position.expiry - 3600000);

  // Poll settlement prices when near expiry
  const settlement = useQuery({
    queryKey: ["settlement", position.instrumentName],
    queryFn: () => restClient.getSettlementPrices(position.asset === "WBTC" ? "BTC" : "ETH"),
    enabled: nearExpiry,
    refetchInterval: nearExpiry ? 30_000 : false,  // Every 30s near expiry
  });

  // Detect when option disappears from positions
  const positions = useQuery({
    queryKey: ["cc-positions", position.subaccountId],
    queryFn: () => restClient.getPositions(position.subaccountId),
    enabled: nearExpiry,
    refetchInterval: nearExpiry ? 10_000 : 60_000,
  });

  // Determine outcome
  const isSettled = positions.data && !positions.data.some(p =>
    p.instrument_name === position.instrumentName
  );

  return { isSettled, settlementPrice: settlement.data?.price };
}
```

### 6.3 Post-Settlement Actions

Settlement is fully automated — no user decision needed at expiry.

**For OTM expiry (automatic):**
```
1. Option expires worthless → premium kept as USDC in subaccount
2. User sees: "Your call expired. BTC + $500 premium available."
3. Actions: [Withdraw All] [Sell Another Call]
```

**For ITM expiry (automatic — no delay):**
```
1. Protocol settles → USDC deficit created
2. Backend auto-sells enough BTC to zero out USDC deficit (spot market order)
3. Remaining BTC ≈ position_size × strike_price / settlement_price (+ premium)
4. User sees: "Your BTC was sold at $110,000. 0.9208 BTC ($110,500) available."
5. Actions: [Withdraw BTC] [Sell Another Call]
```

**Future additions (not MVP):**
- "Keep my BTC" option — user deposits USDC to cover deficit instead of auto-sell
- Auto-roll — automatically sell next week's call on OTM expiry

### 6.4 API Endpoints to Add to Client

**File:** `src/lib/derive/client.ts`

```typescript
// Get settlement prices for a currency
async getSettlementPrices(currency: string): Promise<SettlementPrice[]>
// Method: public/get_option_settlement_prices

// Get settlement history for a subaccount
async getSettlementHistory(subaccountId: number): Promise<SettlementRecord[]>
// Method: public/get_option_settlement_history
```

---

## 7. Phase 5: Frontend — Covered Call Flow

### 7.1 New Pages / Routes

```
/earn                    → Main covered call landing
/earn/deposit            → Deposit BTC/ETH flow
/earn/sell               → Select strike/expiry, get RFQ quote
/earn/positions          → Active positions dashboard
/earn/position/[id]      → Single position detail
```

Or integrate into existing routes:
```
/trade → Add "Covered Call" tab alongside existing trading
/portfolio → Add "Covered Calls" section
```

### 7.2 Core UI Components

**File:** `src/components/covered-call/DepositFlow.tsx` (new)

```
Step 1: Select asset (BTC or ETH)
Step 2: Enter amount
Step 3: Bridge if needed (from L1/other L2)
Step 4: Confirm → Creates PM2 subaccount + deposits
```

**File:** `src/components/covered-call/SellCallFlow.tsx` (new)

```
Step 1: Select expiry (7d, 14d, 30d tabs)
Step 2: Select strike (cards showing premium, APR, probability OTM)
Step 3: Review RFQ quote from MMs (auto-refreshes)
Step 4: Confirm → Signs and executes RFQ
```

**File:** `src/components/covered-call/PositionCard.tsx` (new)

```
Shows per position:
- Asset + amount ("1 BTC")
- Strike + expiry ("$110,000 Call · Expires Feb 28")
- Premium earned ("$500 · 24% APR")
- Current status ("BTC at $103,000 — below strike")
- Time remaining ("5 days 4 hours")
- Actions: [Buy to Close] [Roll] [Details]
```

**File:** `src/components/covered-call/SettlementCard.tsx` (new)

```
Shows after expiry:
- Outcome ("Your call expired worthless" or "Your BTC was sold at $110,000")
- BTC returned: "0.9208 BTC ($110,500)" or "1.0 BTC + $500 premium"
- P&L breakdown
- Action buttons: [Withdraw BTC] [Sell Another Call]
```

### 7.3 Adapt Existing Components

The existing `EarnFlow.tsx` can be refactored or replaced. It already has:
- Asset selector (ETH, BTC)
- Strategy type selector (Covered Call, Cash Secured Put)
- Expiry selector
- Strike selector with APR
- Amount input

Much of this UI can be reused, but the underlying data flow changes from orderbook orders to RFQ.

---

## 8. Phase 6: Backend Settlement Service

### 8.1 Why a Backend Service

- Derive has NO webhooks — must poll or use WebSocket
- Settlement happens at 8:00 AM UTC — need reliable monitoring
- Post-settlement actions (auto-sell BTC, notify user) need server-side execution
- Frontend may not be open at settlement time

### 8.2 Architecture

```
Settlement Service (Node.js or standalone script)
│
├── Cron trigger: 7:55 AM UTC daily
│
├── For each active covered call position:
│   ├── Poll public/get_option_settlement_prices
│   ├── If settled:
│   │   ├── Determine outcome (OTM/ITM)
│   │   ├── If ITM:
│   │   │   ├── Get USDC deficit from private/get_collaterals
│   │   │   ├── Get BTC spot price
│   │   │   ├── Calculate sell amount: abs(usdc_deficit) / btc_price
│   │   │   ├── Place spot market order: sell BTC-USDC (IOC)
│   │   │   ├── Verify USDC balance ≥ 0
│   │   │   └── Mark position as "settled_itm"
│   │   ├── If OTM:
│   │   │   └── Mark position as "settled_otm"
│   │   ├── Calculate P&L
│   │   └── Send notification (push, email, etc.)
│   └── If not settled: retry in 30s
│
└── Cleanup: close fully withdrawn subaccounts
```

### 8.3 Backend Session Key

**Decision: Separate backend session key per user**, registered during onboarding.

```
Onboarding UserOp bundle (paymaster-sponsored, single wallet signature):
  1. Register frontend session key (for user actions)
  2. Register backend session key (for auto-sell at settlement)
  3. Approve WBTC to deposit module
  4. Approve WBTC to withdraw module
  5. Create initial PM2 subaccount
```

**Backend key lifecycle:**
1. Generated server-side during user onboarding (`POST /api/onboarding/create-backend-key`)
2. Public key included in the paymaster-sponsored UserOp bundle
3. Private key stored in Vercel KV: `backend_session_key:{deriveWallet}` (encrypted at rest)
4. Used by settlement service to sign auto-sell spot orders
5. Wallet-level admin scope — works on any subaccount under the wallet

**Auto-sell signing:** Same as any trade — `signAction()` with backend session key's private key, targeting the specific PM2 subaccount.

### 8.4 Can Run As

- **Vercel Cron** — Simple, runs daily at 7:55 UTC
- **Standalone Node.js service** — More control, WebSocket-based detection
- **Next.js API route** — `/api/settlement/check` triggered by cron

### 8.5 Database Requirement

Need persistent storage for position tracking (current Zustand stores are client-side only):

```
Options:
- Vercel KV / Redis (simplest)
- Supabase / Postgres (if more complex queries needed)
- On-chain (subaccount state IS the source of truth — just poll API)

Recommended: Start with no DB. Poll Derive API for subaccount state.
Each subaccount IS a position. The API is the database.
```

---

## 9. Smart Contract Assessment

### Do We Need Custom Smart Contracts?

**No.** Here's why:

| Need | How It's Handled |
|------|-----------------|
| Collateral locking | PM2 subaccount holds WBTC/WETH natively |
| Option settlement | Derive protocol settles automatically at 8:00 AM UTC |
| 1:1 enforcement | Application layer: don't allow selling more calls than deposited BTC |
| Post-settlement auto-sell | Backend service executes spot market order via session key |
| Share tokens / vault | Not needed — per-user positions, not pooled |

### When Would We Need Smart Contracts?

Only if we want:
- **Trustless 1:1 enforcement** — A contract that prevents selling more calls than BTC deposited (currently enforced by our app, not on-chain)
- **Automated settlement execution** — A keeper contract that auto-sells BTC at expiry (currently handled by backend service)
- **Vault/pool model** — If we pivot to pooled deposits (CCTSA-style)

For MVP, application-layer enforcement + backend service is sufficient and dramatically simpler.

### Bridge Smart Contracts

The bridge is already handled by Socket Finance's deployed contracts. No custom bridge contracts needed. Addresses are in `bridge-config.ts`.

---

## 10. File-by-File Change Map

### Modified Files

| File | Changes | Priority |
|------|---------|----------|
| `src/lib/derive/constants.ts` | Add WETH/WBTC addresses, PM2 manager, asset config helper | P1 |
| `src/lib/derive/client.ts` | Add PM2 margin type, RFQ methods, settlement methods | P1 |
| `src/lib/derive/types.ts` | Add RFQ types, settlement types, CoveredCallPosition | P1 |
| `src/hooks/mutations/useDeposit.ts` | Parameterize asset_name, margin_type (remove 7 hardcoded refs) | P1 |
| `src/lib/derive/signing.ts` | Add RFQ signing (encodeRfqData) | P2 |
| `src/lib/derive/ws.ts` | Add RFQ channel subscription support | P2 |
| `src/lib/derive/scw-actions.ts` | Add lazy approval for WETH/WBTC | P2 |
| `src/stores/account.ts` | Track multiple subaccounts with margin types | P3 |
| `src/components/portfolio/FundsModal.tsx` | Add asset selector for deposit/withdraw | P3 |

### New Files

| File | Purpose | Priority |
|------|---------|----------|
| `src/stores/covered-call.ts` | Zustand store for covered call positions | P1 |
| `src/hooks/covered-call/useCoveredCallSubaccount.ts` | PM2 subaccount lifecycle | P1 |
| `src/hooks/covered-call/useRFQ.ts` | RFQ request/quote/accept hooks | P2 |
| `src/hooks/covered-call/useAvailableStrikes.ts` | Fetch available BTC options for strike picker | P2 |
| `src/hooks/covered-call/usePremiumWithdraw.ts` | Withdraw USDC premium to EOA after RFQ fill | P2 |
| `src/hooks/covered-call/usePositionMonitor.ts` | Position + collateral polling | P2 |
| `src/hooks/covered-call/useSettlementDetector.ts` | Settlement detection near expiry | P3 |
| `src/components/covered-call/DepositFlow.tsx` | Deposit BTC flow | P2 |
| `src/components/covered-call/SellCallFlow.tsx` | Strike picker + RFQ quote + confirm | P2 |
| `src/components/covered-call/PositionCard.tsx` | Active position display | P2 |
| `src/components/covered-call/SettlementCard.tsx` | Post-expiry outcome + actions | P3 |
| `src/components/covered-call/StrikeSelector.tsx` | Strike cards with premium/APR | P2 |
| `src/app/api/onboarding/backend-key/route.ts` | Generate + store backend session key during onboarding | P1 |
| `src/app/api/settlement/route.ts` | Settlement check + auto-sell cron endpoint | P3 |

---

## 11. Open Questions

### Must Resolve Before Building

1. **PM2 risk manager contract address** — Not in codebase. Need to look up from Derive protocol constants or API.
2. **WETH/WBTC cash asset addresses on Derive L2** — Bridge config has L1 addresses, but we need the L2 cash asset addresses for deposit encoding.
3. **RFQ API exact signatures** — Need to verify exact request/response format from Derive docs or by testing against testnet.
4. **MM availability** — Do existing Derive MMs quote RFQs for covered call strikes we'd offer? Need to test.
5. **PM2 availability** — Is PM2 available on testnet for development?

### Product Decisions (resolved)

- ~~Early exit~~ → **Hold to expiry only** for MVP
- ~~Assets~~ → **BTC only** for MVP (ETH later)
- ~~Premium handling~~ → **Withdraw to EOA** on Derive L2 immediately after RFQ fill
- ~~Session key for backend~~ → **Separate backend session key** per user, stored in Vercel KV
- ~~Settlement choice~~ → **Auto-sell** BTC to cover USDC deficit, return remaining BTC. No user choice.

### Product Decisions (open)

6. **Slippage tolerance on auto-sell** — What price tolerance for the spot market order? IOC with limit price at 99% of mark?
7. **Minimum position size** — What's the minimum BTC amount for a covered call? (Protocol min OI fee is $800 USDC)
8. **Notification system** — How do we notify users of settlement? Push notifications? Email? Just in-app?
9. **Premium withdrawal timing** — Withdraw premium immediately after RFQ fill, or wait a few seconds to confirm the trade settled?

### Future Considerations

10. **ETH covered calls** — Same architecture, parameterized for ETH. Easy to add after BTC is stable.
11. **"Keep my BTC" option** — Let user deposit USDC to cover deficit instead of auto-sell.
12. **Early exit (buy to close)** — Allow closing position before expiry via RFQ.
13. **Rolling** — Close current + open next expiry in one flow.
14. **Cash-secured puts** — Same architecture, different direction.
15. **Auto-roll** — Automatically sell next week's call when current one expires OTM.
16. **Yield dashboard** — Aggregate APR across all covered call positions.
17. **Multi-leg strategies** — Spreads, straddles via multi-leg RFQ.

---

## Implementation Order

```
Phase 1 (Week 1-2): Foundation + Onboarding
  ├── Add WBTC constants + addresses (look up PM2, WBTC cash asset on Derive L2)
  ├── Parameterize useDeposit (remove hardcoded USDC/SM)
  ├── Add backend session key generation API route
  ├── Update onboarding bundle: register backend key + WBTC approvals
  ├── Store backend session key in Vercel KV
  ├── Create covered-call store
  └── Test PM2 subaccount creation on testnet

Phase 2 (Week 2-3): RFQ + Premium
  ├── Add RFQ methods to client
  ├── Add RFQ types
  ├── Build RFQ hooks (send, poll, accept)
  ├── Add RFQ signing
  ├── Build premium withdrawal to EOA (after RFQ fill)
  └── Test RFQ flow on testnet

Phase 3 (Week 3-4): Frontend
  ├── Build deposit BTC flow
  ├── Build strike selector with RFQ quotes
  ├── Build position cards (active positions)
  └── Build settlement result display

Phase 4 (Week 4-5): Settlement Service
  ├── Build settlement detection (cron at 7:55 UTC)
  ├── Build auto-sell: spot market order to cover USDC deficit
  ├── Build auto-withdraw: remaining BTC to user's SCW → EOA
  ├── Notification system (in-app for MVP)
  └── End-to-end testing (ITM + OTM scenarios)
```
