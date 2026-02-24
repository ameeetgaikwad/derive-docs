import { create } from "zustand";
import type { CoveredCallPosition, CoveredCallStatus } from "@/lib/derive/types";

export type { CoveredCallStatus };

interface CoveredCallState {
  positions: CoveredCallPosition[];
  addPosition: (position: CoveredCallPosition) => void;
  updatePosition: (subaccountId: number, update: Partial<CoveredCallPosition>) => void;
  removePosition: (subaccountId: number) => void;
  getPosition: (subaccountId: number) => CoveredCallPosition | undefined;
  getActivePositions: () => CoveredCallPosition[];
  reset: () => void;
}

export const useCoveredCallStore = create<CoveredCallState>((set, get) => ({
  positions: [],

  addPosition: (position) =>
    set((state) => ({ positions: [...state.positions, position] })),

  updatePosition: (subaccountId, update) =>
    set((state) => ({
      positions: state.positions.map((p) =>
        p.subaccountId === subaccountId ? { ...p, ...update } : p
      ),
    })),

  removePosition: (subaccountId) =>
    set((state) => ({
      positions: state.positions.filter((p) => p.subaccountId !== subaccountId),
    })),

  getPosition: (subaccountId) =>
    get().positions.find((p) => p.subaccountId === subaccountId),

  getActivePositions: () =>
    get().positions.filter((p) => p.status !== "closed"),

  reset: () => set({ positions: [] }),
}));
