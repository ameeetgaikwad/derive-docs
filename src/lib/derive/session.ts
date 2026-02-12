import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, type Hex } from "viem";
import type { SessionKey } from "./types";

const STORAGE_KEY = "strikely_session_key";
const DERIVE_WALLET_KEY = "strikely_derive_wallet";
const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Generate a new session key pair.
 */
export function generateSessionKey(subaccountId: number): SessionKey {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  return {
    public_key: account.address,
    private_key: privateKey,
    expiry: Math.floor(Date.now() / 1000) + SESSION_DURATION,
    subaccount_id: subaccountId,
  };
}

/**
 * Save session key to localStorage.
 */
export function saveSessionKey(sessionKey: SessionKey) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionKey));
}

/**
 * Load session key from localStorage.
 * Returns null if not found or expired.
 */
export function loadSessionKey(): SessionKey | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as SessionKey;
    const now = Math.floor(Date.now() / 1000);

    if (parsed.expiry < now) {
      clearSessionKey();
      return null;
    }

    return parsed;
  } catch {
    clearSessionKey();
    return null;
  }
}

/**
 * Clear session key from localStorage.
 */
export function clearSessionKey() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Check if a session key is still valid (not expired, with buffer).
 */
export function isSessionKeyValid(sessionKey: SessionKey | null, bufferSeconds = 300): boolean {
  if (!sessionKey) return false;
  const now = Math.floor(Date.now() / 1000);
  return sessionKey.expiry > now + bufferSeconds;
}

/**
 * Save EOA → Derive wallet mapping to localStorage.
 */
export function saveDeriveWallet(eoa: `0x${string}`, deriveWallet: `0x${string}`) {
  if (typeof window === "undefined") return;
  const mapping = loadDeriveWalletMapping();
  mapping[eoa.toLowerCase()] = deriveWallet;
  localStorage.setItem(DERIVE_WALLET_KEY, JSON.stringify(mapping));
}

/**
 * Look up a Derive wallet address for an EOA from localStorage.
 */
export function loadDeriveWallet(eoa: `0x${string}`): `0x${string}` | null {
  const mapping = loadDeriveWalletMapping();
  const wallet = mapping[eoa.toLowerCase()];
  if (!wallet) return null;
  // Ensure checksummed address (old cache may have lowercase)
  try {
    return getAddress(wallet as `0x${string}`);
  } catch {
    return wallet as `0x${string}`;
  }
}

/**
 * Clear all cached Derive wallet mappings from localStorage.
 */
export function clearDeriveWalletCache() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DERIVE_WALLET_KEY);
}

function loadDeriveWalletMapping(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(DERIVE_WALLET_KEY);
    return stored ? (JSON.parse(stored) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
