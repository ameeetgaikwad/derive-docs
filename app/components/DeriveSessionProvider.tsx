"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useAccount, useWalletClient } from "wagmi";
import { signCreateSubaccount } from "@/lib/derive/signOrder";

type AccountType = "manual" | "session_key" | null;

interface DeriveAuth {
  wallet: string; // X-LyraWallet value (EOA for manual, Derive wallet for session_key)
  signer: string; // EOA that signed
  timestamp: string;
  signature: string;
}

interface DeriveSession {
  isAuthenticated: boolean;
  auth: DeriveAuth | null;
  deriveWallet: string | null;
  subaccountId: number | null;
  subaccountIds: number[];
  authError: string | null;
  isAuthenticating: boolean;
  accountType: AccountType;
  needsDeriveWallet: boolean;
  authenticate: () => Promise<boolean>;
  logout: () => void;
  setSubaccountId: (id: number) => void;
  setDeriveWallet: (wallet: string) => void;
  getAuthHeaders: () => Record<string, string>;
}

const DeriveSessionContext = createContext<DeriveSession>({
  isAuthenticated: false,
  auth: null,
  deriveWallet: null,
  subaccountId: null,
  subaccountIds: [],
  authError: null,
  isAuthenticating: false,
  accountType: null,
  needsDeriveWallet: false,
  authenticate: async () => false,
  logout: () => {},
  setSubaccountId: () => {},
  setDeriveWallet: () => {},
  getAuthHeaders: () => ({}),
});

export function useDeriveSession() {
  return useContext(DeriveSessionContext);
}

/** Try to fetch subaccounts using the given wallet as X-LyraWallet */
async function tryGetSubaccounts(
  wallet: string,
  timestamp: string,
  signature: string
): Promise<{ ok: boolean; ids: number[] }> {
  try {
    const res = await fetch("/api/derive/subaccounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lyrawallet": wallet,
        "x-lyratimestamp": timestamp,
        "x-lyrasignature": signature,
      },
    });
    const data = await res.json();
    if (data.error) return { ok: false, ids: [] };
    const ids: number[] = data.result?.subaccount_ids ?? data.result ?? [];
    if (Array.isArray(ids) && ids.length > 0) {
      return { ok: true, ids };
    }
    return { ok: false, ids: [] };
  } catch {
    return { ok: false, ids: [] };
  }
}

