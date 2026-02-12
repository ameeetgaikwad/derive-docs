import { create } from "zustand";
import type { Position, Order, Collateral } from "@/lib/derive/types";

interface PortfolioState {
  positions: Position[];
  openOrders: Order[];
  collaterals: Collateral[];

  setPositions: (positions: Position[]) => void;
  setOpenOrders: (orders: Order[]) => void;
  setCollaterals: (collaterals: Collateral[]) => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  positions: [],
  openOrders: [],
  collaterals: [],

  setPositions: (positions) => set({ positions }),
  setOpenOrders: (openOrders) => set({ openOrders }),
  setCollaterals: (collaterals) => set({ collaterals }),
}));
