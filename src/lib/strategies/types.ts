import type { Instrument, Ticker, OptionType, OrderDirection } from "@/lib/derive/types";

export type StrategyId = "bullish_bet" | "downside_protection" | "earn_sideways";

export interface StrategyDefinition {
  id: StrategyId;
  name: string;
  shortDescription: string;
  description: string;
  optionType: OptionType;
  direction: OrderDirection;
  riskLevel: "low" | "medium" | "high";
  maxLoss: string;
  maxGain: string;
  strikeSelectionDescription: string;
}

export interface StrategyPreview {
  strategy: StrategyDefinition;
  instrument: Instrument;
  ticker: Ticker | null;
  estimatedCost: number;
  breakeven: number;
  maxLoss: number;
  maxGain: number | null; // null = unlimited
  spotPrice: number;
  strikePrice: number;
}
