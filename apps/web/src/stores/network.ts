import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Protocol deployments known to the frontend. Mainnet remains represented in
 * the deployment helpers for future releases, but only BSC testnet is enabled
 * as a user-selectable app network today.
 *
 * The chosen chainId is also mirrored into a module-level variable
 * (see lib/protocol/deployments.ts `getActiveChainId`) so non-React signing
 * code can read the active network without a hook.
 */
export type AppChainId = 56 | 97;
export type EnabledAppChainId = 97;

export const APP_CHAIN_IDS: readonly AppChainId[] = [56, 97] as const;
export const ENABLED_APP_CHAIN_IDS: readonly EnabledAppChainId[] = [97] as const;

export const DEFAULT_APP_CHAIN_ID: EnabledAppChainId = 97;

export function isEnabledAppChainId(v: unknown): v is EnabledAppChainId {
  return v === 97;
}

export function coerceEnabledAppChainId(v: unknown): EnabledAppChainId {
  return isEnabledAppChainId(v) ? v : DEFAULT_APP_CHAIN_ID;
}

interface NetworkState {
  chainId: EnabledAppChainId;
  setChainId: (chainId: EnabledAppChainId) => void;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      chainId: DEFAULT_APP_CHAIN_ID,
      setChainId: (chainId) => {
        if (!isEnabledAppChainId(chainId)) return;
        setActiveChainIdMirror(chainId);
        set({ chainId });
      },
    }),
    {
      name: "hedge.network",
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<NetworkState>;
        const chainId = coerceEnabledAppChainId(persisted.chainId);
        setActiveChainIdMirror(chainId);
        return { ...currentState, chainId };
      },
    }
  )
);

/**
 * Module-level mirror of the active chainId, readable synchronously from
 * non-React code (EIP-712 signing helpers). Kept in sync by the store above.
 * Initialised optimistically from localStorage so the first signing call in
 * a fresh page load already reflects the persisted choice.
 */
let activeChainIdMirror: EnabledAppChainId = readPersistedChainId();

function readPersistedChainId(): EnabledAppChainId {
  if (typeof window === "undefined") return DEFAULT_APP_CHAIN_ID;
  try {
    const raw = window.localStorage.getItem("hedge.network");
    if (!raw) return DEFAULT_APP_CHAIN_ID;
    const parsed = JSON.parse(raw) as { state?: { chainId?: unknown } };
    const id = parsed?.state?.chainId;
    return coerceEnabledAppChainId(id);
  } catch {
    return DEFAULT_APP_CHAIN_ID;
  }
}

function setActiveChainIdMirror(chainId: EnabledAppChainId): void {
  activeChainIdMirror = chainId;
}

/** Synchronous read of the active app chainId (for non-React callers). */
export function getActiveChainId(): EnabledAppChainId {
  return activeChainIdMirror;
}
