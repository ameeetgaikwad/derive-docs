import type { BookLevel, HedgeSide } from "../domain/types.js";

export interface BookExecution {
  readonly side: HedgeSide;
  readonly requestedQuantityUnderlying: number;
  readonly filledQuantityUnderlying: number;
  readonly unfilledQuantityUnderlying: number;
  readonly executable: boolean;
  readonly vwapUsdPerUnderlying: number | null;
  readonly worstPriceUsdPerUnderlying: number | null;
  readonly adverseSlippageBps: number | null;
  readonly tradedNotionalUsd: number;
}

function validLevel(level: BookLevel): boolean {
  return (
    Number.isFinite(level.priceUsdPerUnderlying) &&
    level.priceUsdPerUnderlying > 0 &&
    Number.isFinite(level.quantityUnderlying) &&
    level.quantityUnderlying > 0
  );
}

export function simulateBoundedIoc(
  side: HedgeSide,
  quantityUnderlying: number,
  referencePriceUsdPerUnderlying: number,
  maxAdverseSlippageBps: number,
  bids: readonly BookLevel[],
  asks: readonly BookLevel[],
): BookExecution {
  if (!Number.isFinite(quantityUnderlying) || quantityUnderlying <= 0) {
    throw new RangeError("quantityUnderlying must be finite and greater than zero");
  }
  if (
    !Number.isFinite(referencePriceUsdPerUnderlying) ||
    referencePriceUsdPerUnderlying <= 0
  ) {
    throw new RangeError(
      "referencePriceUsdPerUnderlying must be finite and greater than zero",
    );
  }
  if (
    !Number.isFinite(maxAdverseSlippageBps) ||
    maxAdverseSlippageBps < 0
  ) {
    throw new RangeError("maxAdverseSlippageBps must be finite and non-negative");
  }

  const levels = (side === "BUY" ? asks : bids)
    .filter(validLevel)
    .slice()
    .sort((left, right) =>
      side === "BUY"
        ? left.priceUsdPerUnderlying - right.priceUsdPerUnderlying
        : right.priceUsdPerUnderlying - left.priceUsdPerUnderlying,
    );
  const adverseBoundary =
    side === "BUY"
      ? referencePriceUsdPerUnderlying * (1 + maxAdverseSlippageBps / 10_000)
      : referencePriceUsdPerUnderlying * (1 - maxAdverseSlippageBps / 10_000);

  let remaining = quantityUnderlying;
  let filled = 0;
  let notional = 0;
  let worstPrice: number | null = null;

  for (const level of levels) {
    const withinBoundary =
      side === "BUY"
        ? level.priceUsdPerUnderlying <= adverseBoundary
        : level.priceUsdPerUnderlying >= adverseBoundary;
    if (!withinBoundary) break;

    const take = Math.min(remaining, level.quantityUnderlying);
    filled += take;
    remaining -= take;
    notional += take * level.priceUsdPerUnderlying;
    worstPrice = level.priceUsdPerUnderlying;
    if (remaining <= 1e-12) {
      remaining = 0;
      break;
    }
  }

  const vwap = filled > 0 ? notional / filled : null;
  const adverseSlippageBps =
    vwap === null
      ? null
      : side === "BUY"
        ? ((vwap - referencePriceUsdPerUnderlying) /
            referencePriceUsdPerUnderlying) *
          10_000
        : ((referencePriceUsdPerUnderlying - vwap) /
            referencePriceUsdPerUnderlying) *
          10_000;

  return {
    side,
    requestedQuantityUnderlying: quantityUnderlying,
    filledQuantityUnderlying: filled,
    unfilledQuantityUnderlying: remaining,
    executable: remaining === 0,
    vwapUsdPerUnderlying: vwap,
    worstPriceUsdPerUnderlying: worstPrice,
    adverseSlippageBps,
    tradedNotionalUsd: notional,
  };
}

export function roundPriceForIoc(
  side: HedgeSide,
  priceUsdPerUnderlying: number,
  tickSizeUsd: number,
): number {
  if (
    !Number.isFinite(priceUsdPerUnderlying) ||
    priceUsdPerUnderlying <= 0 ||
    !Number.isFinite(tickSizeUsd) ||
    tickSizeUsd <= 0
  ) {
    throw new RangeError("price and tick size must be finite and positive");
  }

  const ticks = priceUsdPerUnderlying / tickSizeUsd;
  const roundedTicks = side === "BUY" ? Math.ceil(ticks - 1e-12) : Math.floor(ticks + 1e-12);
  return roundedTicks * tickSizeUsd;
}
