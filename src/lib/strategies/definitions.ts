import type { StrategyDefinition } from "./types";

export const STRATEGIES: StrategyDefinition[] = [
  {
    id: "bullish_bet",
    name: "Bullish Bet",
    shortDescription: "Bet on ETH going up",
    description:
      "Buy a call option near the current price. You profit if ETH rises above your strike price plus the premium paid. Max loss is limited to the premium.",
    optionType: "C",
    direction: "buy",
    riskLevel: "medium",
    maxLoss: "Premium paid",
    maxGain: "Unlimited",
    strikeSelectionDescription: "ATM or 5-10% OTM call",
  },
  {
    id: "downside_protection",
    name: "Downside Protection",
    shortDescription: "Protect against ETH dropping",
    description:
      "Buy a put option below the current price. Acts like insurance — you profit if ETH drops below your strike. Max loss is limited to the premium paid.",
    optionType: "P",
    direction: "buy",
    riskLevel: "low",
    maxLoss: "Premium paid",
    maxGain: "Strike price - premium",
    strikeSelectionDescription: "5-10% below spot put",
  },
  {
    id: "earn_sideways",
    name: "Earn from Sideways",
    shortDescription: "Earn premium if ETH stays flat",
    description:
      "Sell a covered call above the current price. You earn the premium upfront. Risk: if ETH rises past your strike, your upside is capped.",
    optionType: "C",
    direction: "sell",
    riskLevel: "high",
    maxLoss: "Unlimited (above strike)",
    maxGain: "Premium received",
    strikeSelectionDescription: "10-15% above spot covered call",
  },
];

export function getStrategyById(id: string): StrategyDefinition | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
