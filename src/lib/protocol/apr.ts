/**
 * APR calculation utilities for options selling strategies.
 * (Moved unchanged from src/lib/derive/apr.ts.)
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
  totalPremium: number; // in asset units for covered calls, USD for puts
  totalPremiumUsd?: number; // always in USD
  ifBelow: { label: string; value: number };
  ifAbove: { label: string; value: number };
}

export function calculateOutcome(params: {
  type: StrategyType;
  strikePrice: number;
  spotPrice: number;
  amount: number;
  premium: number; // USD premium per contract
}): OutcomeResult {
  const { type, strikePrice, spotPrice, amount, premium } = params;

  if (type === "cash_secured_put") {
    // amount is in USD (e.g. 1000 USDT)
    const contracts = amount / strikePrice;
    const totalPremiumUsd = premium * contracts;
    return {
      contracts,
      totalPremium: totalPremiumUsd,
      ifBelow: { label: "Receive asset", value: contracts },
      ifAbove: { label: "Get collateral back", value: amount },
    };
  } else {
    // Covered call: amount is in asset units (e.g. 0.01 BTC)
    const contracts = amount;
    const totalPremiumUsd = premium * contracts;
    const totalPremiumAsset = spotPrice > 0 ? totalPremiumUsd / spotPrice : 0;
    return {
      contracts,
      totalPremium: totalPremiumAsset, // in asset units (BTC)
      totalPremiumUsd,
      ifAbove: { label: "Asset sold at strike", value: amount * strikePrice },
      ifBelow: { label: "Keep asset + premium", value: amount },
    };
  }
}
