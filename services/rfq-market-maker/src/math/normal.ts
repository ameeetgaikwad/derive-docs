const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

export function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / SQRT_TWO_PI;
}

/** Abramowitz-Stegun approximation; maximum error is below 8e-8. */
export function normalCdf(value: number): number {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const polynomial =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upperTail = normalPdf(absolute) * polynomial;
  return value >= 0 ? 1 - upperTail : upperTail;
}
