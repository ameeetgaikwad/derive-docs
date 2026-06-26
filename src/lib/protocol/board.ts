/**
 * Local option board generation.
 *
 * There is no instruments API in sats-options v1 — any strike/expiry that
 * encodes to a valid subId is tradeable on-chain. The frontend generates a
 * board locally: weekly expiries at 08:00 UTC on the next Fridays, and a
 * strike grid at standard OTM distances above or below spot.
 */

import { toUnit } from "./units";
import { encodeOptionSubId, instrumentName } from "./instruments";

export const EXPIRY_HOUR_UTC = 8;

/** Minimum time before expiry for it to be sellable (avoid sub-24h boards). */
const MIN_TIME_TO_EXPIRY_SEC = 24 * 3600;

/** OTM distances (% above spot) for the suggested paid sell targets. */
export const SELL_TARGETS_PCT = [2, 5, 8, 10, 15, 20, 25, 30];

/** OTM distances (% below spot) for the suggested paid buy targets. */
export const BUY_TARGETS_PCT = [2, 5, 8, 10, 15, 20];

export type TargetDirection = "sell_high" | "buy_low";

/** Round a strike to the BTC board increment. */
export function roundStrike(value: number): number {
  const increment = 500;
  return Math.round(value / increment) * increment;
}

/**
 * Next `count` weekly expiries: Fridays 08:00 UTC, strictly more than
 * MIN_TIME_TO_EXPIRY_SEC in the future.
 */
export function weeklyExpiries(count = 4, nowMs: number = Date.now()): number[] {
  const out: number[] = [];
  const d = new Date(nowMs);
  // Move to the upcoming Friday (UTC day 5).
  const candidate = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), EXPIRY_HOUR_UTC, 0, 0)
  );
  const day = candidate.getUTCDay();
  const daysToFriday = (5 - day + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysToFriday);

  while (out.length < count) {
    const epoch = Math.floor(candidate.getTime() / 1000);
    if (epoch - nowMs / 1000 > MIN_TIME_TO_EXPIRY_SEC) {
      out.push(epoch);
    }
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }
  return out;
}

export interface BoardStrike {
  /** strike in whole quote units (USDT) */
  strike: number;
  /** 18dp strike */
  strike18: bigint;
  /** unix seconds */
  expiry: number;
  isCall: boolean;
  /** lyra-utils OptionEncoding subId */
  subId: bigint;
  /** e.g. BTC-20260619-69000-C */
  instrumentName: string;
  /** distance from spot in % */
  otmPercent: number;
}

/**
 * Strike grid for one expiry: sell targets are OTM calls above spot; buy
 * targets are OTM puts below spot. Strikes are rounded to the board increment,
 * deduplicated, and encoded into tradeable option subIds.
 */
export function strikesForExpiry(
  spot: number,
  expiry: number,
  direction: TargetDirection = "sell_high"
): BoardStrike[] {
  if (!(spot > 0)) return [];
  const seen = new Set<number>();
  const out: BoardStrike[] = [];
  const isCall = direction === "sell_high";
  const targets = isCall ? SELL_TARGETS_PCT : BUY_TARGETS_PCT;

  for (const pct of targets) {
    const strike = roundStrike(spot * (isCall ? 1 + pct / 100 : 1 - pct / 100));
    if (strike <= 0 || seen.has(strike)) continue;
    if (isCall && strike <= spot) continue;
    if (!isCall && strike >= spot) continue;
    seen.add(strike);
    const strike18 = toUnit(strike);
    const expiryBig = BigInt(expiry);
    out.push({
      strike,
      strike18,
      expiry,
      isCall,
      subId: encodeOptionSubId({ expiry: expiryBig, strike: strike18, isCall }),
      instrumentName: instrumentName({ expiry: expiryBig, strike: strike18, isCall }),
      otmPercent: (Math.abs(strike - spot) / spot) * 100,
    });
  }
  return out.sort((a, b) => (isCall ? a.strike - b.strike : b.strike - a.strike));
}

export function formatExpiryLabel(expiryEpochSec: number): string {
  return new Date(expiryEpochSec * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