export default function DeriveSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [auth, setAuth] = useState<DeriveAuth | null>(null);
  const [deriveWallet, setDeriveWalletState] = useState<string | null>(null);
  const [subaccountId, setSubaccountId] = useState<number | null>(null);
  const [subaccountIds, setSubaccountIds] = useState<number[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>(null);
  const [needsDeriveWallet, setNeedsDeriveWallet] = useState(false);

  // Restore saved state from localStorage
  useEffect(() => {
    if (address) {
      const stored = localStorage.getItem(`derive_wallet_${address}`);
      if (stored) setDeriveWalletState(stored);

      const storedSub = localStorage.getItem(`derive_subaccount_${address}`);
      if (storedSub) {
        const id = parseInt(storedSub, 10);
        if (!isNaN(id)) setSubaccountId(id);
      }
    }
  }, [address]);

  // Reset when wallet disconnects or changes
  useEffect(() => {
    if (!isConnected || !address) {
      setAuth(null);
      setSubaccountId(null);
      setSubaccountIds([]);
      setAuthError(null);
      setNeedsDeriveWallet(false);
      setAccountType(null);
    } else if (auth && auth.signer !== address) {
      setAuth(null);
      setSubaccountId(null);
      setSubaccountIds([]);
      setAuthError(null);
      setAccountType(null);
    }
  }, [isConnected, address, auth]);

  const setDeriveWallet = useCallback(
    (wallet: string) => {
      if (!wallet) {
        setDeriveWalletState(null);
        if (address) localStorage.removeItem(`derive_wallet_${address}`);
        return;
      }
      setDeriveWalletState(wallet);
      setNeedsDeriveWallet(false);
      if (address) {
        localStorage.setItem(`derive_wallet_${address}`, wallet);
      }
    },
    [address]
  );

  const handleSetSubaccountId = useCallback(
    (id: number) => {
      setSubaccountId(id);
      if (address) {
        localStorage.setItem(`derive_subaccount_${address}`, id.toString());
      }
    },
    [address]
  );

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!auth) return {};
    return {
      "x-lyrawallet": auth.wallet,
      "x-lyratimestamp": auth.timestamp,
      "x-lyrasignature": auth.signature,
    };
  }, [auth]);

  /** Pick a subaccount ID, preferring any stored value */
  const pickSubaccount = useCallback(
    (ids: number[]) => {
      const stored = address ? localStorage.getItem(`derive_subaccount_${address}`) : null;
      const storedId = stored ? parseInt(stored, 10) : NaN;
      const picked = !isNaN(storedId) && ids.includes(storedId) ? storedId : ids[0];
      setSubaccountIds(ids);
      setSubaccountId(picked);
      if (address) localStorage.setItem(`derive_subaccount_${address}`, picked.toString());
    },
    [address]
  );

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!isConnected || !address || !walletClient) {
      setAuthError("Wallet not connected");
      return false;
    }

    setIsAuthenticating(true);
    setAuthError(null);
    setNeedsDeriveWallet(false);

    try {
      // Step 1: Sign timestamp with EOA
      const timestamp = Date.now().toString();
      const signature = await walletClient.signMessage({
        message: timestamp,
        account: address,
      });

      // Step 2: Try subaccounts with X-LyraWallet = EOA (manual account)
      console.log("[DeriveSession] Step 2: trying EOA as wallet...");
      const eoaResult = await tryGetSubaccounts(address, timestamp, signature);
      if (eoaResult.ok) {
        console.log("[DeriveSession] Manual account found, subaccounts:", eoaResult.ids);
        setAuth({ wallet: address, signer: address, timestamp, signature });
        setAccountType("manual");
        pickSubaccount(eoaResult.ids);
        return true;
      }

      // Step 3: Try creating a manual account
      console.log("[DeriveSession] Step 3: creating manual account...");
      try {
        const createRes = await fetch("/api/derive/create-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address }),
        });
        const createData = await createRes.json();
        console.log("[DeriveSession] create_account response:", JSON.stringify(createData));

        if (!createData.error) {
          // Account created - now create a subaccount
          console.log("[DeriveSession] Account created, signing create-subaccount...");
          const sigResult = await signCreateSubaccount(walletClient, { owner: address });

          const subRes = await fetch("/api/derive/create-subaccount", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-lyrawallet": address,
              "x-lyratimestamp": timestamp,
              "x-lyrasignature": signature,
            },
            body: JSON.stringify({
              wallet: address,
              signer: sigResult.signer,
              nonce: sigResult.nonce,
              signature: sigResult.signature,
              signature_expiry_sec: sigResult.signature_expiry_sec,
              margin_type: "SM",
              amount: "0",
              asset_name: "USDC",
            }),
          });
          const subData = await subRes.json();
          console.log("[DeriveSession] create-subaccount response:", JSON.stringify(subData));

          // Retry getting subaccounts
          const retryResult = await tryGetSubaccounts(address, timestamp, signature);
          if (retryResult.ok) {
            console.log("[DeriveSession] Manual account + subaccount created:", retryResult.ids);
            setAuth({ wallet: address, signer: address, timestamp, signature });
            setAccountType("manual");
            pickSubaccount(retryResult.ids);
            return true;
          }
        }
      } catch (e) {
        console.error("[DeriveSession] create-account error:", e);
      }

      // Step 4: Check localStorage for saved Derive wallet (session-key account)
      const savedDeriveWallet = deriveWallet || localStorage.getItem(`derive_wallet_${address}`);
      if (savedDeriveWallet) {
        console.log("[DeriveSession] Step 4: trying saved Derive wallet:", savedDeriveWallet);
        const sessionResult = await tryGetSubaccounts(savedDeriveWallet, timestamp, signature);
        if (sessionResult.ok) {
          console.log("[DeriveSession] Session-key account found:", sessionResult.ids);
          setAuth({ wallet: savedDeriveWallet, signer: address, timestamp, signature });
          setAccountType("session_key");
          setDeriveWalletState(savedDeriveWallet);
          pickSubaccount(sessionResult.ids);
          return true;
        }
      }

      // Step 5: All failed - ask for Derive wallet address
      console.log("[DeriveSession] Step 5: all auto-detection failed, requesting Derive wallet");
      setNeedsDeriveWallet(true);
      setAuthError(
        "Could not find account. If you onboarded via app.derive.xyz, enter your Derive wallet address below."
      );
      // Still set auth so user can retry after entering wallet
      setAuth({ wallet: address, signer: address, timestamp, signature });
      return false;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  }, [isConnected, address, walletClient, deriveWallet, pickSubaccount]);

  // When deriveWallet is set after needsDeriveWallet prompt, auto-retry auth
  useEffect(() => {
    if (needsDeriveWallet && deriveWallet && auth && !subaccountId) {
      // User just entered their Derive wallet - try authenticating with it
      (async () => {
        setIsAuthenticating(true);
        setAuthError(null);
        try {
          const result = await tryGetSubaccounts(deriveWallet, auth.timestamp, auth.signature);
          if (result.ok) {
            console.log("[DeriveSession] Session-key account found after manual input:", result.ids);
            setAuth({ ...auth, wallet: deriveWallet });
            setAccountType("session_key");
            setNeedsDeriveWallet(false);
            pickSubaccount(result.ids);
          } else {
            setAuthError("No subaccounts found for that Derive wallet. Please check the address.");
          }
        } catch {
          setAuthError("Failed to verify Derive wallet");
        } finally {
          setIsAuthenticating(false);
        }
      })();
    }
  }, [deriveWallet, needsDeriveWallet, auth, subaccountId, pickSubaccount]);

  const logout = useCallback(() => {
    setAuth(null);
    setSubaccountId(null);
    setSubaccountIds([]);
    setAuthError(null);
    setAccountType(null);
    setNeedsDeriveWallet(false);
  }, []);

  return (
    <DeriveSessionContext.Provider
      value={{
        isAuthenticated: !!auth && !!subaccountId,
        auth,
        deriveWallet,
        subaccountId,
        subaccountIds,
        authError,
        isAuthenticating,
        accountType,
        needsDeriveWallet,
        authenticate,
        logout,
        setSubaccountId: handleSetSubaccountId,
        setDeriveWallet,
        getAuthHeaders,
      }}
    >
      {children}
    </DeriveSessionContext.Provider>
  );
}
