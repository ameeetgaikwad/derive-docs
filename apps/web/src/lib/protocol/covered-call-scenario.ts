export interface CoveredCallScenarioInput {
  spotPrice: number;
  strikePrice: number;
  expiryPrice: number;
  amount: number;
  totalPremium: number;
}

export interface CoveredCallScenarioResult {
  settlementPayment: number;
  btcValue: number;
  coveredPositionValue: number;
  isAboveStrike: boolean;
}

/** Economic value of BTC collateral plus premium after cash settlement. */
export function calculateCoveredCallScenario({
  strikePrice,
  expiryPrice,
  amount,
  totalPremium,
}: CoveredCallScenarioInput): CoveredCallScenarioResult {
  const safeAmount = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const safeExpiryPrice = Math.max(
    0,
    Number.isFinite(expiryPrice) ? expiryPrice : 0,
  );
  const safeStrikePrice = Math.max(
    0,
    Number.isFinite(strikePrice) ? strikePrice : 0,
  );
  const safePremium = Math.max(
    0,
    Number.isFinite(totalPremium) ? totalPremium : 0,
  );
  const settlementPayment =
    Math.max(safeExpiryPrice - safeStrikePrice, 0) * safeAmount;
  const btcValue = safeExpiryPrice * safeAmount;

  return {
    settlementPayment,
    btcValue,
    coveredPositionValue: btcValue - settlementPayment + safePremium,
    isAboveStrike: safeExpiryPrice > safeStrikePrice,
  };
}

export function scenarioRange(spotPrice: number): {
  min: number;
  max: number;
  step: number;
} {
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
    return { min: 0, max: 100_000, step: 100 };
  }
  return {
    min: Math.floor((spotPrice * 0.5) / 100) * 100,
    max: Math.ceil((spotPrice * 1.5) / 100) * 100,
    step: 100,
  };
}
