import type { Instrument } from "@/lib/derive/types";
import type { StrategyDefinition } from "./types";

/**
 * Resolve the best instrument for a given strategy and current market conditions.
 *
 * Rules:
 * - bullish_bet: ATM or 5-10% OTM call, nearest expiry 7-30 days out
 * - downside_protection: 5-10% below spot put, nearest expiry 7-30 days out
 * - earn_sideways: 10-15% above spot call, nearest expiry 14-45 days out
 */
export function resolveStrategy(
  strategy: StrategyDefinition,
  instruments: Instrument[],
  spotPrice: number
): Instrument | null {
  const now = Date.now() / 1000;

  // Filter to active instruments of the right option type
  const candidates = instruments.filter((inst) => {
    if (!inst.is_active || !inst.option_details) return false;
    return inst.option_details.option_type === strategy.optionType;
  });

  if (candidates.length === 0) return null;

  // Determine target strike range and expiry range
  let minStrikeRatio: number;
  let maxStrikeRatio: number;
  let minDaysToExpiry: number;
  let maxDaysToExpiry: number;

  switch (strategy.id) {
    case "bullish_bet":
      minStrikeRatio = 1.0; // ATM
      maxStrikeRatio = 1.10; // 10% OTM
      minDaysToExpiry = 7;
      maxDaysToExpiry = 30;
      break;
    case "downside_protection":
      minStrikeRatio = 0.90; // 10% below spot
      maxStrikeRatio = 0.95; // 5% below spot
      minDaysToExpiry = 7;
      maxDaysToExpiry = 30;
      break;
    case "earn_sideways":
      minStrikeRatio = 1.10; // 10% above spot
      maxStrikeRatio = 1.15; // 15% above spot
      minDaysToExpiry = 14;
      maxDaysToExpiry = 45;
      break;
    default:
      return null;
  }

  const minStrike = spotPrice * minStrikeRatio;
  const maxStrike = spotPrice * maxStrikeRatio;
  const minExpiry = now + minDaysToExpiry * 86400;
  const maxExpiry = now + maxDaysToExpiry * 86400;

  // Filter by strike and expiry range
  const filtered = candidates.filter((inst) => {
    const strike = parseFloat(inst.option_details!.strike);
    const expiry = inst.option_details!.expiry;
    return (
      strike >= minStrike &&
      strike <= maxStrike &&
      expiry >= minExpiry &&
      expiry <= maxExpiry
    );
  });

  if (filtered.length === 0) {
    // Fallback: pick the closest instrument by strike, then nearest expiry
    const withinExpiry = candidates.filter(
      (inst) => inst.option_details!.expiry >= minExpiry && inst.option_details!.expiry <= maxExpiry
    );

    if (withinExpiry.length === 0) {
      // Last resort: just pick nearest expiry that's in the future
      const future = candidates
        .filter((inst) => inst.option_details!.expiry > now)
        .sort((a, b) => a.option_details!.expiry - b.option_details!.expiry);
      return future[0] ?? null;
    }

    // Pick closest strike to target midpoint
    const targetStrike = spotPrice * ((minStrikeRatio + maxStrikeRatio) / 2);
    return withinExpiry.reduce((best, inst) => {
      const bestDist = Math.abs(parseFloat(best.option_details!.strike) - targetStrike);
      const currDist = Math.abs(parseFloat(inst.option_details!.strike) - targetStrike);
      return currDist < bestDist ? inst : best;
    });
  }

  // From filtered, pick nearest expiry, then closest to ideal strike
  filtered.sort((a, b) => {
    const expiryDiff = a.option_details!.expiry - b.option_details!.expiry;
    if (expiryDiff !== 0) return expiryDiff;
    const targetStrike = spotPrice * ((minStrikeRatio + maxStrikeRatio) / 2);
    return (
      Math.abs(parseFloat(a.option_details!.strike) - targetStrike) -
      Math.abs(parseFloat(b.option_details!.strike) - targetStrike)
    );
  });

  return filtered[0];
}
