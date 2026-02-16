/**
 * APR calculation utilities for options selling strategies.
 */

export function calculateAPR(
  premium: number,
  notional: number,
  daysToExpiry: number
): number {
  if (notional <= 0 || daysToExpiry <= 0 || premium <= 0) return 0;
  return (premium / notional) * (365 / daysToExpiry) * 100;
}

export function daysToExpiry(expiryEpochSeconds: number): number {
  const now = Date.now() / 1000;
  const diff = expiryEpochSeconds - now;
  if (diff <= 0) return 0;
  return diff / 86400;
}

export type StrategyType = "covered_call" | "cash_secured_put";

export interface OutcomeResult {
  contracts: number;
  totalPremium: number;
  ifBelow: { label: string; value: number };
  ifAbove: { label: string; value: number };
}

export function calculateOutcome(params: {
  type: StrategyType;
  strikePrice: number;
  spotPrice: number;
  amount: number;
  premium: number;
}): OutcomeResult {
  const { type, strikePrice, amount, premium } = params;

  if (type === "cash_secured_put") {
    const contracts = amount / strikePrice;
    const totalPremium = premium * contracts;
    return {
      contracts,
      totalPremium,
      ifBelow: { label: "Receive asset", value: contracts },
      ifAbove: { label: "Get collateral back", value: amount },
    };
  } else {
    const contracts = amount;
    const totalPremium = premium * contracts;
    return {
      contracts,
      totalPremium,
      ifAbove: { label: "Asset sold at strike", value: amount * strikePrice },
      ifBelow: { label: "Keep asset + premium", value: amount },
    };
  }
}
