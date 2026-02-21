# Gas Sponsorship Plan for Session Key Registration

## Problem
Users must have ETH on Derive chain (ID 957) to register a session key on-chain via `SCW.execute()`. This is a UX blocker — users must bridge ETH before they can start trading.

## Current Flow
1. `public/build_register_session_key_tx` → get tx params
2. Switch to Derive chain
3. `walletClient.sendTransaction()` → EOA calls `SCW.execute(matching, 0, registerCalldata)`
4. Poll until Derive backend recognizes session key

## Approaches Evaluated

---

### 1. ⭐ `private/register_scoped_session_key` (RECOMMENDED — Zero Gas)

**What:** The Derive API has `private/register_scoped_session_key` which registers a session key using only auth headers — NO on-chain transaction required. It's already implemented in our `client.ts`.

**How it works:**
- User signs a timestamp message (EOA signature) → auth headers
- Call `private/register_scoped_session_key` with `{ wallet, public_session_key, expiry_sec, scope: "admin" }`
- Derive backend registers the session key server-side
- No gas needed at all

**The catch:** The current code comments note *"'admin' scope may require signed_raw_tx on some API versions"*. Need to test whether "admin" scope works without a tx, or if we need to use "account" scope (which may limit trading capabilities).

**Feasibility:** HIGH — endpoint exists, already in client  
**Complexity:** LOW — ~20 lines of code change in `useDeriveAccount.ts`  
**Cost:** Zero gas  
**UX:** 1 signature popup (for auth), no chain switch needed  

**Action items:**
1. Test `private/register_scoped_session_key` with scope "admin" — does it work without `signed_raw_tx`?
2. If "admin" fails, test with scope "account" — is it sufficient for trading?
3. If it works, refactor `authenticate()` to try scoped registration first, fall back to on-chain

**Implementation sketch:**
```typescript
// In authenticate(), replace on-chain registration with:
const sessionAccount = privateKeyToAccount(sessionKey.private_key);

// Temporarily auth as EOA for the private endpoint
client.setAuth(deriveWallet, async (msg) => {
  return walletClient.signMessage({ message: msg });
});

await client.registerScopedSessionKey({
  wallet: deriveWallet,
  public_session_key: sessionKey.public_key,
  expiry_sec: sessionKey.expiry,
  label: "trading-session",
  scope: "admin",
});

// Switch to session key auth
client.setAuth(deriveWallet, async (msg) => {
  return sessionAccount.signMessage({ message: msg });
});
```

---

### 2. `public/register_session_key` (Still Requires Signed Tx)

**What:** Takes `{ wallet, public_session_key, label, expiry_sec, signed_raw_tx }`. The `signed_raw_tx` parameter means the user still needs to sign a transaction, and Derive's backend broadcasts it. 

**Key insight:** Derive may broadcast the tx itself (acting as a relay), but the user still signs a raw tx that requires gas from the sender. This doesn't help with sponsorship unless Derive's backend wraps it in a sponsored tx.

**Feasibility:** UNCERTAIN — need to test if Derive pays the gas  
**Complexity:** LOW — minor change  
**Cost:** Unknown who pays  
**UX:** 1 signature popup  

**Action item:** Test this endpoint — sign a raw tx and submit via API. Check if the tx goes through even with zero ETH balance.

---

### 3. ERC-4337 Paymaster

**What:** Use a Paymaster to sponsor the UserOp gas since SCW is a LightAccount (ERC-4337 compatible).

**Problem:** No major AA infrastructure providers (Pimlico, Alchemy, Stackup, Biconomy) list Derive chain (957) as a supported chain. Derive is a relatively niche OP Stack L2.

**Alternative:** Deploy our own Paymaster contract on Derive chain + run a bundler. This is significant infrastructure.

**Feasibility:** LOW (no existing infra on Derive chain)  
**Complexity:** HIGH (deploy paymaster, run bundler)  
**Cost:** We pay gas via Paymaster  
**UX:** Good (1 signature, no chain switch)  

**Verdict:** Overkill for this use case. Only worth exploring if approach #1 fails AND we need to sponsor many different tx types.

---

### 4. EIP-7702 (EOA Code Delegation)

**What:** EIP-7702 lets an EOA temporarily delegate to a contract, enabling batching and sponsorship.

**Problem:** EIP-7702 was introduced in Ethereum's Pectra upgrade (2025). OP Stack L2s may not support it yet — it requires the L2 to upgrade their execution client. Derive chain status is unknown.

**Feasibility:** UNKNOWN (likely not supported yet on Derive)  
**Complexity:** MEDIUM  
**Cost:** Still needs someone to pay gas  
**UX:** Good  

**Verdict:** Not viable today. Monitor for future OP Stack upgrades.

---

### 5. Our Own Relayer Backend

**What:** Run a backend with a hot wallet funded with ETH on Derive chain. User signs message → backend calls `SCW.execute()` on their behalf.

**Problem:** The EOA must be the SCW owner to call `SCW.execute()`. Our relayer's hot wallet is NOT the owner — only the user's EOA is. So the relayer can't call execute() directly.

**Workaround:** Use the SCW's `execute()` through a UserOp with our bundler, or have the user sign an EIP-712 message that we verify. But this essentially becomes approach #3.

**Feasibility:** LOW (ownership constraint)  
**Complexity:** HIGH (backend + key management)  
**Cost:** We pay gas  
**UX:** 1 signature  

**Verdict:** Not worth it when approach #1 exists.

---

### 6. Gelato Relay / OZ Defender

**What:** Use meta-transaction relay services.

**Problem:** Same ownership issue as #5 — the relay can't call `SCW.execute()` because it's not the owner. Also, Gelato/OZ Defender may not support Derive chain.

**Feasibility:** LOW  
**Complexity:** MEDIUM  
**Cost:** We pay relay fees  

**Verdict:** Skip.

---

### 7. Derive's Built-in Solutions

Derive doesn't publicly document any gas faucet or paymaster for their chain. However, the existence of `private/register_scoped_session_key` (no on-chain tx) suggests Derive designed their system to work without gas for session key registration.

---

## Recommendation

### Try in this order:

1. **`private/register_scoped_session_key` with scope "admin"** — test immediately. If this works, we're done. Zero gas, minimal code change, best UX.

2. **`private/register_scoped_session_key` with scope "account"** — if "admin" requires signed_raw_tx, try "account" scope. Verify it's sufficient for placing trades.

3. **`public/register_session_key` with signed tx** — test if Derive broadcasts and pays gas. Sign a raw tx from an EOA with zero balance and submit.

4. **On-chain fallback** — keep current flow as fallback for edge cases.

### Next Step
Write a quick test script that calls `private/register_scoped_session_key` with a fresh session key to verify it works without any on-chain tx or gas.
