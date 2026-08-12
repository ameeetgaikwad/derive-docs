/**
 * Local option board generation.
 *
 * There is no instruments API in sats-options v1 — any strike/expiry that
 * encodes to a valid subId is tradeable on-chain. The frontend generates a
 * board locally: weekly expiries at 08:00 UTC on the next Fridays, and a
 * strike grid at standard OTM distances above spot (covered calls only).
 */

import { toUnit } from "./units";
import { encodeOptionSubId, instrumentName } from "./instruments";

export const EXPIRY_HOUR_UTC = 8;

/** Minimum time before expiry for it to be sellable (avoid sub-24h boards). */
const MIN_TIME_TO_EXPIRY_SEC = 24 * 3600;

/** OTM distances (% above spot) for the suggested covered-call strikes. */
export const OTM_TARGETS_PCT = [2, 5, 8, 10, 15, 20, 25, 30];

/** Round a strike to the BTC board increment. */
export function roundStrike(value: number, increment = 500): number {
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

const NY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function nyParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    NY_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}

/** Staged-board fallback excludes the regular early-close Friday after Thanksgiving. */
function isEarlyCloseFriday(year: number, month: number, day: number): boolean {
  return month === 11 && day === nthWeekday(year, 11, 4, 4) + 1;
}

/** Next Friday 16:00 America/New_York expiries for 24/5 RWA markets. */
export function rwaWeeklyExpiries(count = 4, nowMs: number = Date.now()): number[] {
  const out: number[] = [];
  const cursor = new Date(nowMs);
  cursor.setUTCHours(12, 0, 0, 0);
  for (let i = 0; out.length < count && i < 60; i++) {
    const p = nyParts(cursor);
    if (
      p.weekday === "Fri" &&
      !isEarlyCloseFriday(Number(p.year), Number(p.month), Number(p.day))
    ) {
      const center = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 20);
      for (let delta = -3; delta <= 3; delta++) {
        const candidate = new Date(center + delta * 3_600_000);
        const cp = nyParts(candidate);
        if (cp.year === p.year && cp.month === p.month && cp.day === p.day && cp.hour === "16") {
          const expiry = Math.floor(candidate.getTime() / 1000);
          if (expiry * 1000 - nowMs > MIN_TIME_TO_EXPIRY_SEC * 1000) out.push(expiry);
          break;
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
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
  isCall: true;
  /** lyra-utils OptionEncoding subId */
  subId: bigint;
  /** e.g. BTC-20260619-69000-C */
  instrumentName: string;
  /** distance from spot in % */
  otmPercent: number;
}

/**
 * Strike grid for one expiry: OTM_TARGETS_PCT above spot, rounded to the
 * board increment, deduplicated, strictly above spot.
 */
export function strikesForExpiry(
  spot: number,
  expiry: number,
  options: { currency?: string; strikeIncrement?: number; uiMultiplier?: bigint | null } = {},
): BoardStrike[] {
  if (!(spot > 0)) return [];
  const seen = new Set<number>();
  const out: BoardStrike[] = [];
  for (const pct of OTM_TARGETS_PCT) {
    const strike = roundStrike(spot * (1 + pct / 100), options.strikeIncrement ?? 500);
    if (strike <= spot || seen.has(strike)) continue;
    seen.add(strike);
    const uiStrike18 = toUnit(strike);
    const multiplier = (options as { uiMultiplier?: bigint | null }).uiMultiplier ?? null;
    const unroundedStrike18 = multiplier === null
      ? uiStrike18
      : uiStrike18 * multiplier / 10n ** 18n;
    const strike18 = unroundedStrike18 / 10_000_000_000n * 10_000_000_000n;
    const expiryBig = BigInt(expiry);
    out.push({
      strike,
      strike18,
      expiry,
      isCall: true,
      subId: encodeOptionSubId({ expiry: expiryBig, strike: strike18, isCall: true }),
      instrumentName: instrumentName({
        currency: options.currency ?? "BTC",
        expiry: expiryBig,
        strike: strike18,
        isCall: true,
      }),
      otmPercent: ((strike - spot) / spot) * 100,
    });
  }
  return out.sort((a, b) => a.strike - b.strike);
}

export function formatExpiryLabel(expiryEpochSec: number): string {
  return new Date(expiryEpochSec * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
