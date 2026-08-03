/**
 * Option subId encoding, ported from lyra-utils OptionEncoding.sol
 * (identical to services/shared/src/instruments.ts):
 *
 *   [ 1 bit ] [ 63 bits ] [ 32 bit ] = uint96 subId
 *     isCall    strike      expiry
 *
 * - expiry: unix seconds, fits uint32, non-zero
 * - strike: 18dp, must be a multiple of 1e10 (8dp granularity), stored / 1e10
 * - isCall: top bit (bit 95)
 */

const UINT32_MAX = 0xffffffffn;
const UINT63_MAX = 0x7fffffffffffffffn;
const STRIKE_GRANULARITY = 10_000_000_000n; // 1e10

export interface OptionDetails {
  /** unix seconds */
  expiry: bigint;
  /** 18 decimals */
  strike: bigint;
  isCall: boolean;
}

export function encodeOptionSubId(option: OptionDetails): bigint {
  const { expiry, strike, isCall } = option;
  if (expiry > UINT32_MAX) throw new Error(`OE_ExpiryTooLarge: ${expiry}`);
  if (expiry === 0n) throw new Error("OE_ZeroExpiry");
  if (strike % STRIKE_GRANULARITY !== 0n)
    throw new Error(`OE_StrikeTooGranular: ${strike}`);
  const strike8 = strike / STRIKE_GRANULARITY;
  if (strike8 > UINT63_MAX) throw new Error(`OE_StrikeTooLarge: ${strike}`);

  return expiry | (strike8 << 32n) | ((isCall ? 1n : 0n) << 95n);
}

export function decodeOptionSubId(subId: bigint): OptionDetails {
  if (subId < 0n || subId > (1n << 96n) - 1n)
    throw new Error(`subId out of uint96: ${subId}`);
  return {
    expiry: subId & UINT32_MAX,
    strike: ((subId >> 32n) & UINT63_MAX) * STRIKE_GRANULARITY,
    isCall: subId >> 95n > 0n,
  };
}

// ---------------------------------------------------------------------------
// Instrument naming: BTC-<YYYYMMDD>-<strike>-C (e.g. BTC-20260619-69000-C)
// ---------------------------------------------------------------------------

function formatExpiryDate(expirySec: bigint): string {
  const d = new Date(Number(expirySec) * 1000);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

/** 18dp strike -> compact decimal string (e.g. 110000e18 -> "110000"). */
function formatStrike(strike18: bigint): string {
  const ONE = 10n ** 18n;
  const whole = strike18 / ONE;
  const frac = strike18 % ONE;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

export function instrumentName(params: {
  currency?: string;
  expiry: bigint; // unix seconds
  strike: bigint; // 18dp
  isCall: boolean;
}): string {
  const currency = params.currency ?? "BTC";
  return [
    currency,
    formatExpiryDate(params.expiry),
    formatStrike(params.strike),
    params.isCall ? "C" : "P",
  ].join("-");
}

/** Instrument name straight from a subId. */
export function instrumentNameFromSubId(subId: bigint, currency = "BTC"): string {
  const { expiry, strike, isCall } = decodeOptionSubId(subId);
  return instrumentName({ currency, expiry, strike, isCall });
}
