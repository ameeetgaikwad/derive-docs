import { create } from "zustand";
import type { SessionKey, Subaccount } from "@/lib/derive/types";

export type OnboardingStatus =
  | "disconnected"
  | "connecting"
  | "checking_account"
  | "creating_account"
  | "generating_session_key"
  | "registering_session_key"
  | "no_account"
  | "ready"
  | "error";

interface AccountState {
  status: OnboardingStatus;
  error: string | null;
  subaccounts: Subaccount[];
  activeSubaccountId: number | null;
  sessionKey: SessionKey | null;
  deriveWallet: `0x${string}` | null;

  setStatus: (status: OnboardingStatus) => void;
  setError: (error: string | null) => void;
  setSubaccounts: (subaccounts: Subaccount[]) => void;
  setActiveSubaccountId: (id: number | null) => void;
  setSessionKey: (key: SessionKey | null) => void;
  setDeriveWallet: (wallet: `0x${string}` | null) => void;
  reset: () => void;
}

export const useAccountStore = create<AccountState>((set) => ({
  status: "disconnected",
  error: null,
  subaccounts: [],
  activeSubaccountId: null,
  sessionKey: null,
  deriveWallet: null,

  setStatus: (status) => set({ status, error: status === "error" ? undefined : null }),
  setError: (error) => set(error ? { error, status: "error" } : { error: null }),
  setSubaccounts: (subaccounts) => set({ subaccounts }),
  setActiveSubaccountId: (activeSubaccountId) => set({ activeSubaccountId }),
  setSessionKey: (sessionKey) => set({ sessionKey }),
  setDeriveWallet: (deriveWallet) => set({ deriveWallet }),
  reset: () =>
    set({
      status: "disconnected",
      error: null,
      subaccounts: [],
      activeSubaccountId: null,
      sessionKey: null,
      deriveWallet: null,
    }),
}));
