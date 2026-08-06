const FRIDAY = 5;
const EXPIRY_HOUR_UTC = 8;
const ONE_DAY_SEC = 86_400n;

/**
 * The expiries users may open from the frontend: Friday 08:00 UTC and more
 * than one day away. This intentionally remains separate from oracle
 * coverage, which must additionally include every expiry with open interest.
 */
export function tradeableFridayExpiries(
  count: number,
  nowSec: bigint,
  minLeadSec: bigint = ONE_DAY_SEC,
): bigint[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`expiry count must be a non-negative integer (received ${count})`);
  }
  if (count === 0) return [];

  const nowMs = Number(nowSec) * 1000;
  if (!Number.isSafeInteger(nowMs)) throw new Error(`chain timestamp is too large: ${nowSec}`);

  const d = new Date(nowMs);
  const candidate = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), EXPIRY_HOUR_UTC, 0, 0),
  );
  const daysToFriday = (FRIDAY - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysToFriday);

  const out: bigint[] = [];
  while (out.length < count) {
    const expiry = BigInt(Math.floor(candidate.getTime() / 1000));
    if (expiry - nowSec > minLeadSec) out.push(expiry);
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }
  return out;
}

/** Parse a comma-separated unix-expiry list used only as a break-glass override. */
export function parseExpiryList(raw: string | undefined, name = "expiry list"): bigint[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!/^\d+$/.test(part)) throw new Error(`${name} contains a non-integer expiry: ${part}`);
      const expiry = BigInt(part);
      if (expiry <= 0n || expiry > 0xffff_ffffn) {
        throw new Error(`${name} expiry is outside uint32: ${part}`);
      }
      return expiry;
    });
}

export interface OracleExpirySet {
  /** Expiries exposed for new trades. */
  tradeable: bigint[];
  /** Unexpired expiries proven to have a non-zero on-chain option balance. */
  active: bigint[];
  /** Explicit operational override; never the primary discovery mechanism. */
  extra: bigint[];
  /** Sorted, deduplicated union posted by the oracle. */
  posting: bigint[];
}

/**
 * Oracle coverage invariant:
 *   tradeable expiries U active-position expiries U break-glass extras.
 *
 * Expired positions are handled by the settlement worker and therefore do not
 * enter the live forward/vol/rate snapshot.
 */
export function buildOracleExpirySet(params: {
  nowSec: bigint;
  tradeable: readonly bigint[];
  active: readonly bigint[];
  extra?: readonly bigint[];
}): OracleExpirySet {
  const future = (values: readonly bigint[]) => values.filter((expiry) => expiry > params.nowSec);
  const tradeable = sortedUnique(future(params.tradeable));
  const active = sortedUnique(future(params.active));
  const extra = sortedUnique(future(params.extra ?? []));
  return {
    tradeable,
    active,
    extra,
    posting: sortedUnique([...tradeable, ...active, ...extra]),
  };
}

function sortedUnique(values: readonly bigint[]): bigint[] {
  return [...new Set(values.map(String))]
    .map((value) => BigInt(value))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
