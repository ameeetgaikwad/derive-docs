/** Decimal-string -> bigint at `decimals` (e.g. toTokenAmount("1.5", 18)). */
export function toTokenAmount(value: string, decimals: number): bigint {
  const negative = value.startsWith("-");
  const v = negative ? value.slice(1) : value;
  const [intPart = "0", decPart = ""] = v.split(".");
  const padded = decPart.padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return negative ? -result : result;
}

/** Decimal-string -> 18dp bigint (the protocol's internal representation). */
export function toUnit(value: string | number): bigint {
  return toTokenAmount(typeof value === "number" ? value.toString() : value, 18);
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
