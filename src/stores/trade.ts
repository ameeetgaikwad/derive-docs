import { create } from "zustand";
import type { OrderDirection, OrderType, TimeInForce } from "@/lib/derive/types";

export type TradeStatus = "idle" | "signing" | "submitting" | "success" | "error";

interface TradeState {
  direction: OrderDirection;
  orderType: OrderType;
  amount: string;
  limitPrice: string;
  timeInForce: TimeInForce;
  isReduceOnly: boolean;
  status: TradeStatus;
  error: string | null;

  setDirection: (direction: OrderDirection) => void;
  setOrderType: (orderType: OrderType) => void;
  setAmount: (amount: string) => void;
  setLimitPrice: (limitPrice: string) => void;
  setTimeInForce: (tif: TimeInForce) => void;
  setIsReduceOnly: (isReduceOnly: boolean) => void;
  setStatus: (status: TradeStatus) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  direction: "buy",
  orderType: "limit",
  amount: "",
  limitPrice: "",
  timeInForce: "gtc",
  isReduceOnly: false,
  status: "idle",
  error: null,

  setDirection: (direction) => set({ direction }),
  setOrderType: (orderType) => set({ orderType }),
  setAmount: (amount) => set({ amount }),
  setLimitPrice: (limitPrice) => set({ limitPrice }),
  setTimeInForce: (timeInForce) => set({ timeInForce }),
  setIsReduceOnly: (isReduceOnly) => set({ isReduceOnly }),
  setStatus: (status) => set({ status, error: null }),
  setError: (error) => set({ error, status: "error" }),
  reset: () =>
    set({
      direction: "buy",
      orderType: "limit",
      amount: "",
      limitPrice: "",
      timeInForce: "gtc",
      isReduceOnly: false,
      status: "idle",
      error: null,
    }),
}));
