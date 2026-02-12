/**
 * APR calculation utilities for options selling strategies.
 */

/**
 * Calculate annualized APR for selling an option.
 * @param premium - The bid price (premium received per unit)
 * @param notional - The reference price (strike for puts, spot for calls)
 * @param daysToExpiry - Days until expiration
 * @returns APR as a percentage (e.g. 35.05)
 */
export function calculateAPR(
  premium: number,
  notional: number,
  daysToExpiry: number
): number {
  if (notional <= 0 || daysToExpiry <= 0 || premium <= 0) return 0;
  return (premium / notional) * (365 / daysToExpiry) * 100;
}

/**
 * Calculate days to expiry from an expiry timestamp (epoch seconds).
 */
export function daysToExpiry(expiryEpochSeconds: number): number {
  const now = Date.now() / 1000;
  const diff = expiryEpochSeconds - now;
  if (diff <= 0) return 0;
  return diff / 86400;
}

/**
 * Outcome calculations for selling options.
 */
export function calculateOutcome(params: {
  type: "cash_secured_put" | "covered_call";
  strikePrice: number;
  spotPrice: number;
  amount: number; // collateral amount (USDT for puts, ASSET for calls)
  premium: number; // premium per unit
}) {
  const { type, strikePrice, amount, premium } = params;

  if (type === "cash_secured_put") {
    // Selling puts: deposit USDT collateral
    // If price BELOW strike: receive (amount / strike) in ASSET
    // If price ABOVE strike: get full USDT back
    const contracts = amount / strikePrice;
    const totalPremium = premium * contracts;
    return {
      contracts,
      totalPremium,
      ifBelow: {
        label: "Receive asset",
        value: contracts,
      },
      ifAbove: {
        label: "Get collateral back",
        value: amount,
      },
    };
  } else {
    // Selling calls: deposit ASSET as collateral
    // If price ABOVE strike: asset gets sold at strike price
    // If price BELOW strike: keep asset + premium
    const contracts = amount;
    const totalPremium = premium * contracts;
    return {
      contracts,
      totalPremium,
      ifAbove: {
        label: "Asset sold at strike",
        value: amount * strikePrice,
      },
      ifBelow: {
        label: "Keep asset + premium",
        value: amount,
      },
    };
  }
}
