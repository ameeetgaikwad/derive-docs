import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Trade records for covered calls sold through the RFQ flow, persisted to
 * localStorage. The authoritative position state (option/cash/BTCB balances,
 * settlement) is read on-chain from SubAccounts; these records add the
 * off-chain context (premium received at trade time, tx hash).
 */
export interface CoveredCallTrade {
  /** lowercased seller EOA */
  address: string;
  /** BSC deployment the trade was executed against. */
  chainId: 56 | 97;
  marketId?: "BTC" | "XAU" | "SPY" | "NVDA" | "SPCX";
  subaccountId: string;
  /** e.g. BTC-20260619-69000-C */
  instrumentName: string;
  /** whole quote units (USDT) */
  strike: number;
  /** unix seconds */
  expiry: number;
  /** option amount sold, human decimal */
  amount: string;
  /** total premium received, USDT human decimal */
  premium: string;
  txHash: string;
  /** ms epoch */
  createdAt: number;
}

interface CoveredCallState {
  trades: CoveredCallTrade[];
  addTrade: (trade: CoveredCallTrade) => void;
  tradesFor: (address: string | undefined, chainId: 56 | 97) => CoveredCallTrade[];
  reset: () => void;
}

export const useCoveredCallStore = create<CoveredCallState>()(
  persist(
    (set, get) => ({
      trades: [],

      addTrade: (trade) =>
        set((state) => ({
          trades: [...state.trades, { ...trade, address: trade.address.toLowerCase() }],
        })),

      tradesFor: (address, chainId) => {
        if (!address) return [];
        const a = address.toLowerCase();
        return get()
          .trades.filter(
            (t) =>
              t.address === a &&
              // Old records have no chain. Let the on-chain position join in
              // usePositions determine whether their metadata is relevant.
              (t.chainId === undefined || t.chainId === chainId),
          )
          .map((t) => ({ ...t, chainId: t.chainId ?? chainId }));
      },

      reset: () => set({ trades: [] }),
    }),
    { name: "hedge.covered-calls" }
  )
);
