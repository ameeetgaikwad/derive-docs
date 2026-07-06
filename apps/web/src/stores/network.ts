import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Active protocol network (BSC testnet 97 or BSC mainnet 56), persisted to
 * localStorage. This is the app's own notion of "which deployment am I
 * trading on" — separate from the wallet's connected chain (the wallet is
 * prompted to switch to match). Defaults to testnet.
 *
 * The chosen chainId is also mirrored into a module-level variable
 * (see lib/protocol/deployments.ts `getActiveChainId`) so non-React signing
 * code can read the active network without a hook.
 */
export type AppChainId = 56 | 97;

export const APP_CHAIN_IDS: readonly AppChainId[] = [56, 97] as const;

export const DEFAULT_APP_CHAIN_ID: AppChainId = 97;

function isAppChainId(v: unknown): v is AppChainId {
  return v === 56 || v === 97;
}

interface NetworkState {
  chainId: AppChainId;
  setChainId: (chainId: AppChainId) => void;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      chainId: DEFAULT_APP_CHAIN_ID,
      setChainId: (chainId) => {
        if (!isAppChainId(chainId)) return;
        setActiveChainIdMirror(chainId);
        set({ chainId });
      },
    }),
    {
      name: "hedge.network",
      onRehydrateStorage: () => (state) => {
        if (state && isAppChainId(state.chainId)) {
          setActiveChainIdMirror(state.chainId);
        }
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
let activeChainIdMirror: AppChainId = readPersistedChainId();

function readPersistedChainId(): AppChainId {
  if (typeof window === "undefined") return DEFAULT_APP_CHAIN_ID;
  try {
    const raw = window.localStorage.getItem("hedge.network");
    if (!raw) return DEFAULT_APP_CHAIN_ID;
    const parsed = JSON.parse(raw) as { state?: { chainId?: unknown } };
    const id = parsed?.state?.chainId;
    return isAppChainId(id) ? id : DEFAULT_APP_CHAIN_ID;
  } catch {
    return DEFAULT_APP_CHAIN_ID;
  }
}

function setActiveChainIdMirror(chainId: AppChainId): void {
  activeChainIdMirror = chainId;
}

/** Synchronous read of the active app chainId (for non-React callers). */
export function getActiveChainId(): AppChainId {
  return activeChainIdMirror;
}
