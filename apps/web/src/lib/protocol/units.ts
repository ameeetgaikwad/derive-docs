/**
 * Unit helpers (ported from services/shared/src/units.ts).
 * On BNB chain both BTCB and USDT are 18 decimals, matching the protocol's
 * internal 18dp representation.
 */

/** Decimal-string -> bigint at `decimals` (e.g. toTokenAmount("1.5", 18)). */
export function toTokenAmount(value: string, decimals: number): bigint {
  const negative = value.startsWith("-");
  const v = negative ? value.slice(1) : value;
  const [intPart = "0", decPart = ""] = v.split(".");
  const padded = decPart.padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return negative ? -result : result;
}

/** Decimal-string or number -> 18dp bigint. */
export function toUnit(value: string | number): bigint {
  return toTokenAmount(typeof value === "number" ? value.toString() : value, 18);
}

/** Exact 18dp comparison for user-entered decimal amounts. */
export function amountExceedsLimit(
  value: string,
  limit: string,
): boolean {
  return toUnit(value) > toUnit(limit);
}

/** 18dp bigint -> decimal string. */
export function fromUnit(value: bigint, decimals = 18): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const ONE = 10n ** BigInt(decimals);
  const whole = v / ONE;
  const frac = v % ONE;
  const s =
    frac === 0n
      ? whole.toString()
      : `${whole}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
  return negative ? `-${s}` : s;
}

/** 18dp bigint -> float (display only — fine for UI precision). */
export function unitToNumber(value: bigint): number {
  return Number(value) / 1e18;
}
