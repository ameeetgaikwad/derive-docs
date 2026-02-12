import { create } from "zustand";
import type { Instrument, Ticker, Orderbook } from "@/lib/derive/types";

interface MarketsState {
  instruments: Instrument[];
  tickers: Map<string, Ticker>;
  selectedExpiry: number | null;
  selectedInstrument: string | null;
  orderbook: Orderbook | null;
  spotPrice: number | null;

  setInstruments: (instruments: Instrument[]) => void;
  updateTicker: (name: string, ticker: Ticker) => void;
  setTickers: (tickers: Map<string, Ticker>) => void;
  setSelectedExpiry: (expiry: number | null) => void;
  setSelectedInstrument: (instrument: string | null) => void;
  setOrderbook: (orderbook: Orderbook | null) => void;
  setSpotPrice: (price: number | null) => void;
}

export const useMarketsStore = create<MarketsState>((set) => ({
  instruments: [],
  tickers: new Map(),
  selectedExpiry: null,
  selectedInstrument: null,
  orderbook: null,
  spotPrice: null,

  setInstruments: (instruments) => set({ instruments }),
  updateTicker: (name, ticker) =>
    set((state) => {
      const newTickers = new Map(state.tickers);
      newTickers.set(name, ticker);
      return { tickers: newTickers };
    }),
  setTickers: (tickers) => set({ tickers }),
  setSelectedExpiry: (selectedExpiry) => set({ selectedExpiry }),
  setSelectedInstrument: (selectedInstrument) => set({ selectedInstrument }),
  setOrderbook: (orderbook) => set({ orderbook }),
  setSpotPrice: (spotPrice) => set({ spotPrice }),
}));
