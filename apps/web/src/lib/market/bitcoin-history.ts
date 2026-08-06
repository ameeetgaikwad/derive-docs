export type BitcoinPriceHistoryPoint = {
  time: number;
  value: number;
};

const HISTORY_LENGTH = 30;

function normalizeHistory(
  points: BitcoinPriceHistoryPoint[],
): BitcoinPriceHistoryPoint[] {
  const byTimestamp = new Map<number, BitcoinPriceHistoryPoint>();

  for (const point of points) {
    if (
      Number.isFinite(point.time) &&
      point.time > 0 &&
      Number.isFinite(point.value) &&
      point.value > 0
    ) {
      byTimestamp.set(point.time, point);
    }
  }

  return [...byTimestamp.values()]
    .sort((left, right) => left.time - right.time)
    .slice(-HISTORY_LENGTH);
}

export function parseBinanceKlines(
  payload: unknown,
): BitcoinPriceHistoryPoint[] {
  if (!Array.isArray(payload)) return [];

  return normalizeHistory(
    payload.flatMap((row): BitcoinPriceHistoryPoint[] => {
      if (!Array.isArray(row)) return [];

      const openTimeMilliseconds = Number(row[0]);
      const closePrice = Number(row[4]);
      if (
        !Number.isFinite(openTimeMilliseconds) ||
        !Number.isFinite(closePrice)
      ) {
        return [];
      }

      return [
        {
          time: Math.floor(openTimeMilliseconds / 1_000),
          value: closePrice,
        },
      ];
    }),
  );
}

export function parseCoinbaseCandles(
  payload: unknown,
): BitcoinPriceHistoryPoint[] {
  if (!Array.isArray(payload)) return [];

  return normalizeHistory(
    payload.flatMap((row): BitcoinPriceHistoryPoint[] => {
      if (!Array.isArray(row)) return [];

      const time = Number(row[0]);
      const closePrice = Number(row[4]);
      if (!Number.isFinite(time) || !Number.isFinite(closePrice)) return [];

      return [{ time, value: closePrice }];
    }),
  );
}

/**
 * Keep the protocol's on-chain spot authoritative for the live endpoint of the
 * display-only exchange history. The daily candle timestamp is preserved so
 * the chart remains stable between renders.
 */
export function mergeHistoryWithSpot(
  history: BitcoinPriceHistoryPoint[],
  spotPrice: number,
): BitcoinPriceHistoryPoint[] {
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) return history;
  if (history.length === 0) return [{ time: 0, value: spotPrice }];

  return history.map((point, index) =>
    index === history.length - 1 ? { ...point, value: spotPrice } : point,
  );
}
